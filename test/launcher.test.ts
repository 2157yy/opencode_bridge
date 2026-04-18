import assert from 'node:assert/strict';
import test from 'node:test';

import { buildShellCommand, detectVisibleLauncherKind } from '../src/launcher.js';

test('buildShellCommand composes cwd, env, and command args safely', () => {
  const shellCommand = buildShellCommand(
    'opencode',
    ['attach', 'http://127.0.0.1:4096', '--dir', '/tmp/project', '--session=session-1'],
    {
      cwd: '/tmp/project',
      env: {
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: 'https://llm.example.test',
        OPENCODE_MODEL: 'gpt-4o',
        PATH: '/usr/bin:/bin',
      },
    },
  );

  assert.match(shellCommand, /^cd '\/tmp\/project' && /);
  assert.match(shellCommand, /OPENAI_API_KEY='sk-test'/);
  assert.match(shellCommand, /OPENAI_BASE_URL='https:\/\/llm\.example\.test'/);
  assert.match(shellCommand, /OPENCODE_MODEL='gpt-4o'/);
  assert.doesNotMatch(shellCommand, /PATH='\//);
  assert.match(shellCommand, /'opencode' 'attach' 'http:\/\/127\.0\.0\.1:4096'/);
});

test('detectVisibleLauncherKind prefers tmux when TMUX is available', { skip: !process.env.TMUX }, () => {
  assert.equal(detectVisibleLauncherKind(), 'tmux');
});
