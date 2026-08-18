import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/@durgakiran/canvas-text-editor/dist/styles.css');
const destination = resolve(root, 'dist/styles.css');

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
