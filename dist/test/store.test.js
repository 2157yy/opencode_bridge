import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeJsonFile } from '../src/store.js';
test('writeJsonFile uses unique temp files for concurrent writes', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'opencode-bridge-store-'));
    const statePath = join(projectDir, 'state.json');
    await Promise.all([
        writeJsonFile(statePath, { writer: 'one' }),
        writeJsonFile(statePath, { writer: 'two' }),
    ]);
    const persisted = JSON.parse(await readFile(statePath, 'utf8'));
    assert.ok(['one', 'two'].includes(persisted.writer));
});
