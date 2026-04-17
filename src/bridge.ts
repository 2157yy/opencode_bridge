import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Session, SessionStatus } from '@opencode-ai/sdk';
import { readJsonFile, writeJsonFile } from './store.js';
import { BridgeRegistry, type AgentRecord, type BridgeSnapshot, type LlmConfig } from './registry.js';
import { createClient, defaultLaunchPlan, startBackend, type BackendHandle, type LaunchPlan, type ProcessLauncher } from './opencode.js';
import { mapSessionStatus, summarizeSessionStatus } from './state-machine.js';

export type BridgeOptions = {
  projectDir: string;
  statePath?: string;
  pollIntervalMs?: number;
  backendFactory?: (options: { projectDir: string }) => Promise<BackendHandle>;
  clientFactory?: (options: { baseUrl: string; projectDir: string }) => ReturnType<typeof createClient>;
  launcher?: ProcessLauncher;
  launchPlanFactory?: (options: {
    projectDir: string;
    serverUrl: string;
    sessionId: string;
    agentName: string;
    role: 'primary' | 'subagent';
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    llmConfig?: LlmConfig;
  }) => LaunchPlan;
  clock?: () => Date;
  stopWaitMs?: number;
};

export type SpawnAgentOptions = {
  name: string;
  role?: 'primary' | 'subagent';
  parentAgentId?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export type RouteOptions = {
  agentId?: string;
  prompt: string;
  system?: string;
  noReply?: boolean;
};

export class OpenCodeBridge {
  private readonly statePath: string;
  private readonly projectDir: string;
  private readonly pollIntervalMs: number;
  private readonly backendFactory: (options: { projectDir: string }) => Promise<BackendHandle>;
  private readonly clientFactory: (options: { baseUrl: string; projectDir: string }) => ReturnType<typeof createClient>;
  private readonly launcher: ProcessLauncher;
  private readonly launchPlanFactory: (options: {
    projectDir: string;
    serverUrl: string;
    sessionId: string;
    agentName: string;
    role: 'primary' | 'subagent';
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    llmConfig?: LlmConfig;
  }) => LaunchPlan;
  private readonly clock: () => Date;
  private readonly stopWaitMs: number;

  private registry: BridgeRegistry;
  private backend?: BackendHandle;
  private serverUrl?: string;
  private client?: ReturnType<typeof createClient>;
  private monitor: NodeJS.Timeout | undefined;
  private started = false;
  private ownerRuntime = false;

  constructor(options: BridgeOptions) {
    this.projectDir = resolve(options.projectDir);
    this.statePath = options.statePath ?? resolve(this.projectDir, '.opencode-bridge', 'state.json');
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.backendFactory = options.backendFactory ?? startBackend;
    this.clientFactory = options.clientFactory ?? createClient;
    this.launcher = options.launcher ?? defaultLauncher;
    this.launchPlanFactory = options.launchPlanFactory ?? defaultLaunchPlan;
    this.clock = options.clock ?? (() => new Date());
    this.stopWaitMs = options.stopWaitMs ?? 5_000;
    this.registry = new BridgeRegistry(this.projectDir);
  }

  async start(): Promise<BridgeSnapshot> {
    if (this.started) {
      return this.registry.snapshot();
    }

    await this.loadPersistedState();
    if (!this.registry.runtimeState()?.active) {
      this.resetForNewRuntime();
    }
    await this.ensureOwnerClient();

    this.ownerRuntime = true;
    this.started = true;
    this.registry.activateRuntime({
      runtimeId: randomUUID(),
      ownerPid: process.pid,
      startedAt: this.clock().toISOString(),
      serverUrl: this.serverUrl,
    });

    if (!this.registry.primary()) {
      await this.spawnAgent({ name: 'primary', role: 'primary' });
    }

    this.startMonitor();
    await this.persist();
    return this.registry.snapshot();
  }

  async connectExisting(): Promise<BridgeSnapshot> {
    await this.loadPersistedState();
    const runtime = this.registry.runtimeState();
    if (!runtime?.active || !this.serverUrl) {
      throw new Error('no active runtime; run `start` first');
    }

    const client = this.clientFactory({ baseUrl: this.serverUrl, projectDir: this.projectDir });
    if (!(await this.canUseClient(client))) {
      this.registry.markRuntimeInactive('runtime is stale or unreachable', true);
      await this.persist();
      throw new Error('no active runtime; run `start` first');
    }

    this.client = client;
    this.started = true;
    this.ownerRuntime = false;
    return this.registry.snapshot();
  }

  async shutdown(): Promise<void> {
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = undefined;
    }
    if (this.ownerRuntime) {
      this.registry.markRuntimeInactive('runtime stopped');
    }
    await this.persist();
    this.backend?.close();
    this.started = false;
    this.ownerRuntime = false;
    this.backend = undefined;
    this.client = undefined;
    this.serverUrl = undefined;
  }

  async stop(): Promise<BridgeSnapshot> {
    await this.loadPersistedState();
    const runtime = this.registry.runtimeState();
    if (!runtime?.active || !runtime.ownerPid) {
      throw new Error('no active runtime to stop');
    }

    if (!this.isProcessAlive(runtime.ownerPid)) {
      this.registry.markRuntimeInactive('runtime owner is no longer running', true);
      await this.persist();
      throw new Error('no active runtime to stop');
    }

    process.kill(runtime.ownerPid, 'SIGTERM');
    const deadline = Date.now() + this.stopWaitMs;
    while (Date.now() < deadline) {
      const saved = await readJsonFile<BridgeSnapshot | null>(this.statePath, null);
      if (!saved?.runtime?.active) {
        this.registry = new BridgeRegistry(this.projectDir, saved ?? undefined);
        this.serverUrl = saved?.serverUrl;
        return this.registry.snapshot();
      }
      await delay(100);
    }

    throw new Error('timed out waiting for runtime shutdown');
  }

  async spawnAgent(options: SpawnAgentOptions): Promise<AgentRecord> {
    if (!this.client || !this.serverUrl) {
      throw new Error('bridge is not connected');
    }

    const role = options.role ?? 'subagent';
    const parent = options.parentAgentId ? this.registry.get(options.parentAgentId) : this.registry.primary();
    const parentSessionId = parent?.sessionId;
    const session = await this.createSession(options.name, parentSessionId);
    const llmConfig = resolveLlmConfig({ apiKey: options.apiKey, baseUrl: options.baseUrl, model: options.model });

    const record = this.registry.register({
      id: session.id,
      role,
      name: options.name,
      sessionId: session.id,
      windowId: session.id,
      parentId: parent?.id ?? undefined,
      command: 'opencode',
      args: [],
      status: 'queued',
      phase: 'queued',
      llm: llmConfig,
      llmConfig,
    });

    const launchPlan = this.launchPlanFactory({
      projectDir: this.projectDir,
      serverUrl: this.serverUrl,
      sessionId: session.id,
      agentName: options.name,
      role,
      llmConfig,
    });

    const proc = this.launcher(launchPlan.command, launchPlan.args, {
      cwd: this.projectDir,
      env: {
        ...process.env,
        ...launchPlan.env,
      },
    });

    this.bindProcess(record.id, proc);
    this.registry.register({
      ...record,
      command: launchPlan.command,
      args: launchPlan.args,
      status: 'running',
      phase: 'running',
      llm: llmConfig,
      llmConfig,
      ...(proc.pid ? { pid: proc.pid } : {}),
    });

    await this.persist();
    return this.requireAgent(record.id);
  }

  async route(options: RouteOptions): Promise<AgentRecord> {
    if (!this.client) {
      throw new Error('bridge is not connected');
    }

    const agent = this.resolveAgent(options.agentId);
    const target = await this.requireSession(agent.sessionId);

    await this.client.session.promptAsync({
      path: { id: target.id },
      query: { directory: this.projectDir },
      body: {
        agent: agent.name,
        noReply: options.noReply ?? false,
        ...(options.system ? { system: options.system } : {}),
        parts: [{ type: 'text', text: options.prompt }],
      },
    });

    if (agent.status === 'running') {
      this.registry.syncPhase(agent.id, 'running');
    } else {
      this.registry.transition(agent.id, 'running', 'routed prompt', 'running');
    }
    this.registry.recordArtifact(agent.id, {
      kind: 'task',
      summary: `routed prompt: ${options.prompt.slice(0, 120)}`,
      metadata: { length: options.prompt.length },
    });
    await this.persist();
    return this.requireAgent(agent.id);
  }

  async restartAgent(agentId: string): Promise<AgentRecord> {
    if (!this.client || !this.serverUrl) {
      throw new Error('bridge is not connected');
    }
    const agent = this.requireAgent(agentId);
    await this.requireSession(agent.sessionId);
    const llmConfig = agent.llmConfig ?? agent.llm;
    const launchPlan = this.launchPlanFactory({
      projectDir: this.projectDir,
      serverUrl: this.serverUrl,
      sessionId: agent.sessionId,
      agentName: agent.name,
      role: agent.role,
      llmConfig,
    });

    const proc = this.launcher(launchPlan.command, launchPlan.args, {
      cwd: this.projectDir,
      env: {
        ...process.env,
        ...launchPlan.env,
      },
    });

    this.bindProcess(agent.id, proc);
    this.registry.register({
      ...agent,
      command: launchPlan.command,
      args: launchPlan.args,
      status: agent.status,
      phase: agent.phase,
      pid: proc.pid ?? undefined,
      exit: undefined,
      llm: llmConfig,
      llmConfig,
    });
    if (agent.status === 'running') {
      this.registry.syncPhase(agent.id, 'running');
    } else {
      this.registry.transition(agent.id, 'running', 'cli restarted', 'running');
    }
    await this.persist();
    return this.requireAgent(agent.id);
  }

  async pollOnce(): Promise<BridgeSnapshot> {
    if (!this.client) {
      throw new Error('bridge is not connected');
    }

    const statusResponse = await this.client.session.status({ query: { directory: this.projectDir } });
    const statuses = statusResponse.data ?? {};
    for (const agent of this.registry.list()) {
      const sessionStatus = statuses[agent.sessionId] as SessionStatus | undefined;
      const mapped = mapSessionStatus(sessionStatus);
      if (mapped) {
        if (mapped.status !== agent.status) {
          this.registry.transition(agent.id, mapped.status, summarizeSessionStatus(sessionStatus!), mapped.phase);
        } else {
          this.registry.syncPhase(agent.id, mapped.phase);
        }
      }

      const sessionResponse = await this.client.session.get({
        path: { id: agent.sessionId },
        query: { directory: this.projectDir },
      });
      const session = sessionResponse.data as Session | undefined;
      if (!session) {
        continue;
      }

      const marker = `${session.version}:${session.time.updated}:${session.summary?.files ?? 0}:${session.summary?.additions ?? 0}:${session.summary?.deletions ?? 0}`;
      if (agent.observedSessionVersion !== marker) {
        this.registry.register({
          ...agent,
          observedSessionVersion: marker,
          status: agent.status,
          phase: agent.phase,
          llm: agent.llmConfig ?? agent.llm,
          llmConfig: agent.llmConfig ?? agent.llm,
        });
        if (session.summary) {
          this.registry.recordArtifact(agent.id, {
            kind: 'summary',
            summary: `${session.title} — ${session.summary.files} file(s), +${session.summary.additions}/-${session.summary.deletions}`,
            ...(session.share?.url ? { ref: session.share.url } : {}),
            metadata: {
              title: session.title,
              version: session.version,
              summary: session.summary,
            },
          });
        }
        if (sessionStatus?.type === 'idle' && agent.status !== 'done') {
          this.registry.transition(agent.id, 'done', 'session idle', 'done');
        }
      }
    }

    await this.persist();
    return this.registry.snapshot();
  }

  status(): BridgeSnapshot {
    return this.registry.snapshot();
  }

  async readStatus(): Promise<BridgeSnapshot> {
    await this.loadPersistedState();
    const runtime = this.registry.runtimeState();
    if (!runtime?.active || !this.serverUrl) {
      return this.registry.snapshot();
    }

    const client = this.clientFactory({ baseUrl: this.serverUrl, projectDir: this.projectDir });
    if (await this.canUseClient(client)) {
      return this.registry.snapshot();
    }

    this.registry.markRuntimeInactive('runtime is stale or unreachable', true);
    await this.persist();
    return this.registry.snapshot();
  }

  async recordArtifact(agentId: string, summary: string, metadata?: Record<string, unknown>): Promise<AgentRecord> {
    this.registry.recordArtifact(agentId, { kind: 'event', summary, ...(metadata ? { metadata } : {}) });
    await this.persist();
    return this.requireAgent(agentId);
  }

  async markFailed(agentId: string, reason: string): Promise<AgentRecord> {
    this.registry.transition(agentId, 'failed', reason, 'failed');
    this.registry.recordArtifact(agentId, { kind: 'error', summary: reason });
    await this.persist();
    return this.requireAgent(agentId);
  }

  async markDone(agentId: string, summary?: string): Promise<AgentRecord> {
    if (summary) {
      this.registry.recordArtifact(agentId, { kind: 'summary', summary });
    }
    this.registry.transition(agentId, 'done', 'completed', 'done');
    await this.persist();
    return this.requireAgent(agentId);
  }

  private async createSession(title: string, parentId?: string): Promise<Session> {
    if (!this.client) {
      throw new Error('bridge is not connected');
    }
    const response = await this.client.session.create({
      query: { directory: this.projectDir },
      body: parentId ? { title, parentID: parentId } : { title },
    });
    const session = response.data;
    if (!session) {
      throw new Error('failed to create opencode session');
    }
    return session;
  }

  private async requireSession(sessionId: string): Promise<Session> {
    if (!this.client) {
      throw new Error('bridge is not connected');
    }
    const response = await this.client.session.get({
      path: { id: sessionId },
      query: { directory: this.projectDir },
    });
    const session = response.data;
    if (!session) {
      throw new Error(`unknown session: ${sessionId}`);
    }
    return session;
  }

  private resolveAgent(agentId?: string): AgentRecord {
    if (agentId) {
      return this.requireAgent(agentId);
    }
    const primary = this.registry.primary();
    if (!primary) {
      throw new Error('no primary agent registered');
    }
    return primary;
  }

  private requireAgent(agentId: string): AgentRecord {
    const agent = this.registry.get(agentId);
    if (!agent) {
      throw new Error(`unknown agent: ${agentId}`);
    }
    return agent;
  }

  private bindProcess(agentId: string, proc: ChildProcess): void {
    if (proc.pid) {
      this.registry.register({
        ...this.requireAgent(agentId),
        pid: proc.pid,
      });
    }

    proc.once('exit', (code, signal) => {
      void this.handleProcessExit(agentId, code, signal);
    });
    proc.once('error', (error) => {
      void this.handleProcessError(agentId, error);
    });
  }

  private async handleProcessExit(agentId: string, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    this.registry.recordExit(agentId, code, signal);
    await this.persist();
  }

  private async handleProcessError(agentId: string, error: Error): Promise<void> {
    this.registry.recordArtifact(agentId, {
      kind: 'error',
      summary: error.message,
      metadata: { name: error.name, stack: error.stack },
    });
    this.registry.transition(agentId, 'failed', error.message, 'failed');
    await this.persist();
  }

  private startMonitor(): void {
    if (this.monitor) {
      return;
    }
    this.monitor = setInterval(() => {
      void this.pollOnce().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const primary = this.registry.primary();
        if (primary) {
          this.registry.recordArtifact(primary.id, { kind: 'error', summary: `poll failed: ${message}` });
        }
      });
    }, this.pollIntervalMs);
    this.monitor.unref?.();
  }

  private async persist(): Promise<void> {
    const current = this.registry.snapshot();
    const saved = await readJsonFile<BridgeSnapshot | null>(this.statePath, null);
    const merged = mergeSnapshots(saved, current);
    this.registry = new BridgeRegistry(this.projectDir, merged);
    await writeJsonFile(this.statePath, merged);
  }

  private async loadPersistedState(): Promise<void> {
    const saved = await readJsonFile<BridgeSnapshot | null>(this.statePath, null);
    this.registry = new BridgeRegistry(this.projectDir, saved ?? undefined);
    this.serverUrl = saved?.serverUrl;
  }

  private resetForNewRuntime(): void {
    const current = this.registry.snapshot();
    this.registry = new BridgeRegistry(this.projectDir, {
      projectDir: this.projectDir,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      agents: [],
    });
    this.serverUrl = undefined;
  }

  private async ensureOwnerClient(): Promise<void> {
    const runtime = this.registry.runtimeState();
    if (runtime?.active && this.serverUrl) {
      const existingClient = this.clientFactory({ baseUrl: this.serverUrl, projectDir: this.projectDir });
      if (await this.canUseClient(existingClient)) {
        throw new Error('bridge runtime already active; use `status`, `spawn`, `route`, `restart`, or `stop`');
      }
      this.registry.markRuntimeInactive('replacing stale runtime', true);
    }

    this.backend = await this.backendFactory({ projectDir: this.projectDir });
    this.serverUrl = this.backend.url;
    this.registry.setServerUrl(this.backend.url);
    this.client = this.clientFactory({ baseUrl: this.backend.url, projectDir: this.projectDir });
  }

  private async canUseClient(client: ReturnType<typeof createClient>): Promise<boolean> {
    try {
      await client.session.status({ query: { directory: this.projectDir } });
      return true;
    } catch {
      return false;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

function defaultLauncher(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child;
}

export function makeStatePath(projectDir: string): string {
  return resolve(projectDir, '.opencode-bridge', 'state.json');
}

function resolveLlmConfig(overrides: LlmConfig): LlmConfig | undefined {
  const merged: LlmConfig = {
    ...(process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : {}),
    ...(process.env.OPENAI_BASE_URL ? { baseUrl: process.env.OPENAI_BASE_URL } : {}),
    ...(process.env.OPENCODE_MODEL ? { model: process.env.OPENCODE_MODEL } : {}),
    ...pickDefined(overrides),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function pickDefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function mergeSnapshots(saved: BridgeSnapshot | null, current: BridgeSnapshot): BridgeSnapshot {
  if (!saved) {
    return current;
  }

  const agents = new Map<string, AgentRecord>();
  for (const agent of saved.agents) {
    agents.set(agent.id, structuredClone(agent));
  }
  for (const agent of current.agents) {
    agents.set(agent.id, structuredClone(agent));
  }

  return {
    ...saved,
    ...current,
    serverUrl: current.serverUrl ?? saved.serverUrl,
    primaryAgentId: current.primaryAgentId ?? saved.primaryAgentId,
    runtime: current.runtime ?? saved.runtime,
    agents: [...agents.values()],
  };
}
