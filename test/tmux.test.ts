import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shellQuote,
  buildEnvPrefix,
  delay,
  normalizeCapture,
  isInsideTmux,
  isTmuxAvailable,
} from '../src/tmux.js';
import type { TmuxResult, TmuxPaneInfo, SplitPaneOptions, SendKeysOptions, SplitPaneResult } from '../src/tmux.js';

test('shellQuote escapes single quotes correctly', () => {
  assert.equal(shellQuote('hello'), "'hello'");
  // shellQuote uses shell escaping: 'it'"'"'s' means: 'it' + " (end quote) + ' (single quote) + " (start quote) + 's'
  assert.equal(shellQuote("it's"), "'it'\"'\"'s'");
  assert.equal(shellQuote('hello world'), "'hello world'");
  assert.equal(shellQuote(''), "''");
});

test('buildEnvPrefix builds env string correctly', () => {
  assert.equal(buildEnvPrefix({ FOO: 'bar' }), "FOO='bar'");
  assert.equal(buildEnvPrefix({ FOO: 'bar', BAZ: 'qux' }), "FOO='bar' BAZ='qux'");
  assert.equal(buildEnvPrefix({}), '');
  assert.equal(buildEnvPrefix(undefined), '');
  assert.equal(buildEnvPrefix({ UNDEFINED_VAL: undefined as unknown as string }), '');
});

test('delay resolves after specified time', async () => {
  const start = Date.now();
  await delay(50);
  const elapsed = Date.now() - start;

  // Allow some tolerance for timing
  assert.ok(elapsed >= 40, `Expected at least 40ms, got ${elapsed}ms`);
  assert.ok(elapsed < 150, `Expected less than 150ms, got ${elapsed}ms`);
});

test('isInsideTmux returns boolean when TMUX env is not set', () => {
  // If TMUX is set in environment, the result will be true
  const result = isInsideTmux();
  assert.equal(typeof result, 'boolean');

  // In a non-tmux environment, this should be false
  if (!process.env.TMUX) {
    assert.equal(result, false);
  }
});

test('isTmuxAvailable returns boolean', () => {
  const result = isTmuxAvailable();
  assert.equal(typeof result, 'boolean');
});

test('normalizeCapture removes ANSI escape codes', () => {
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
  const successResult: TmuxResult = { ok: true, stdout: 'output' };
  const failResult: TmuxResult = { ok: false, stderr: 'error message' };

  assert.equal(successResult.ok, true);
  assert.equal(successResult.stdout, 'output');
  assert.equal(failResult.ok, false);
  assert.equal(failResult.stderr, 'error message');
});

test('TmuxPaneInfo interface structure', () => {
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
  const result: SplitPaneResult = {
    paneId: '%5',
    target: 'test-session:0.1',
  };

  assert.equal(result.paneId, '%5');
  assert.equal(result.target, 'test-session:0.1');
});

test('sendKeys options default values', () => {
  const options: SendKeysOptions = {
    target: '%0',
    text: 'hello',
  };

  // Check defaults
  assert.equal(options.enter, undefined); // Not set, defaults handled in function
  assert.equal(options.literal, undefined);
  assert.equal(options.delayBeforeMs, undefined);
});
