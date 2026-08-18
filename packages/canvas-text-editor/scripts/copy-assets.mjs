import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
await copyFile(new URL('../src/styles.css', import.meta.url), `${packageRoot}/dist/styles.css`);
