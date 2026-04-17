import { assertTransition, defaultPhaseForStatus } from './state-machine.js';
export class BridgeRegistry {
    agents = new Map();
    createdAt;
    updatedAt;
    serverUrl;
    primaryAgentId;
    runtime;
    projectDir;
    constructor(projectDir, snapshot) {
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
    setServerUrl(serverUrl) {
        this.serverUrl = serverUrl;
        if (this.runtime) {
            this.runtime.serverUrl = serverUrl;
        }
        this.touch();
    }
    runtimeState() {
        return this.runtime ? structuredClone(this.runtime) : undefined;
    }
    activateRuntime(runtime) {
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
    markRuntimeInactive(reason, stale = false) {
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
    register(agent) {
        const existing = this.agents.get(agent.id);
        const now = new Date().toISOString();
        const record = {
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
    get(id) {
        return this.agents.get(id);
    }
    primary() {
        if (this.primaryAgentId) {
            return this.agents.get(this.primaryAgentId);
        }
        return [...this.agents.values()].find((agent) => agent.role === 'primary');
    }
    list() {
        return [...this.agents.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    }
    transition(id, to, note, phase) {
        const agent = this.require(id);
        assertTransition(agent.status, to);
        const now = new Date().toISOString();
        const history = {
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
    syncPhase(id, phase) {
        const agent = this.require(id);
        agent.phase = phase;
        agent.updatedAt = new Date().toISOString();
        this.touch();
        return agent;
    }
    recordArtifact(id, artifact) {
        const agent = this.require(id);
        const nextArtifact = {
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
            }
            catch {
                // If already in a terminal state, keep the artifact but do not force a transition.
            }
        }
        this.touch();
        return agent;
    }
    recordExit(id, code, signal) {
        const agent = this.require(id);
        agent.exit = { code, signal, at: new Date().toISOString() };
        if (agent.status !== 'done') {
            try {
                this.transition(id, code === 0 ? 'done' : 'failed', code === 0 ? 'process exit' : 'process failure');
            }
            catch {
                // ignore invalid transitions for terminal states
            }
        }
        this.touch();
        return agent;
    }
    counts() {
        const agents = this.list();
        return {
            total: agents.length,
            active: agents.filter((agent) => agent.status === 'running' || agent.status === 'produced').length,
            blocked: agents.filter((agent) => agent.status === 'blocked').length,
            failed: agents.filter((agent) => agent.status === 'failed').length,
            completed: agents.filter((agent) => agent.status === 'done').length,
        };
    }
    snapshot() {
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
    require(id) {
        const agent = this.agents.get(id);
        if (!agent) {
            throw new Error(`unknown agent: ${id}`);
        }
        return agent;
    }
    touch() {
        this.updatedAt = new Date().toISOString();
    }
}
