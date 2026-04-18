import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { OpenCodeBridge, BridgeRegistry, defaultLaunchPlan, mapSessionStatus } from '../src/index.js';
class FakeProcess extends EventEmitter {
    pid;
    constructor(pid) {
        super();
        this.pid = pid;
    }
}
test('registry tracks lifecycle, artifacts, transitions, and llm config', () => {
    const registry = new BridgeRegistry('/project');
    registry.register({
        id: 'session-1',
        role: 'primary',
        name: 'primary',
        sessionId: 'session-1',
        windowId: 'window-1',
        command: 'opencode',
        args: [],
        llmConfig: { model: 'gpt-4o' },
    });
    registry.transition('session-1', 'running', 'booted', 'running');
    registry.recordArtifact('session-1', { kind: 'task', summary: 'started bridge' });
    registry.transition('session-1', 'done', 'finished', 'done');
    const snapshot = registry.snapshot();
    assert.equal(snapshot.agents[0]?.status, 'done');
    assert.equal(snapshot.agents[0]?.artifacts.at(-1)?.summary, 'started bridge');
    assert.equal(snapshot.agents[0]?.llmConfig?.model, 'gpt-4o');
    assert.equal(registry.counts().completed, 1);
    assert.deepEqual(snapshot.counts, {
        active: 0,
        blocked: 0,
        completed: 1,
        failed: 0,
        total: 1,
    });
});
test('session status mapping covers OpenCode polling states', () => {
    assert.deepEqual(mapSessionStatus({ type: 'busy' }), { status: 'running', phase: 'busy' });
    assert.deepEqual(mapSessionStatus({ type: 'retry', attempt: 2, message: 'blocked', next: 10 }), {
        status: 'blocked',
        phase: 'retry:2',
    });
    assert.deepEqual(mapSessionStatus({ type: 'idle' }), { status: 'done', phase: 'idle' });
});
test('bridge starts, routes prompts, records artifacts, persists runtime metadata, and reuses llm config on restart', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'opencode-bridge-'));
    const statePath = join(projectDir, 'state.json');
    const launches = [];
    const sessions = new Map();
    const statuses = new Map();
    const fakeClient = {
        session: {
            create: async ({ body }) => {
                const id = `session-${sessions.size + 1}`;
                const session = {
                    id,
                    title: body.title,
                    parentID: body.parentID,
                    version: '1',
                    time: { updated: Date.now() },
                    summary: { additions: 1, deletions: 0, files: 1 },
                    share: { url: `https://example.test/${id}` },
                };
                sessions.set(id, session);
                statuses.set(id, { type: 'busy' });
                return { data: session };
            },
            get: async ({ path: { id } }) => ({ data: sessions.get(id) }),
            status: async () => ({ data: Object.fromEntries(statuses.entries()) }),
            promptAsync: async ({ path: { id }, body }) => {
                const session = sessions.get(id);
                if (session) {
                    session.version = String(Number(session.version) + 1);
                    session.time.updated = Date.now();
                    session.summary = {
                        additions: session.summary?.additions ?? 0,
                        deletions: session.summary?.deletions ?? 0,
                        files: session.summary?.files ?? 0,
                    };
                }
                assert.equal(body.parts[0]?.text, 'check the bridge');
                statuses.set(id, { type: 'busy' });
                return { data: undefined };
            },
        },
    };
    const bridge = new OpenCodeBridge({
        projectDir,
        statePath,
        backendFactory: async () => ({ url: 'http://127.0.0.1:4096', close() { } }),
        clientFactory: () => fakeClient,
        launcher: (command, args, options) => {
            launches.push({ command, args, env: options.env });
            return new FakeProcess(9000 + launches.length);
        },
        pollIntervalMs: 60_000,
    });
    const snapshot = await bridge.start();
    assert.equal(snapshot.agents.length, 1);
    assert.equal(snapshot.agents[0]?.role, 'primary');
    assert.equal(snapshot.runtime?.active, true);
    assert.equal(launches.length, 1);
    const subagent = await bridge.spawnAgent({
        name: 'researcher',
        apiKey: 'secret-token',
        baseUrl: 'https://example.test',
        model: 'gpt-4o',
    });
    assert.equal(subagent.role, 'subagent');
    assert.equal(launches.length, 2);
    assert.equal(bridge.status().agents.find((agent) => agent.id === subagent.id)?.llmConfig?.model, 'gpt-4o');
    assert.equal(launches[1]?.env?.OPENAI_API_KEY, 'secret-token');
    assert.equal(launches[1]?.env?.OPENAI_BASE_URL, 'https://example.test');
    assert.equal(launches[1]?.env?.OPENCODE_MODEL, 'gpt-4o');
    await bridge.route({ agentId: subagent.id, prompt: 'check the bridge' });
    assert.equal(bridge.status().agents.find((agent) => agent.id === subagent.id)?.artifacts.at(-1)?.kind, 'task');
    statuses.set(subagent.sessionId, { type: 'idle' });
    const polled = await bridge.pollOnce();
    const updated = polled.agents.find((agent) => agent.id === subagent.id);
    assert.equal(updated?.status, 'done');
    assert.ok(updated?.artifacts.some((artifact) => artifact.kind === 'summary'));
    await bridge.markFailed(subagent.id, 'forced failure for recovery path');
    const restarted = await bridge.restartAgent(subagent.id);
    assert.equal(restarted.status, 'running');
    assert.equal(launches[2]?.env?.OPENAI_API_KEY, 'secret-token');
    assert.equal(launches[2]?.env?.OPENAI_BASE_URL, 'https://example.test');
    assert.equal(launches[2]?.env?.OPENCODE_MODEL, 'gpt-4o');
    await bridge.shutdown();
    const persisted = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(persisted.agents.find((agent) => agent.id === subagent.id)?.llmConfig?.apiKey, 'secret-token');
    assert.equal(persisted.runtime?.active, false);
});
test('default launch plan attaches each CLI to the shared backend server and includes llm env overrides', () => {
    assert.deepEqual(defaultLaunchPlan({
        projectDir: '/tmp/project',
        serverUrl: 'http://127.0.0.1:4096',
        sessionId: 'session-42',
        agentName: 'reviewer',
        role: 'subagent',
        llmConfig: { model: 'gpt-4o' },
    }), {
        command: 'opencode',
        args: ['attach', 'http://127.0.0.1:4096', '--dir', '/tmp/project', '--session=session-42'],
        env: {
            OPENCODE_AGENT_MODEL: 'gpt-4o',
            OPENCODE_MODEL: 'gpt-4o',
        },
        trackProcessExit: false,
    });
});
test('connectExisting reuses the saved backend URL when the existing runtime is still reachable', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'opencode-bridge-reuse-'));
    const statePath = join(projectDir, 'state.json');
    const savedSnapshot = {
        serverUrl: 'http://127.0.0.1:4096',
        projectDir,
        primaryAgentId: 'session-1',
        runtime: {
            runtimeId: 'runtime-1',
            ownerPid: process.pid,
            startedAt: '2026-04-16T00:00:00.000Z',
            active: true,
            serverUrl: 'http://127.0.0.1:4096',
        },
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
        counts: {
            active: 1,
            blocked: 0,
            completed: 0,
            failed: 0,
            total: 1,
        },
        agents: [
            {
                id: 'session-1',
                role: 'primary',
                name: 'primary',
                sessionId: 'session-1',
                windowId: 'window-1',
                command: 'opencode',
                args: ['attach', 'http://127.0.0.1:4096'],
                status: 'running',
                phase: 'running',
                createdAt: '2026-04-16T00:00:00.000Z',
                updatedAt: '2026-04-16T00:00:00.000Z',
                artifacts: [],
                history: [],
            },
        ],
    };
    await writeFile(statePath, `${JSON.stringify(savedSnapshot, null, 2)}\n`, 'utf8');
    let backendStarts = 0;
    const statusCalls = [];
    const bridge = new OpenCodeBridge({
        projectDir,
        statePath,
        backendFactory: async () => {
            backendStarts += 1;
            return { url: 'http://127.0.0.1:9999', close() { } };
        },
        clientFactory: ({ baseUrl }) => ({
            session: {
                status: async () => {
                    statusCalls.push(baseUrl);
                    return { data: {} };
                },
                get: async () => ({ data: { id: 'session-1' } }),
                create: async () => {
                    throw new Error('not used');
                },
                promptAsync: async () => {
                    throw new Error('not used');
                },
            },
        }),
        pollIntervalMs: 60_000,
    });
    const snapshot = await bridge.connectExisting();
    assert.equal(snapshot.serverUrl, 'http://127.0.0.1:4096');
    assert.equal(snapshot.primaryAgentId, 'session-1');
    assert.equal(snapshot.runtime?.active, true);
    assert.equal(backendStarts, 0);
    assert.deepEqual(statusCalls, ['http://127.0.0.1:4096']);
});
test('readStatus does not auto-start a backend and marks stale runtimes inactive', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'opencode-bridge-status-'));
    const statePath = join(projectDir, 'state.json');
    const savedSnapshot = {
        serverUrl: 'http://127.0.0.1:4096',
        projectDir,
        primaryAgentId: 'session-1',
        runtime: {
            runtimeId: 'runtime-1',
            ownerPid: 999999,
            startedAt: '2026-04-16T00:00:00.000Z',
            active: true,
            serverUrl: 'http://127.0.0.1:4096',
        },
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
        counts: {
            active: 1,
            blocked: 0,
            completed: 0,
            failed: 0,
            total: 1,
        },
        agents: [
            {
                id: 'session-1',
                role: 'primary',
                name: 'primary',
                sessionId: 'session-1',
                windowId: 'window-1',
                command: 'opencode',
                args: ['attach', 'http://127.0.0.1:4096'],
                status: 'running',
                phase: 'running',
                createdAt: '2026-04-16T00:00:00.000Z',
                updatedAt: '2026-04-16T00:00:00.000Z',
                artifacts: [],
                history: [],
            },
        ],
    };
    await writeFile(statePath, `${JSON.stringify(savedSnapshot, null, 2)}\n`, 'utf8');
    let backendStarts = 0;
    const bridge = new OpenCodeBridge({
        projectDir,
        statePath,
        backendFactory: async () => {
            backendStarts += 1;
            return { url: 'http://127.0.0.1:9999', close() { } };
        },
        clientFactory: () => ({
            session: {
                status: async () => {
                    throw new Error('unreachable');
                },
                get: async () => ({ data: undefined }),
                create: async () => {
                    throw new Error('not used');
                },
                promptAsync: async () => {
                    throw new Error('not used');
                },
            },
        }),
        pollIntervalMs: 60_000,
    });
    const snapshot = await bridge.readStatus();
    assert.equal(backendStarts, 0);
    assert.equal(snapshot.runtime?.active, false);
    assert.equal(snapshot.runtime?.stale, true);
});
