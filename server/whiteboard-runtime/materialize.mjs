import * as Y from 'yjs';
import { pathToFileURL } from 'node:url';
import { assetExtractorVersion, extractAssets, initializeAssetRoots } from './extract-assets.mjs';

export function materialize({ updates, title }) {
  const doc = new Y.Doc();
  try {
    initializeAssetRoots(doc);
    for (const update of updates) Y.applyUpdate(doc, Buffer.from(update, 'base64'));
    // Checkpoint validation is syntactic. A publish must also have every causal
    // dependency; encoding a doc with pending structs would silently lose edits.
    if (doc.store.pendingStructs || doc.store.pendingDs || doc.getSubdocs().size) {
      throw new Error('Incomplete or unsupported Yjs state');
    }
    // Title is authoritative ordered checkpoint metadata supplied by the server.
    // Preserve any legacy Yjs metadata bytes without using them as the title.
    if (typeof title !== 'string' || !title.trim() || [...title].length > 255 || title.includes('\0')) {
      throw new Error('Invalid document title');
    }
    const assets = extractAssets(doc);
    return { state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), title, assets, assetExtractorVersion };
  } finally { doc.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 48 * 1024 * 1024) throw new Error('Replay too large');
      chunks.push(chunk);
    }
    const result = materialize(JSON.parse(Buffer.concat(chunks)));
    process.stdout.write(JSON.stringify(result));
  } catch (error) { process.exitCode = error.code === 'assets' ? 3 : 2; }
}
