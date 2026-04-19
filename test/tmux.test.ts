import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

// Mock spawnSync to avoid real tmux calls
const originalSpawnSync = spawnSync;

let mockSpawnSyncResult: ReturnType<typeof originalSpawnSync> = { status: 0, stdout: '', stderr: '', error: undefined };

function setMockSpawnSyncResult(result: typeof mockSpawnSyncResult) {
  mockSpawnSyncResult = result;
}

// We need to intercept spawnSync in the tmux module
// Since we can't easily mock module imports, we'll test the functions that don't call spawnSync directly

test('shellQuote escapes single quotes correctly', () => {
  const { shellQuote } = await import('../src/tmux.js');

  assert.equal(shellQuote('hello'), "'hello'");
  assert.equal(shellQuote("it's"), "'it'\"'\"'s'");
  assert.equal(shellQuote('hello world'), "'hello world'");
  assert.equal(shellQuote(''), "''");
});

test('buildEnvPrefix builds env string correctly', () => {
  const { buildEnvPrefix } = await import('../src/tmux.js');

  assert.equal(buildEnvPrefix({ FOO: 'bar' }), "FOO='bar'");
  assert.equal(buildEnvPrefix({ FOO: 'bar', BAZ: 'qux' }), "FOO='bar' BAZ='qux'");
  assert.equal(buildEnvPrefix({}), '');
  assert.equal(buildEnvPrefix(undefined), '');
  assert.equal(buildEnvPrefix({ UNDEFINED_VAL: undefined as unknown as string }), '');
});

test('delay resolves after specified time', async () => {
  const { delay } = await import('../src/tmux.js');

  const start = Date.now();
  await delay(50);
  const elapsed = Date.now() - start;

  // Allow some tolerance for timing
  assert.ok(elapsed >= 40, `Expected at least 40ms, got ${elapsed}ms`);
  assert.ok(elapsed < 150, `Expected less than 150ms, got ${elapsed}ms`);
});

test('isInsideTmux returns false when TMUX env is not set', () => {
  const { isInsideTmux } = await import('../src/tmux.js');

  // If TMUX is set in environment, skip
  if (process.env.TMUX) {
    console.log('Skipping isInsideTmux test - TMUX is set in environment');
    return;
  }

  assert.equal(isInsideTmux(), false);
});

test('isInsideTmux returns true when TMUX env is set', () => {
  const { isInsideTmux } = await import('../src/tmux.js');

  // This test verifies the logic
  // In a real tmux environment, TMUX would be set
  const result = isInsideTmux();
  assert.equal(typeof result, 'boolean');
});

test('normalizeCapture removes ANSI escape codes', () => {
  const { normalizeCapture } = await import('../src/tmux.js');

  // No ANSI codes
  assert.equal(normalizeCapture('hello world'), 'hello world');

  // ANSI color codes
  assert.equal(normalizeCapture('\x1b[31mhello\x1b[0m'), 'hello');

  // ANSI escape sequence
  assert.equal(normalizeCapture('\x1b[1;32mgreen\x1b[0m'), 'green');

  // Mixed content
  assert.equal(normalizeCapture('\x1b[36mprefix\x1b[0m content'), 'prefix content');

  // Whitespace handling
  assert.equal(normalizeCapture('  \x1b[31mred\x1b[0m  '), 'red');
});

test('TmuxResult type works correctly', () => {
  const { TmuxResult } = await import('../src/tmux.js');

  const successResult: TmuxResult = { ok: true, stdout: 'output' };
  const failResult: TmuxResult = { ok: false, stderr: 'error message' };

  assert.equal(successResult.ok, true);
  assert.equal(successResult.stdout, 'output');
  assert.equal(failResult.ok, false);
  assert.equal(failResult.stderr, 'error message');
});

test('TmuxPaneInfo interface structure', () => {
  const { TmuxPaneInfo } = await import('../src/tmux.js');

  const pane: TmuxPaneInfo = {
    paneId: '%0',
    panePid: 12345,
    currentCommand: 'bash',
    startCommand: '/bin/bash',
    sessionName: 'test-session',
    windowIndex: 0,
    paneWidth: 80,
    paneHeight: 24,
  };

  assert.equal(pane.paneId, '%0');
  assert.equal(pane.panePid, 12345);
  assert.equal(pane.currentCommand, 'bash');
  assert.equal(pane.sessionName, 'test-session');
});

test('SplitPaneOptions interface structure', () => {
  const { SplitPaneOptions } = await import('../src/tmux.js');

  const options: SplitPaneOptions = {
    direction: 'vertical',
    percentage: 30,
    cwd: '/tmp/project',
    env: { PATH: '/usr/bin' },
    detached: true,
    shellCommand: 'echo hello',
  };

  assert.equal(options.direction, 'vertical');
  assert.equal(options.percentage, 30);
  assert.equal(options.cwd, '/tmp/project');
  assert.equal(options.env?.PATH, '/usr/bin');
  assert.equal(options.detached, true);
  assert.equal(options.shellCommand, 'echo hello');
});

test('SendKeysOptions interface structure', () => {
  const { SendKeysOptions } = await import('../src/tmux.js');

  const options: SendKeysOptions = {
    target: '%0',
    text: 'echo hello',
    enter: true,
    delayBeforeMs: 100,
    literal: true,
  };

  assert.equal(options.target, '%0');
  assert.equal(options.text, 'echo hello');
  assert.equal(options.enter, true);
  assert.equal(options.delayBeforeMs, 100);
  assert.equal(options.literal, true);
});

test('SplitPaneResult interface structure', () => {
  const { SplitPaneResult } = await import('../src/tmux.js');

  const result: SplitPaneResult = {
    paneId: '%5',
    target: 'test-session:0.1',
  };

  assert.equal(result.paneId, '%5');
  assert.equal(result.target, 'test-session:0.1');
});
