import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.js';
import { OpenCodeBridge } from '../src/index.js';
const baseSnapshot = {
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
class FakeProcess extends EventEmitter {
    pid;
    constructor(pid) {
        super();
        this.pid = pid;
    }
}
test('status command avoids implicit bridge lifecycle changes', async () => {
    const calls = [];
    const output = [];
    const fakeBridge = {
        async start() {
            calls.push('start');
            return baseSnapshot;
        },
        async connectExisting() {
            calls.push('connectExisting');
            return baseSnapshot;
        },
        async shutdown() {
            calls.push('shutdown');
        },
        async readStatus() {
            calls.push('readStatus');
            return {
                ...baseSnapshot,
                runtime: {
                    active: false,
                    stale: true,
                },
            };
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
        async stop() {
            throw new Error('not used');
        },
    };
    await runCli(['status', '--project', '/tmp/project'], {
        createBridge: () => fakeBridge,
        write: (value) => output.push(value),
    });
    assert.ok(calls.includes('readStatus'));
    assert.ok(!calls.includes('start'), `status should not start the backend: ${calls.join(', ')}`);
    assert.ok(!calls.includes('shutdown'), `status should not shut the backend down: ${calls.join(', ')}`);
    assert.equal(output.length, 1);
    assert.match(output[0] ?? '', /"stale": true/);
});
test('status output includes model but does not expose raw api keys', async () => {
    const output = [];
    const fakeBridge = {
        async start() {
            throw new Error('not used');
        },
        async connectExisting() {
            return baseSnapshot;
        },
        async shutdown() {
            throw new Error('not used');
        },
        async readStatus() {
            return {
                ...baseSnapshot,
                agents: [
                    {
                        id: 'session-2',
                        role: 'subagent',
                        name: 'researcher',
                        sessionId: 'session-2',
                        windowId: 'window-2',
                        command: 'opencode',
                        args: ['attach'],
                        status: 'running',
                        phase: 'running',
                        createdAt: '2026-04-16T00:00:00.000Z',
                        updatedAt: '2026-04-16T00:00:00.000Z',
                        artifacts: [],
                        history: [],
                        llmConfig: {
                            apiKey: 'sk-secret-123',
                            baseUrl: 'https://llm.example.test',
                            model: 'gpt-4o',
                        },
                    },
                ],
            };
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
        async stop() {
            throw new Error('not used');
        },
    };
    await runCli(['status', '--project', '/tmp/project'], {
        createBridge: () => fakeBridge,
        write: (value) => output.push(value),
    });
    assert.equal(output.length, 1);
    assert.match(output[0] ?? '', /"model": "gpt-4o"/);
    assert.doesNotMatch(output[0] ?? '', /sk-secret-123/);
    assert.match(output[0] ?? '', /"apiKey": "sk\*\*\*23"/);
});
test('spawn command reuses the active runtime and forwards per-agent llm config', async () => {
    const calls = [];
    const output = [];
    let spawnOptions;
    const fakeBridge = {
        async start() {
            calls.push('start');
            return baseSnapshot;
        },
        async connectExisting() {
            calls.push('connectExisting');
            return baseSnapshot;
        },
        async shutdown() {
            calls.push('shutdown');
        },
        async readStatus() {
            calls.push('readStatus');
            return baseSnapshot;
        },
        async spawnAgent(options) {
            calls.push('spawnAgent');
            spawnOptions = options;
            return {
                id: 'session-2',
                role: 'subagent',
                name: 'researcher',
                sessionId: 'session-2',
                windowId: 'window-2',
                command: 'opencode',
                args: ['attach'],
                status: 'running',
                phase: 'running',
                createdAt: '2026-04-16T00:00:00.000Z',
                updatedAt: '2026-04-16T00:00:00.000Z',
                artifacts: [],
                history: [],
                llmConfig: {
                    apiKey: 'sk-test',
                    baseUrl: 'https://llm.example.test',
                    model: 'gpt-4o',
                },
            };
        },
        async route() {
            throw new Error('not used');
        },
        async restartAgent() {
            throw new Error('not used');
        },
        async stop() {
            throw new Error('not used');
        },
    };
    await runCli([
        'spawn',
        '--project',
        '/tmp/project',
        '--name',
        'researcher',
        '--api-key',
        'sk-test',
        '--base-url',
        'https://llm.example.test',
        '--model',
        'gpt-4o',
    ], {
        createBridge: () => fakeBridge,
        write: (value) => output.push(value),
    });
    assert.ok(!calls.includes('start'), `spawn should not auto-start the backend: ${calls.join(', ')}`);
    assert.ok(!calls.includes('shutdown'), `spawn should not auto-shutdown the backend: ${calls.join(', ')}`);
    assert.deepEqual(spawnOptions, {
        name: 'researcher',
        role: 'subagent',
        apiKey: 'sk-test',
        baseUrl: 'https://llm.example.test',
        model: 'gpt-4o',
    });
    assert.equal(output.length, 1);
    assert.match(output[0] ?? '', /"model": "gpt-4o"/);
});
test('spawn fails against inactive runtime without implicit recovery', async () => {
    const calls = [];
    const fakeBridge = {
        async start() {
            calls.push('start');
            return baseSnapshot;
        },
        async connectExisting() {
            calls.push('connectExisting');
            throw new Error('no active runtime');
        },
        async shutdown() {
            calls.push('shutdown');
        },
        async readStatus() {
            calls.push('readStatus');
            return baseSnapshot;
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
        async stop() {
            throw new Error('not used');
        },
    };
    await assert.rejects(() => runCli(['spawn', '--project', '/tmp/project', '--name', 'researcher'], {
        createBridge: () => fakeBridge,
    }), /no active runtime/);
    assert.ok(!calls.includes('start'), `spawn should not recover by auto-starting: ${calls.join(', ')}`);
    assert.ok(!calls.includes('shutdown'), `spawn should not shutdown after failed connect: ${calls.join(', ')}`);
});
test('route command reuses the active runtime without implicit startup or shutdown', async () => {
    const calls = [];
    const output = [];
    let routeOptions;
    const fakeBridge = {
        async start() {
            calls.push('start');
            return baseSnapshot;
        },
        async connectExisting() {
            calls.push('connectExisting');
            return baseSnapshot;
        },
        async shutdown() {
            calls.push('shutdown');
        },
        async readStatus() {
            calls.push('readStatus');
            return baseSnapshot;
        },
        async spawnAgent() {
            throw new Error('not used');
        },
        async route(options) {
            calls.push('route');
            routeOptions = options;
            return {
                id: 'session-2',
                role: 'subagent',
                name: 'researcher',
                sessionId: 'session-2',
                windowId: 'window-2',
                command: 'opencode',
                args: ['attach'],
                status: 'running',
                phase: 'running',
                createdAt: '2026-04-16T00:00:00.000Z',
                updatedAt: '2026-04-16T00:00:00.000Z',
                artifacts: [],
                history: [],
            };
        },
        async restartAgent() {
            throw new Error('not used');
        },
        async stop() {
            throw new Error('not used');
        },
    };
    await runCli(['route', '--project', '/tmp/project', '--agent', 'session-2', '--text', 'inspect'], {
        createBridge: () => fakeBridge,
        write: (value) => output.push(value),
    });
    assert.ok(!calls.includes('start'), `route should not auto-start the backend: ${calls.join(', ')}`);
    assert.ok(!calls.includes('shutdown'), `route should not auto-shutdown the backend: ${calls.join(', ')}`);
    assert.deepEqual(routeOptions, {
        agentId: 'session-2',
        prompt: 'inspect',
    });
    assert.equal(output.length, 1);
    assert.match(output[0] ?? '', /"id": "session-2"/);
});
test('route fails against inactive runtime without implicit recovery', async () => {
    const calls = [];
    const fakeBridge = {
        async start() {
            calls.push('start');
            return baseSnapshot;
        },
        async connectExisting() {
            calls.push('connectExisting');
            throw new Error('no active runtime');
        },
        async shutdown() {
            calls.push('shutdown');
        },
        async readStatus() {
            calls.push('readStatus');
            return baseSnapshot;
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
        async stop() {
            throw new Error('not used');
        },
    };
    await assert.rejects(() => runCli(['route', '--project', '/tmp/project', '--agent', 'session-2', '--text', 'inspect'], {
        createBridge: () => fakeBridge,
    }), /no active runtime/);
    assert.ok(!calls.includes('start'), `route should not recover by auto-starting: ${calls.join(', ')}`);
    assert.ok(!calls.includes('shutdown'), `route should not shutdown after failed connect: ${calls.join(', ')}`);
});
test('restart command reuses the active runtime without implicit startup or shutdown', async () => {
    const calls = [];
    const output = [];
    const fakeBridge = {
        async start() {
            calls.push('start');
            return baseSnapshot;
        },
        async connectExisting() {
            calls.push('connectExisting');
            return baseSnapshot;
        },
        async shutdown() {
            calls.push('shutdown');
        },
        async readStatus() {
            calls.push('readStatus');
            return baseSnapshot;
        },
        async spawnAgent() {
            throw new Error('not used');
        },
        async route() {
            throw new Error('not used');
        },
        async restartAgent(agentId) {
            calls.push('restartAgent');
            return {
                id: agentId,
                role: 'subagent',
                name: 'researcher',
                sessionId: agentId,
                windowId: 'window-2',
                command: 'opencode',
                args: ['attach'],
                status: 'running',
                phase: 'running',
                createdAt: '2026-04-16T00:00:00.000Z',
                updatedAt: '2026-04-16T00:00:00.000Z',
                artifacts: [],
                history: [],
            };
        },
        async stop() {
            throw new Error('not used');
        },
    };
    await runCli(['restart', '--project', '/tmp/project', '--agent', 'session-2'], {
        createBridge: () => fakeBridge,
        write: (value) => output.push(value),
    });
    assert.ok(!calls.includes('start'), `restart should not auto-start the backend: ${calls.join(', ')}`);
    assert.ok(!calls.includes('shutdown'), `restart should not auto-shutdown the backend: ${calls.join(', ')}`);
    assert.ok(calls.includes('restartAgent'));
    assert.equal(output.length, 1);
    assert.match(output[0] ?? '', /"id": "session-2"/);
});
test('restart fails against inactive runtime without implicit recovery', async () => {
    const calls = [];
    const fakeBridge = {
        async start() {
            calls.push('start');
            return baseSnapshot;
        },
        async connectExisting() {
            calls.push('connectExisting');
            throw new Error('no active runtime');
        },
        async shutdown() {
            calls.push('shutdown');
        },
        async readStatus() {
            calls.push('readStatus');
            return baseSnapshot;
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
        async stop() {
            throw new Error('not used');
        },
    };
    await assert.rejects(() => runCli(['restart', '--project', '/tmp/project', '--agent', 'session-2'], {
        createBridge: () => fakeBridge,
    }), /no active runtime/);
    assert.ok(!calls.includes('start'), `restart should not recover by auto-starting: ${calls.join(', ')}`);
    assert.ok(!calls.includes('shutdown'), `restart should not shutdown after failed connect: ${calls.join(', ')}`);
});
test('stop command delegates to strict bridge shutdown semantics', async () => {
    const calls = [];
    const output = [];
    const fakeBridge = {
        async start() {
            calls.push('start');
            return baseSnapshot;
        },
        async shutdown() {
            calls.push('shutdown');
        },
        async stop() {
            calls.push('stop');
            return {
                ...baseSnapshot,
                runtime: {
                    active: false,
                    stale: false,
                },
            };
        },
        async readStatus() {
            calls.push('readStatus');
            return baseSnapshot;
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
    };
    await runCli(['stop', '--project', '/tmp/project'], {
        createBridge: () => fakeBridge,
        write: (value) => output.push(value),
    });
    assert.deepEqual(calls, ['stop']);
    assert.equal(output.length, 1);
    assert.match(output[0] ?? '', /"active": false/);
});
test('stop command preserves strict no-active-runtime failures', async () => {
    const fakeBridge = {
        async start() {
            throw new Error('not used');
        },
        async shutdown() {
            throw new Error('not used');
        },
        async stop() {
            throw new Error('no active runtime to stop');
        },
        async readStatus() {
            throw new Error('not used');
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
    };
    await assert.rejects(() => runCli(['stop', '--project', '/tmp/project'], {
        createBridge: () => fakeBridge,
    }), /no active runtime to stop/);
});
test('spawnAgent persists llm config in state and forwards it to the launch plan', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'opencode-bridge-llm-'));
    const launchOptions = [];
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
        launcher: () => new FakeProcess(7_001),
        launchPlanFactory: ((options) => {
            launchOptions.push(options);
            return {
                command: 'opencode',
                args: ['attach', 'http://127.0.0.1:4096'],
            };
        }),
        pollIntervalMs: 60_000,
    });
    await bridge.start();
    const subagent = await bridge.spawnAgent({
        name: 'researcher',
        apiKey: 'sk-test',
        baseUrl: 'https://llm.example.test',
        model: 'gpt-4o',
    });
    const persisted = bridge.status().agents.find((agent) => agent.id === subagent.id);
    const launch = launchOptions.at(-1);
    assert.equal(launch?.projectDir, projectDir);
    assert.equal(launch?.serverUrl, 'http://127.0.0.1:4096');
    assert.equal(launch?.sessionId, subagent.sessionId);
    assert.equal(launch?.agentName, 'researcher');
    assert.equal(launch?.role, 'subagent');
    assert.deepEqual(launch?.llmConfig, {
        apiKey: 'sk-test',
        baseUrl: 'https://llm.example.test',
        model: 'gpt-4o',
    });
    assert.deepEqual(persisted?.llmConfig, {
        apiKey: 'sk-test',
        baseUrl: 'https://llm.example.test',
        model: 'gpt-4o',
    });
});
test('persist preserves agents written by another CLI process', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'opencode-bridge-merge-'));
    const statePath = join(projectDir, 'state.json');
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
        statePath,
        backendFactory: async () => ({ url: 'http://127.0.0.1:4096', close() { } }),
        clientFactory: () => fakeClient,
        launcher: () => new FakeProcess(9_001),
        launchPlanFactory: () => ({
            command: 'opencode',
            args: ['attach', 'http://127.0.0.1:4096'],
        }),
        pollIntervalMs: 60_000,
    });
    await bridge.start();
    const subagent = await bridge.spawnAgent({ name: 'researcher' });
    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    const externalId = 'session-external';
    await writeFile(statePath, JSON.stringify({
        ...saved,
        updatedAt: '2026-04-16T23:59:59.000Z',
        counts: {
            ...saved.counts,
            total: saved.counts.total + 1,
            active: saved.counts.active + 1,
        },
        agents: [
            ...saved.agents,
            {
                ...saved.agents.find((agent) => agent.id === subagent.id),
                id: externalId,
                sessionId: externalId,
                windowId: externalId,
                name: 'external',
                createdAt: '2026-04-16T23:59:59.000Z',
                updatedAt: '2026-04-16T23:59:59.000Z',
            },
        ],
    }, null, 2));
    await bridge.recordArtifact(subagent.id, 'keep alive');
    const merged = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(merged.agents.some((agent) => agent.id === externalId), true, 'external agent should survive a later persist from another process');
    assert.equal(merged.agents.some((agent) => agent.id === subagent.id), true, 'original agent should still be present after merge');
});
test('restartAgent reuses persisted llm config for relaunch', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'opencode-bridge-restart-llm-'));
    const launchOptions = [];
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
        launcher: () => new FakeProcess(8_001),
        launchPlanFactory: ((options) => {
            launchOptions.push(options);
            return {
                command: 'opencode',
                args: ['attach', 'http://127.0.0.1:4096'],
            };
        }),
        pollIntervalMs: 60_000,
    });
    await bridge.start();
    const subagent = await bridge.spawnAgent({
        name: 'researcher',
        apiKey: 'sk-test',
        baseUrl: 'https://llm.example.test',
        model: 'gpt-4o',
    });
    launchOptions.length = 0;
    await bridge.restartAgent(subagent.id);
    assert.equal(launchOptions.length, 1);
    const relaunch = launchOptions[0];
    assert.equal(relaunch?.projectDir, projectDir);
    assert.equal(relaunch?.serverUrl, 'http://127.0.0.1:4096');
    assert.equal(relaunch?.sessionId, subagent.sessionId);
    assert.equal(relaunch?.agentName, 'researcher');
    assert.equal(relaunch?.role, 'subagent');
    assert.deepEqual(relaunch?.llmConfig, {
        apiKey: 'sk-test',
        baseUrl: 'https://llm.example.test',
        model: 'gpt-4o',
    });
});
