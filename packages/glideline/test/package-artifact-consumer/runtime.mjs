import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as glideline from '@durgakiran/glideline';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

assert.equal(packageJson.type, 'module');
assert.deepEqual(packageJson.exports['.'], {
  types: './dist/index.d.ts',
  import: './dist/index.js',
});
const require = createRequire(import.meta.url);
assert.throws(
  () => require('@durgakiran/glideline'),
  (error) => error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  'The ESM-only package must not advertise a CommonJS entry point',
);

for (const name of ['GlideEditor', 'createEditor', 'sid', 'validatePortableBoardFragmentStructure']) {
  assert.equal(typeof glideline[name], 'function', `Invalid runtime export: ${name}`);
}
assert.equal(glideline.sid('shape:artifact-consumer'), 'shape:artifact-consumer');

const distRoot = join(packageRoot, 'dist');
const queue = [distRoot];
const emittedFiles = [];
while (queue.length > 0) {
  const directory = queue.pop();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) queue.push(path);
    else if (extname(path) === '.js' || path.endsWith('.d.ts')) emittedFiles.push(path);
  }
}

const relativeSpecifier = /(?:from\s+|import\s*(?:\(\s*)?)["'](\.\.?\/[^"']+)["']/g;
let specifierCount = 0;
for (const path of emittedFiles) {
  const source = await readFile(path, 'utf8');
  for (const match of source.matchAll(relativeSpecifier)) {
    const specifier = match[1];
    assert.equal(extname(specifier), '.js', `${relative(distRoot, path)} has ${specifier}`);
    await access(resolve(dirname(path), specifier));
    specifierCount += 1;
  }
}

assert.ok(specifierCount > 0, 'Expected emitted internal ESM specifiers');
console.log(
  `Validated Glideline ESM exports, ${emittedFiles.length} emitted files, and ${specifierCount} internal specifiers.`,
);
