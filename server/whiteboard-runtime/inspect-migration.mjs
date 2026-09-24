import * as Y from 'yjs';
import { pathToFileURL } from 'node:url';
import { assetExtractorVersion, extractAssetManifest, initializeAssetRoots } from './extract-assets.mjs';

const roots = new Set(['glideboard-meta', 'glideboard-records', 'glideboard-records-v2', 'glideboard-rich-text-fragments-v1']);

export function inspectMigration({ state, boardIdentity }) {
  const doc = new Y.Doc();
  try {
    initializeAssetRoots(doc);
    Y.applyUpdate(doc, Buffer.from(state, 'base64'));
    if (doc.store.pendingStructs || doc.store.pendingDs || doc.getSubdocs().size) throw new Error('Incomplete Yjs state');
    for (const name of doc.share.keys()) if (!roots.has(name)) throw new Error('Unsupported document root');
    for (const name of roots) if (doc.getMap(name)._start) throw new Error('Expected map root');
    const metadata = doc.getMap('glideboard-meta');
    if (metadata.has('schemaVersion') && metadata.get('schemaVersion') !== 2) throw new Error('Unsupported shared schema');
    if (boardIdentity && metadata.get('boardIdentity') !== boardIdentity) throw new Error('Incorrect board identity');
    // Use the same authoritative root selection, tombstones and asset rules as
    // publication. Include unreferenced live rasters so a submitted target cannot
    // silently strip source assets; vectors are validated in place and need no blob.
    return { ...extractAssetManifest(doc), assetExtractorVersion };
  } finally { doc.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 48 * 1024 * 1024) throw new Error('Snapshot too large');
      chunks.push(chunk);
    }
    process.stdout.write(JSON.stringify(inspectMigration(JSON.parse(Buffer.concat(chunks)))));
  } catch (error) { process.exitCode = error.code === 'assets' ? 3 : 2; }
}
