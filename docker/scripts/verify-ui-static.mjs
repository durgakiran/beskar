#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [directory, mode, manifestPath] = process.argv.slice(2);
assert(directory, 'Usage: verify-ui-static.mjs <dist> [--write-manifest|--check-manifest <file>]');
assert(!mode || ['--write-manifest', '--check-manifest'].includes(mode), 'Unknown manifest mode');
assert(!mode || manifestPath, 'Manifest mode requires a file path');
const root = path.resolve(directory);
const files = [];

async function collect(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        assert(!entry.isSymbolicLink(), `Unexpected symlink: ${file}`);
        if (entry.isDirectory()) {
            assert(entry.name !== 'node_modules', 'node_modules must not be published');
            await collect(file);
        } else {
            assert(entry.isFile(), `Unexpected asset type: ${file}`);
            assert(!/^\.env(?:\.|$)|^\.npmrc$|\.(?:pem|key|tsbuildinfo)$/.test(entry.name), `Unexpected private/build file: ${file}`);
            const size = (await stat(file)).size;
            assert(size <= 25 * 1024 * 1024, `Asset exceeds Cloudflare's 25 MiB limit: ${file}`);
            const content = await readFile(file);
            files.push({
                path: path.relative(root, file).split(path.sep).join('/'),
                size,
                sha256: createHash('sha256').update(content).digest('hex'),
            });
        }
    }
}
await collect(root);
files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
assert(files.length <= 20_000, 'Static release exceeds the Workers Free file count limit');
for (const required of ['index.html', 'jbi.wasm', 'workers/editor.js', 'workers/wasm_exec.js']) {
    assert(files.some(file => file.path === required && file.size > 0), `Missing or empty required asset: ${required}`);
}
assert(files.some(file => /^assets\/.+\.js$/.test(file.path)), 'Missing bundled JavaScript');
assert(files.some(file => /^assets\/.+\.css$/.test(file.path)), 'Missing bundled CSS');

const html = await readFile(path.join(root, 'index.html'), 'utf8');
for (const [, reference] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) continue;
    const asset = decodeURIComponent(reference.split(/[?#]/)[0]).replace(/^\/+/, '');
    assert(files.some(file => file.path === asset), `index.html references a missing asset: ${reference}`);
}
await WebAssembly.compile(await readFile(path.join(root, 'jbi.wasm')));

const suffixes = [
    'USER_SERVER_URL', 'API_URL', 'API_BASE_URL', 'IMAGE_SERVER_URL', 'SIGNALING_URL',
    'HASURA_PROJECT_ENDPOINT', 'PAGE_EVENTS_SSE', 'PAGE_EVENTS_TRANSPORT_LOG', 'EDITOR_PRESENCE',
];
const config = Object.fromEntries(suffixes.map(suffix => [
    `VITE_${suffix}`,
    process.env[`NEXT_PUBLIC_${suffix}`] ?? process.env[`VITE_${suffix}`] ?? '',
]));

if (mode === '--write-manifest') {
    await writeFile(manifestPath, JSON.stringify({
        version: 1,
        revision: process.env.UI_BUILD_REVISION || 'unknown',
        config,
        files,
    }, null, 2) + '\n');
} else if (mode === '--check-manifest') {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(manifest.version, 1, 'Unsupported release manifest version');
    assert.deepEqual(manifest.files, files, 'Release files changed after building; rebuild before deploying');
    assert.deepEqual(manifest.config, config, 'Frontend configuration changed since this release was built; rebuild before deploying');
}
console.log(`Validated ${files.length} static assets, including browser workers and WASM.`);
