import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('usage: node scripts/lint.mjs <dir> [dir...]');
  process.exit(1);
}

const files = [];
for (const root of roots) {
  files.push(...(await collect(resolve(root))));
}

let failed = false;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/\s+$/.test(line)) {
      failed = true;
      console.error(`${file}:${index + 1}: trailing whitespace`);
    }
  });
  if (!text.endsWith('\n')) {
    failed = true;
    console.error(`${file}: missing trailing newline`);
  }
}

if (failed) {
  process.exit(1);
}

async function collect(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collect(full)));
      continue;
    }
    if (/\.(ts|mjs|cjs)$/u.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}
