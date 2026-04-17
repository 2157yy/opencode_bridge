import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export async function readJsonFile(filePath, fallback) {
    try {
        const text = await readFile(filePath, 'utf8');
        return JSON.parse(text);
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return fallback;
        }
        throw error;
    }
}
export async function writeJsonFile(filePath, data) {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tempPath, filePath);
}
function isNodeError(error) {
    return typeof error === 'object' && error !== null && 'code' in error;
}
