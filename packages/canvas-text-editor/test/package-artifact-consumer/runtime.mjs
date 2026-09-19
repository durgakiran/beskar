import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as canvasTextEditor from '@durgakiran/canvas-text-editor';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
assert.equal(packageJson.dependencies['@durgakiran/editor'], undefined);
assert.equal(packageJson.peerDependencies.react, '^18.2.0 || ^19.0.0');
assert.equal(packageJson.peerDependencies['react-dom'], '^18.2.0 || ^19.0.0');
assert.equal(packageJson.exports['.'].import, './dist/index.js');
assert.equal(packageJson.exports['./editor'].import, './dist/CanvasTextEditor.js');
assert.equal(packageJson.exports['./model'].import, './dist/model.js');
assert.equal(packageJson.exports['./view'].import, './dist/CanvasTextView.js');
assert.equal(packageJson.exports['./styles.css'], './dist/styles.css');
await access(join(packageRoot, 'dist', 'styles.css'));

for (const name of ['CanvasTextEditor', 'CanvasTextView', 'createCanvasRichTextDocument', 'normalizeCanvasRichText']) {
  assert.equal(typeof canvasTextEditor[name], 'function', `Invalid runtime export: ${name}`);
}

const distRoot = join(packageRoot, 'dist');
const modelSource = await readFile(join(distRoot, 'model.js'), 'utf8');
const viewSource = await readFile(join(distRoot, 'CanvasTextView.js'), 'utf8');
assert.equal(modelSource.includes('@tiptap/'), false, 'Model entry imports TipTap');
assert.equal(modelSource.includes('react'), false, 'Model entry imports React');
assert.equal(viewSource.includes('@tiptap/'), false, 'Static view imports TipTap');
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
  assert.equal(source.includes('@durgakiran/editor'), false, `${relative(distRoot, path)} imports the full editor`);
  for (const match of source.matchAll(relativeSpecifier)) {
    assert.equal(extname(match[1]), '.js', `${relative(distRoot, path)} has unresolved ESM import ${match[1]}`);
  }
}

console.log(`Validated canvas text editor exports and ${emittedFiles.length} emitted ESM files.`);
