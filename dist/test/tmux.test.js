/**
 * test/tmux.test.ts
 *
 * Unit tests for src/tmux.ts.
 * Uses node:test/mock to mock node:child_process so tests run without a real tmux binary.
 *
 * Per PRD_TMUX_INTEGRATION.md §8.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { _resetTmuxTestDeps, _setTmuxTestDeps } from '../src/tmux.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let restoreDeps;
afterEach(() => {
    restoreDeps?.();
    restoreDeps = undefined;
});
function setTmuxDeps(spawnSyncImpl, execFileImpl) {
    _resetTmuxTestDeps();
    _setTmuxTestDeps({
        ...(spawnSyncImpl ? { spawnSync: spawnSyncImpl } : {}),
        ...(execFileImpl ? { execFile: execFileImpl } : {}),
    });
    restoreDeps = _resetTmuxTestDeps;
}
function makeSpawnSyncMock(behavior) {
    return setTmuxDeps(behavior);
}
function makeExecFileMock(behavior) {
    return setTmuxDeps(undefined, behavior);
}
// ---------------------------------------------------------------------------
// isTmuxAvailable
// ---------------------------------------------------------------------------
test('isTmuxAvailable returns true when tmux -V exits 0', async () => {
    const { isTmuxAvailable, _resetCache } = await import('../src/tmux.js');
    _resetCache();
    makeSpawnSyncMock(() => ({ status: 0, stdout: 'tmux 3.4', stderr: '', error: undefined }));
    assert.equal(isTmuxAvailable(), true);
});
test('isTmuxAvailable returns false when tmux -V exits non-zero', async () => {
    const { isTmuxAvailable, _resetCache } = await import('../src/tmux.js');
    _resetCache();
    makeSpawnSyncMock(() => ({ status: 1, stdout: '', stderr: 'not found', error: undefined }));
    assert.equal(isTmuxAvailable(), false);
});
test('isTmuxAvailable returns false when tmux does not exist (ENOENT)', async () => {
    const { isTmuxAvailable, _resetCache } = await import('../src/tmux.js');
    _resetCache();
    const enoent = new Error('ENOENT');
    enoent.code = 'ENOENT';
    makeSpawnSyncMock(() => ({ status: 0, stdout: '', stderr: '', error: enoent }));
    assert.equal(isTmuxAvailable(), false);
});
test('isTmuxAvailable caches result — second call does not re-spawn', async () => {
    const { isTmuxAvailable, _resetCache } = await import('../src/tmux.js');
    _resetCache();
    let callCount = 0;
    makeSpawnSyncMock(() => {
        callCount++;
        return { status: 0, stdout: 'tmux 3.4', stderr: '', error: undefined };
    });
    isTmuxAvailable();
    isTmuxAvailable();
    assert.equal(callCount, 1);
});
// ---------------------------------------------------------------------------
// isInsideTmux
// ---------------------------------------------------------------------------
test('isInsideTmux returns true when TMUX env var is set', async () => {
    const original = process.env.TMUX;
    process.env.TMUX = 'session_name,12345,0';
    try {
        const { isInsideTmux } = await import('../src/tmux.js');
        assert.equal(isInsideTmux(), true);
    }
    finally {
        process.env.TMUX = original;
    }
});
test('isInsideTmux returns false when TMUX env var is absent', async () => {
    const original = process.env.TMUX;
    delete process.env.TMUX;
    try {
        const { isInsideTmux } = await import('../src/tmux.js');
        assert.equal(isInsideTmux(), false);
    }
    finally {
        process.env.TMUX = original;
    }
});
// ---------------------------------------------------------------------------
// runTmux
// ---------------------------------------------------------------------------
test('runTmux returns ok:true with stdout on success', async () => {
    const { runTmux } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 0, stdout: 'pane output', stderr: '', error: undefined }));
    const result = runTmux(['list-panes']);
    assert.equal(result.ok, true);
    assert.equal(result.stdout, 'pane output');
});
test('runTmux returns ok:false with stderr on non-zero exit', async () => {
    const { runTmux } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 1, stdout: '', stderr: 'unknown command', error: undefined }));
    const result = runTmux(['bad', 'command']);
    assert.equal(result.ok, false);
    assert.equal(result.stderr, 'unknown command');
});
test('runTmux returns ok:false when command does not exist', async () => {
    const { runTmux } = await import('../src/tmux.js');
    const enoent = new Error('ENOENT');
    enoent.code = 'ENOENT';
    makeSpawnSyncMock(() => ({ status: 0, stdout: '', stderr: '', error: enoent }));
    const result = runTmux(['nonexistent']);
    assert.equal(result.ok, false);
});
// ---------------------------------------------------------------------------
// createSplitPane
// ---------------------------------------------------------------------------
test('createSplitPane throws when not inside tmux', async () => {
    const original = process.env.TMUX;
    delete process.env.TMUX;
    try {
        const { createSplitPane } = await import('../src/tmux.js');
        assert.throws(() => createSplitPane({ cwd: '/tmp', direction: 'vertical' }), /tmux is not available|not inside/i);
    }
    finally {
        process.env.TMUX = original;
    }
});
test('createSplitPane returns paneId and target on success (vertical)', async () => {
    const original = process.env.TMUX;
    process.env.TMUX = 'session_name,12345,0';
    try {
        const { createSplitPane } = await import('../src/tmux.js');
        makeSpawnSyncMock(() => ({ status: 0, stdout: '%5\tsession_name:0.1', stderr: '', error: undefined }));
        const result = createSplitPane({ cwd: '/tmp', direction: 'vertical' });
        assert.equal(result.paneId, '%5');
        assert.equal(result.target, 'session_name:0.1');
    }
    finally {
        process.env.TMUX = original;
    }
});
test('createSplitPane uses -h for horizontal direction', async () => {
    const original = process.env.TMUX;
    process.env.TMUX = 'session_name,12345,0';
    let capturedArgs = [];
    try {
        const { createSplitPane } = await import('../src/tmux.js');
        makeSpawnSyncMock((..._args) => {
            const [, args] = _args;
            capturedArgs = args;
            return { status: 0, stdout: '%6\tsession_name:0.2', stderr: '', error: undefined };
        });
        createSplitPane({ cwd: '/tmp', direction: 'horizontal' });
        assert.ok(capturedArgs.includes('-h'), `expected -h in args: ${capturedArgs.join(' ')}`);
    }
    finally {
        process.env.TMUX = original;
    }
});
test('createSplitPane passes -l size when size is provided', async () => {
    const original = process.env.TMUX;
    process.env.TMUX = 'session_name,12345,0';
    let capturedArgs = [];
    try {
        const { createSplitPane } = await import('../src/tmux.js');
        makeSpawnSyncMock((..._args) => {
            const [, args] = _args;
            capturedArgs = args;
            return { status: 0, stdout: '%7\tsession_name:0.3', stderr: '', error: undefined };
        });
        createSplitPane({ cwd: '/tmp', size: 20 });
        assert.ok(capturedArgs.includes('-l'), `expected -l in args: ${capturedArgs.join(' ')}`);
        assert.ok(capturedArgs.includes('20'), `expected size 20 in args: ${capturedArgs.join(' ')}`);
    }
    finally {
        process.env.TMUX = original;
    }
});
test('createSplitPane passes -p percentage when percentage is provided', async () => {
    const original = process.env.TMUX;
    process.env.TMUX = 'session_name,12345,0';
    let capturedArgs = [];
    try {
        const { createSplitPane } = await import('../src/tmux.js');
        makeSpawnSyncMock((..._args) => {
            const [, args] = _args;
            capturedArgs = args;
            return { status: 0, stdout: '%8\tsession_name:0.4', stderr: '', error: undefined };
        });
        createSplitPane({ cwd: '/tmp', percentage: 30 });
        assert.ok(capturedArgs.includes('-p'), `expected -p in args: ${capturedArgs.join(' ')}`);
        assert.ok(capturedArgs.includes('30'), `expected percentage 30 in args: ${capturedArgs.join(' ')}`);
    }
    finally {
        process.env.TMUX = original;
    }
});
test('createSplitPane throws when tmux command fails', async () => {
    const original = process.env.TMUX;
    process.env.TMUX = 'session_name,12345,0';
    try {
        const { createSplitPane } = await import('../src/tmux.js');
        makeSpawnSyncMock((...args) => {
            const tmuxArgs = (args[1] ?? []);
            if (tmuxArgs[0] === '-V') {
                return { status: 0, stdout: 'tmux 3.4', stderr: '', error: undefined };
            }
            return { status: 1, stdout: '', stderr: 'split failed', error: undefined };
        });
        assert.throws(() => createSplitPane({ cwd: '/tmp' }), /createSplitPane failed/i);
    }
    finally {
        process.env.TMUX = original;
    }
});
// ---------------------------------------------------------------------------
// sendKeys
// ---------------------------------------------------------------------------
test('sendKeys sends text in literal mode and sends C-m for enter', async () => {
    const { sendKeys } = await import('../src/tmux.js');
    const capturedArgs = [];
    makeSpawnSyncMock((..._args) => {
        const [cmd, args] = _args;
        capturedArgs.push([cmd, ...args]);
        return { status: 0, stdout: '', stderr: '', error: undefined };
    });
    sendKeys({ target: '%0', text: 'hello world', enter: true, literal: true });
    assert.equal(capturedArgs.length, 2);
    const args1 = capturedArgs[0] ?? [];
    assert.ok(args1.includes('send-keys'));
    assert.ok(args1.includes('-t'));
    assert.ok(args1.includes('%0'));
    assert.ok(args1.includes('-l'));
    assert.ok(args1.includes('hello world'));
    const args2 = capturedArgs[1] ?? [];
    assert.ok(args2.includes('C-m'));
});
test('sendKeys does not send C-m when enter is false', async () => {
    const { sendKeys } = await import('../src/tmux.js');
    const capturedArgs = [];
    makeSpawnSyncMock((..._args) => {
        const [cmd, args] = _args;
        capturedArgs.push([cmd, ...args]);
        return { status: 0, stdout: '', stderr: '', error: undefined };
    });
    sendKeys({ target: '%0', text: 'hello', enter: false });
    assert.equal(capturedArgs.length, 1);
});
test('sendKeys omits -l flag when literal is false', async () => {
    const { sendKeys } = await import('../src/tmux.js');
    let capturedArgs = [];
    makeSpawnSyncMock((..._args) => {
        const [, args] = _args;
        capturedArgs = args;
        return { status: 0, stdout: '', stderr: '', error: undefined };
    });
    sendKeys({ target: '%0', text: 'hello', literal: false });
    assert.ok(!capturedArgs.includes('-l'), `expected no -l flag: ${capturedArgs.join(' ')}`);
});
// ---------------------------------------------------------------------------
// capturePane
// ---------------------------------------------------------------------------
test('capturePane returns captured text on success', async () => {
    const { capturePane } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 0, stdout: 'line1\nline2\nline3', stderr: '', error: undefined }));
    const result = capturePane('%0', 50);
    assert.equal(result, 'line1\nline2\nline3');
});
test('capturePane returns null on failure', async () => {
    const { capturePane } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 1, stdout: '', stderr: 'not found', error: undefined }));
    const result = capturePane('%999', 50);
    assert.equal(result, null);
});
// ---------------------------------------------------------------------------
// waitForPaneReady
// ---------------------------------------------------------------------------
test('waitForPaneReady resolves true when readinessCheck returns true', async () => {
    const { waitForPaneReady } = await import('../src/tmux.js');
    let pollCount = 0;
    makeSpawnSyncMock(() => {
        pollCount++;
        const output = pollCount >= 3 ? '$ ' : 'loading...';
        return { status: 0, stdout: output, stderr: '', error: undefined };
    });
    const result = await waitForPaneReady('%0', 5000, (c) => c.includes('$'));
    assert.equal(result, true);
});
test('waitForPaneReady resolves false on timeout', async () => {
    const { waitForPaneReady } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 0, stdout: 'still loading...', stderr: '', error: undefined }));
    const result = await waitForPaneReady('%0', 200);
    assert.equal(result, false);
});
test('waitForPaneReady uses custom readinessCheck', async () => {
    const { waitForPaneReady } = await import('../src/tmux.js');
    let pollCount = 0;
    makeSpawnSyncMock(() => {
        pollCount++;
        return { status: 0, stdout: pollCount >= 2 ? 'READY' : 'waiting', stderr: '', error: undefined };
    });
    const result = await waitForPaneReady('%0', 5000, (c) => c.includes('READY'));
    assert.equal(result, true);
});
// ---------------------------------------------------------------------------
// killPane
// ---------------------------------------------------------------------------
test('killPane returns true when paneId starts with % and command succeeds', async () => {
    const { killPane } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 0, stdout: '', stderr: '', error: undefined }));
    const result = killPane('%5');
    assert.equal(result, true);
});
test('killPane returns false when paneId does not start with %', async () => {
    const { killPane } = await import('../src/tmux.js');
    const result = killPane('not-a-pane-id');
    assert.equal(result, false);
});
test('killPane returns false when tmux command fails', async () => {
    const { killPane } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 1, stdout: '', stderr: 'pane not found', error: undefined }));
    const result = killPane('%999');
    assert.equal(result, false);
});
// ---------------------------------------------------------------------------
// isPaneAlive
// ---------------------------------------------------------------------------
test('isPaneAlive returns true when pane_dead=0 and pid is alive', async () => {
    const { isPaneAlive } = await import('../src/tmux.js');
    // Mock the kill check to avoid actually killing processes in tests
    let killCalled = false;
    const originalKill = process.kill;
    // @ts-ignore - test override
    process.kill = (pid, sig) => {
        if (sig === 0) {
            killCalled = true;
            return;
        }
        return originalKill(pid, sig);
    };
    makeSpawnSyncMock(() => ({ status: 0, stdout: '0 12345', stderr: '', error: undefined }));
    const result = isPaneAlive('%0');
    process.kill = originalKill;
    assert.equal(result, true);
});
test('isPaneAlive returns false when pane_dead=1', async () => {
    const { isPaneAlive } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 0, stdout: '1 0', stderr: '', error: undefined }));
    const result = isPaneAlive('%0');
    assert.equal(result, false);
});
test('isPaneAlive returns false when pane does not exist', async () => {
    const { isPaneAlive } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 1, stdout: '', stderr: 'pane not found', error: undefined }));
    const result = isPaneAlive('%999');
    assert.equal(result, false);
});
// ---------------------------------------------------------------------------
// shellQuote
// ---------------------------------------------------------------------------
test('shellQuote wraps value in single quotes and escapes internal single quotes', async () => {
    const { shellQuote } = await import('../src/tmux.js');
    assert.equal(shellQuote("it's"), "'it'\"'\"'s'");
    assert.equal(shellQuote('hello'), "'hello'");
    assert.equal(shellQuote(''), "''");
});
// ---------------------------------------------------------------------------
// buildEnvPrefix
// ---------------------------------------------------------------------------
test('buildEnvPrefix converts env object to shell prefix string', async () => {
    const { buildEnvPrefix } = await import('../src/tmux.js');
    const result = buildEnvPrefix({ FOO: 'bar', BAZ: 'qux' });
    assert.match(result, /FOO='bar'/);
    assert.match(result, /BAZ='qux'/);
});
test('buildEnvPrefix skips undefined values', async () => {
    const { buildEnvPrefix } = await import('../src/tmux.js');
    const result = buildEnvPrefix({ FOO: 'bar', BAZ: undefined });
    assert.match(result, /FOO='bar'/);
    assert.doesNotMatch(result, /BAZ/);
});
// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------
test('delay resolves after approximately the specified ms', async () => {
    const { delay } = await import('../src/tmux.js');
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `expected ~50ms, got ${elapsed}ms`);
});
// ---------------------------------------------------------------------------
// listSessions / hasSession / killSession
// ---------------------------------------------------------------------------
test('listSessions returns array of session names', async () => {
    const { listSessions } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({
        status: 0,
        stdout: 'session-1\nsession-2\n',
        stderr: '',
        error: undefined,
    }));
    const result = listSessions();
    assert.deepEqual(result, ['session-1', 'session-2']);
});
test('listSessions returns empty array on failure', async () => {
    const { listSessions } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 1, stdout: '', stderr: 'no sessions', error: undefined }));
    const result = listSessions();
    assert.deepEqual(result, []);
});
test('hasSession returns true when session exists', async () => {
    const { hasSession } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 0, stdout: 'session-1', stderr: '', error: undefined }));
    assert.equal(hasSession('session-1'), true);
});
test('hasSession returns false when session does not exist', async () => {
    const { hasSession } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 1, stdout: '', stderr: 'failed', error: undefined }));
    assert.equal(hasSession('nonexistent'), false);
});
test('killSession returns true on success', async () => {
    const { killSession } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 0, stdout: '', stderr: '', error: undefined }));
    assert.equal(killSession('session-1'), true);
});
test('killSession returns false on failure', async () => {
    const { killSession } = await import('../src/tmux.js');
    makeSpawnSyncMock(() => ({ status: 1, stdout: '', stderr: 'failed', error: undefined }));
    assert.equal(killSession('nonexistent'), false);
});
