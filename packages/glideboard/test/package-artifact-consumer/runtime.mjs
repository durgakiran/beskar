import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as glideboard from '@durgakiran/glideboard';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
assert.equal(packageJson.exports['.'].import, './dist/index.js');
assert.equal(packageJson.exports['.'].types, './dist/index.d.ts');
assert.equal(packageJson.exports['./styles.css'], './dist/styles.css');

assert.ok(glideboard.Glideboard, 'Missing runtime export: Glideboard');
for (const name of ['GlideboardController', 'createAssetLibraryProvider']) {
  assert.equal(typeof glideboard[name], 'function', `Invalid runtime export: ${name}`);
}

const distRoot = join(packageRoot, 'dist');
assert.ok((await readFile(join(distRoot, 'styles.css'), 'utf8')).includes('.canvas-text-editor'));
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

const relativeSpecifier = /(?:from\s+|import\s*)["'](\.\.?\/[^"']+)["']/g;
for (const path of emittedFiles) {
  const source = await readFile(path, 'utf8');
  for (const match of source.matchAll(relativeSpecifier)) {
    assert.equal(
      extname(match[1]),
      '.js',
      `${relative(distRoot, path)} contains unresolved ESM specifier ${match[1]}`,
    );
  }
}

console.log(`Validated Glideboard package exports and ${emittedFiles.length} emitted ESM files.`);
