import { assertTransition, defaultPhaseForStatus, type AgentStatus, type Transition } from './state-machine.js';

export type AgentRole = 'primary' | 'subagent';

export type LlmConfig = {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
};

export type Artifact = {
  kind: 'task' | 'summary' | 'event' | 'error';
  summary: string;
  ref?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  createdAt: string;
};

export type RuntimeRecord = {
  runtimeId: string;
  ownerPid: number;
  startedAt: string;
  active: boolean;
  serverUrl?: string | undefined;
  stale?: boolean | undefined;
  stoppedAt?: string | undefined;
  lastError?: string | undefined;
};

export type AgentRecord = {
  id: string;
  role: AgentRole;
  name: string;
  sessionId: string;
  windowId: string;
  parentId?: string | undefined;
  command: string;
  args: string[];
  status: AgentStatus;
  phase: string;
  createdAt: string;
  updatedAt: string;
  pid?: number | undefined;
  exit?: {
    code: number | null;
    signal: NodeJS.Signals | null;
    at: string;
  } | undefined;
  latestSummary?: string | undefined;
  observedSessionVersion?: string | undefined;
  llm?: LlmConfig | undefined;
  llmConfig?: LlmConfig | undefined;
  artifacts: Artifact[];
  history: Transition[];
};

export type BridgeSnapshot = {
  serverUrl?: string | undefined;
  projectDir: string;
  primaryAgentId?: string | undefined;
  runtime?: RuntimeRecord | undefined;
  createdAt: string;
  updatedAt: string;
  counts: {
    active: number;
    failed: number;
    completed: number;
    blocked: number;
    total: number;
  };
  agents: AgentRecord[];
};

export class BridgeRegistry {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly createdAt: string;
  private updatedAt: string;
  private serverUrl?: string | undefined;
  private primaryAgentId?: string | undefined;
  private runtime?: RuntimeRecord | undefined;
  private readonly projectDir: string;

  constructor(projectDir: string, snapshot?: Partial<BridgeSnapshot>) {
    this.projectDir = projectDir;
    this.createdAt = snapshot?.createdAt ?? new Date().toISOString();
    this.updatedAt = snapshot?.updatedAt ?? this.createdAt;
    this.serverUrl = snapshot?.serverUrl;
    this.primaryAgentId = snapshot?.primaryAgentId;
    this.runtime = snapshot?.runtime ? structuredClone(snapshot.runtime) : undefined;

    for (const agent of snapshot?.agents ?? []) {
      this.agents.set(agent.id, structuredClone(agent));
    }
  }

  setServerUrl(serverUrl: string): void {
    this.serverUrl = serverUrl;
    if (this.runtime) {
      this.runtime.serverUrl = serverUrl;
    }
    this.touch();
  }

  runtimeState(): RuntimeRecord | undefined {
    return this.runtime ? structuredClone(this.runtime) : undefined;
  }

  activateRuntime(runtime: Omit<RuntimeRecord, 'active'> & Partial<Pick<RuntimeRecord, 'active'>>): RuntimeRecord {
    this.runtime = {
      runtimeId: runtime.runtimeId,
      ownerPid: runtime.ownerPid,
      startedAt: runtime.startedAt,
      active: runtime.active ?? true,
      serverUrl: runtime.serverUrl,
      stale: false,
      stoppedAt: undefined,
      lastError: undefined,
    };
    if (runtime.serverUrl) {
      this.serverUrl = runtime.serverUrl;
    }
    this.touch();
    return structuredClone(this.runtime);
  }

  markRuntimeInactive(reason?: string, stale = false): RuntimeRecord | undefined {
    if (!this.runtime) {
      return undefined;
    }

    this.runtime = {
      ...this.runtime,
      active: false,
      stale,
      stoppedAt: new Date().toISOString(),
      ...(reason ? { lastError: reason } : {}),
    };
    this.touch();
    return structuredClone(this.runtime);
  }

  register(
    agent: Omit<AgentRecord, 'createdAt' | 'updatedAt' | 'artifacts' | 'history' | 'status' | 'phase'> &
      Partial<
        Pick<
          AgentRecord,
          'status' | 'phase' | 'artifacts' | 'history' | 'pid' | 'exit' | 'latestSummary' | 'observedSessionVersion' | 'llm' | 'llmConfig'
        >
      >,
  ): AgentRecord {
    const existing = this.agents.get(agent.id);
    const now = new Date().toISOString();
    const record: AgentRecord = {
      id: agent.id,
      role: agent.role,
      name: agent.name,
      sessionId: agent.sessionId,
      windowId: agent.windowId,
      parentId: agent.parentId,
      command: agent.command,
      args: [...agent.args],
      status: agent.status ?? 'queued',
      phase: agent.phase ?? defaultPhaseForStatus(agent.status ?? 'queued'),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      pid: 'pid' in agent ? agent.pid : existing?.pid,
      exit: 'exit' in agent ? agent.exit : existing?.exit,
      latestSummary: 'latestSummary' in agent ? agent.latestSummary : existing?.latestSummary,
      observedSessionVersion: 'observedSessionVersion' in agent ? agent.observedSessionVersion : existing?.observedSessionVersion,
      llm: 'llm' in agent ? structuredClone(agent.llm) : ('llmConfig' in agent ? structuredClone(agent.llmConfig) : structuredClone(existing?.llm ?? existing?.llmConfig)),
      llmConfig: 'llmConfig' in agent ? structuredClone(agent.llmConfig) : ('llm' in agent ? structuredClone(agent.llm) : structuredClone(existing?.llmConfig ?? existing?.llm)),
      artifacts: structuredClone(agent.artifacts ?? existing?.artifacts ?? []),
      history: structuredClone(agent.history ?? existing?.history ?? []),
    };

    this.agents.set(record.id, record);
    if (record.role === 'primary') {
      this.primaryAgentId = record.id;
    }
    this.touch();
    return record;
  }

  get(id: string): AgentRecord | undefined {
    return this.agents.get(id);
  }

  primary(): AgentRecord | undefined {
    if (this.primaryAgentId) {
      return this.agents.get(this.primaryAgentId);
    }
    return [...this.agents.values()].find((agent) => agent.role === 'primary');
  }

  list(): AgentRecord[] {
    return [...this.agents.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  transition(id: string, to: AgentStatus, note?: string, phase?: string): AgentRecord {
    const agent = this.require(id);
    assertTransition(agent.status, to);
    const now = new Date().toISOString();
    const history: Transition = {
      from: agent.status,
      to,
      at: now,
      ...(note ? { note } : {}),
    };
    agent.status = to;
    agent.phase = phase ?? defaultPhaseForStatus(to);
    agent.updatedAt = now;
    agent.history = [...agent.history, history];
    this.touch();
    return agent;
  }

  syncPhase(id: string, phase: string): AgentRecord {
    const agent = this.require(id);
    agent.phase = phase;
    agent.updatedAt = new Date().toISOString();
    this.touch();
    return agent;
  }

  recordArtifact(id: string, artifact: Omit<Artifact, 'createdAt'> & Partial<Pick<Artifact, 'createdAt'>>): AgentRecord {
    const agent = this.require(id);
    const nextArtifact: Artifact = {
      ...artifact,
      createdAt: artifact.createdAt ?? new Date().toISOString(),
    };
    agent.artifacts = [...agent.artifacts, nextArtifact];
    agent.latestSummary = nextArtifact.summary;
    agent.phase = artifact.kind === 'summary' ? 'produced' : agent.phase;
    agent.updatedAt = nextArtifact.createdAt;
    if (agent.status === 'running' || agent.status === 'blocked' || agent.status === 'queued') {
      try {
        this.transition(id, 'produced', `artifact:${artifact.kind}`, 'produced');
      } catch {
        // If already in a terminal state, keep the artifact but do not force a transition.
      }
    }
    this.touch();
    return agent;
  }

  recordExit(id: string, code: number | null, signal: NodeJS.Signals | null): AgentRecord {
    const agent = this.require(id);
    agent.exit = { code, signal, at: new Date().toISOString() };
    if (agent.status !== 'done') {
      try {
        this.transition(id, code === 0 ? 'done' : 'failed', code === 0 ? 'process exit' : 'process failure');
      } catch {
        // ignore invalid transitions for terminal states
      }
    }
    this.touch();
    return agent;
  }

  counts(): { active: number; failed: number; completed: number; blocked: number; total: number } {
    const agents = this.list();
    return {
      total: agents.length,
      active: agents.filter((agent) => agent.status === 'running' || agent.status === 'produced').length,
      blocked: agents.filter((agent) => agent.status === 'blocked').length,
      failed: agents.filter((agent) => agent.status === 'failed').length,
      completed: agents.filter((agent) => agent.status === 'done').length,
    };
  }

  snapshot(): BridgeSnapshot {
    return {
      serverUrl: this.serverUrl,
      projectDir: this.projectDir,
      primaryAgentId: this.primaryAgentId,
      runtime: this.runtime ? structuredClone(this.runtime) : undefined,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      counts: this.counts(),
      agents: this.list().map((agent) => structuredClone(agent)),
    };
  }

  private require(id: string): AgentRecord {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`unknown agent: ${id}`);
    }
    return agent;
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}
