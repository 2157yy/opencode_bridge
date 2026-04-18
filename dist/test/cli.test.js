import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.js';
import { OpenCodeBridge } from '../src/index.js';
const emptySnapshot = {
    projectDir: '/tmp/project',
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    counts: {
        active: 0,
        blocked: 0,
        completed: 0,
        failed: 0,
        total: 0,
    },
    agents: [],
};
function makeFakeBridge(calls, overrides = {}) {
    return {
        async start() {
            calls.push('start');
            return emptySnapshot;
        },
        async connectExisting() {
            calls.push('connectExisting');
            return emptySnapshot;
        },
        async shutdown() {
            calls.push('shutdown');
        },
        async stop() {
            calls.push('stop');
            return emptySnapshot;
        },
        async readStatus() {
            calls.push('readStatus');
            return emptySnapshot;
        },
        async spawnAgent() {
            throw new Error('not used');
        },
        async route() {
            throw new Error('not used');
        },
        async restartAgent() {
            throw new Error('not used');
        },
        ...overrides,
    };
}
test('start command keeps the bridge alive until shutdown is requested', async () => {
    const calls = [];
    const output = [];
    await runCli(['start', '--project', '/tmp/project'], {
        createBridge: () => makeFakeBridge(calls),
        write: (value) => output.push(value),
        waitForShutdownSignal: async () => {
            calls.push('wait');
        },
    });
    assert.deepEqual(calls, ['start', 'wait', 'shutdown']);
    assert.equal(output.length, 1);
    assert.match(output[0] ?? '', /"projectDir": "\/tmp\/project"/);
});
test('status command reads status without auto-starting or shutting down the bridge', async () => {
    const calls = [];
    await runCli(['status', '--project', '/tmp/project'], {
        createBridge: () => makeFakeBridge(calls),
        write: () => undefined,
    });
    assert.deepEqual(calls, ['readStatus']);
});
test('spawn command connects to existing runtime, forwards llm config, and redacts apiKey', async () => {
    const calls = [];
    const output = [];
    let spawnArgs;
    await runCli([
        'spawn',
        '--project',
        '/tmp/project',
        '--name',
        'researcher',
        '--api-key',
        'super-secret',
        '--base-url',
        'https://example.test',
        '--model',
        'gpt-4o',
    ], {
        createBridge: () => makeFakeBridge(calls, {
            async spawnAgent(args) {
                calls.push('spawnAgent');
                spawnArgs = args;
                return {
                    id: 'session-1',
                    role: 'subagent',
                    name: 'researcher',
                    sessionId: 'session-1',
                    windowId: 'session-1',
                    command: 'opencode',
                    args: [],
                    status: 'running',
                    phase: 'running',
                    createdAt: emptySnapshot.createdAt,
                    updatedAt: emptySnapshot.updatedAt,
                    llmConfig: {
                        apiKey: 'super-secret',
                        baseUrl: 'https://example.test',
                        model: 'gpt-4o',
                    },
                    artifacts: [],
                    history: [],
                };
            },
        }),
        write: (value) => output.push(value),
    });
    assert.deepEqual(calls, ['connectExisting', 'spawnAgent']);
    assert.deepEqual(spawnArgs, {
        name: 'researcher',
        role: 'subagent',
        apiKey: 'super-secret',
        baseUrl: 'https://example.test',
        model: 'gpt-4o',
    });
    assert.match(output[0] ?? '', /"model": "gpt-4o"/);
    assert.doesNotMatch(output[0] ?? '', /super-secret/);
});
test('stop command delegates to bridge.stop', async () => {
    const calls = [];
    await runCli(['stop', '--project', '/tmp/project'], {
        createBridge: () => makeFakeBridge(calls),
        write: () => undefined,
    });
    assert.deepEqual(calls, ['stop']);
});
class FakeProcess extends EventEmitter {
    pid;
    constructor(pid) {
        super();
        this.pid = pid;
    }
}
test('restartAgent relaunches a registered agent and clears stale exit state', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'opencode-bridge-cli-'));
    const launches = [];
    const processes = [];
    const sessions = new Map();
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
                };
                sessions.set(id, session);
                return { data: session };
            },
            get: async ({ path: { id } }) => ({ data: sessions.get(id) }),
            status: async () => ({ data: {} }),
            promptAsync: async () => ({ data: undefined }),
        },
    };
    const bridge = new OpenCodeBridge({
        projectDir,
        statePath: join(projectDir, 'state.json'),
        backendFactory: async () => ({ url: 'http://127.0.0.1:4096', close() { } }),
        clientFactory: () => fakeClient,
        launcher: (command, args, options) => {
            launches.push({ command, args, env: options.env });
            const proc = new FakeProcess(5_000 + launches.length);
            processes.push(proc);
            return proc;
        },
        launchPlanFactory: (options) => ({
            command: 'opencode',
            args: ['attach', 'http://127.0.0.1:4096', '--dir', options.projectDir, `--session=${options.sessionId}`],
            trackProcessExit: true,
            env: {
                ...(options.llmConfig?.apiKey ? { OPENAI_API_KEY: options.llmConfig.apiKey } : {}),
                ...(options.llmConfig?.baseUrl ? { OPENAI_BASE_URL: options.llmConfig.baseUrl } : {}),
                ...(options.llmConfig?.model ? { OPENCODE_AGENT_MODEL: options.llmConfig.model } : {}),
                ...(options.llmConfig?.model ? { OPENCODE_MODEL: options.llmConfig.model } : {}),
            },
        }),
        pollIntervalMs: 60_000,
    });
    await bridge.start();
    const subagent = await bridge.spawnAgent({ name: 'researcher', model: 'gpt-4o' });
    assert.equal(bridge.status().agents.find((agent) => agent.id === subagent.id)?.status, 'running');
    assert.equal(bridge.status().agents.find((agent) => agent.id === subagent.id)?.llmConfig?.model, 'gpt-4o');
    const launchedBeforeExit = launches.length;
    processes.at(-1)?.emit('exit', 1, null);
    await new Promise((resolve) => setImmediate(resolve));
    const failed = bridge.status().agents.find((agent) => agent.id === subagent.id);
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.exit?.code, 1);
    const restarted = await bridge.restartAgent(subagent.id);
    assert.equal(launches.length, launchedBeforeExit + 1);
    assert.equal(restarted.status, 'running');
    assert.equal(restarted.phase, 'running');
    assert.equal(restarted.exit, undefined);
    assert.equal(launches.at(-1)?.command, 'opencode');
    assert.deepEqual(launches.at(-1)?.args, [
        'attach',
        'http://127.0.0.1:4096',
        '--dir',
        projectDir,
        `--session=${subagent.sessionId}`,
    ]);
    assert.equal(launches.at(-1)?.env?.OPENCODE_AGENT_MODEL, 'gpt-4o');
    assert.equal(launches.at(-1)?.env?.OPENCODE_MODEL, 'gpt-4o');
    await bridge.shutdown();
});
