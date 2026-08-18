import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const REPORT_PATHS = Object.freeze({
  glideboard: '/tmp/beskar-phase3-glideboard-coverage/phase3-coverage.json',
  glideline: '/tmp/beskar-phase3-glideline-coverage/phase3-coverage.json',
  demo: '/tmp/beskar-phase3-demo-coverage/phase3-coverage.json',
  ui: '/tmp/beskar-phase3-ui-coverage/phase3-coverage.json',
  go: '/tmp/beskar-phase3-go-coverage.json',
});

export const RAW_REPORT_PATHS = Object.freeze({
  glideboard: '/tmp/beskar-phase3-glideboard-coverage/coverage-summary.json',
  glideline: '/tmp/beskar-phase3-glideline-coverage/coverage-summary.json',
  demo: '/tmp/beskar-phase3-demo-coverage/coverage-summary.json',
  ui: '/tmp/beskar-phase3-ui-coverage/coverage-summary.json',
  go: '/tmp/beskar-phase3-go-coverage.raw.json',
});

export const EMITTED_ARTIFACT_PATHS = Object.freeze({
  glideboard: '/tmp/beskar-phase3-artifacts/glideboard-dist.tar.gz',
  glideline: '/tmp/beskar-phase3-artifacts/glideline-dist.tar.gz',
  demo: '/tmp/beskar-phase3-artifacts/glideline-demo-dist.tar.gz',
  ui: '/tmp/beskar-phase3-artifacts/ui-dist.tar.gz',
  go: '/tmp/beskar-phase3-artifacts/beskar-server',
});

const REQUIRED_SEMANTIC_INVENTORY = Object.freeze({
  'editor-delete-controller': ['server/editor/whiteboardController.go', ['deleteWhiteboard']],
  'editor-delete-service': ['server/editor/whiteboardService.go', ['DeleteWhiteboard']],
  'media-authorization': ['server/media/controller/mediaController.go', ['authorizedPage', 'authorizedPageID']],
  'media-upload-lifecycle': ['server/media/controller/mediaController.go', ['prepareWhiteboardAssetUpload', 'stageWhiteboardAssetUpload', 'commitWhiteboardAssetUpload', 'cancelWhiteboardAssetUpload']],
  'media-reference-lifecycle': ['server/media/controller/mediaController.go', ['retainWhiteboardAssetReferences', 'deleteWhiteboardAsset', 'getWhiteboardAsset']],
  'asset-catalog-and-object-cleanup': ['server/media/services/whiteboardAssetService.go', ['ListWhiteboardAssetStorageKeys', 'DeleteWhiteboardAssetObjects']],
  'delete-quota-release': ['server/quota/service.go', ['ReleasePageStorageUsageTx']],
  'terminal-upload-correlation': ['packages/glideboard/src/AssetImportPanel.tsx', ['createAssetImportCorrelationToken']],
  'production-host-adapter': ['ui/app/components/WhiteboardEditor.tsx', ['retainReferences', 'materializePortableAsset', 'rollback']],
  'historical-asset-resolution': ['ui/app/space/[spaceId]/whiteboard/[pageId]/versions/[versionId]/page.tsx', ['assetResolutionContext', 'assetStorage']],
});

const PRODUCERS = Object.freeze({
  glideboard: 'npm --prefix packages/glideboard run test:phase3:coverage',
  glideline: 'npm --prefix packages/glideline run test:phase3:coverage',
  demo: 'npm --prefix packages/glideline-demo run test:phase3:coverage',
  ui: 'npm --prefix ui run test:phase3:coverage',
  go: './docker/scripts/test-phase-3-go-coverage.sh',
});

const CONFIG_PATHS = Object.freeze({
  glideboard: ['packages/glideboard/package.json', 'packages/glideboard/package-lock.json', 'packages/glideboard/tsconfig.json', 'packages/glideboard/tsconfig.build.json', 'packages/glideboard/vitest.phase3.config.ts'],
  glideline: ['packages/glideline/package.json', 'packages/glideline/package-lock.json', 'packages/glideline/tsconfig.json', 'packages/glideline/tsconfig.build.json', 'packages/glideline/vitest.phase3.config.ts'],
  demo: ['packages/glideline-demo/package.json', 'packages/glideline-demo/package-lock.json', 'packages/glideline-demo/tsconfig.json', 'packages/glideline-demo/tsconfig.build.json', 'packages/glideline-demo/vite.config.ts', 'packages/glideline-demo/vitest.phase3.config.ts'],
  ui: ['ui/package.json', 'ui/package-lock.json', 'ui/tsconfig.json', 'ui/vite.config.ts', 'ui/vitest.config.ts', 'ui/vitest.phase3.config.ts'],
  go: ['docker/scripts/test-phase-3-go-coverage.sh', 'docker/scripts/phase-3-go-coverage-report.go', 'server/go.mod', 'server/go.sum'],
});

const TEST_ROOTS = Object.freeze({
  glideboard: ['packages/glideboard/src'],
  glideline: ['packages/glideline/src'],
  demo: ['packages/glideline-demo/test'],
  ui: ['ui/app'],
  go: ['server/media/services', 'server/media/controller', 'server/editor', 'server/quota', 'server/storage'],
});

function walkFiles(root, relativeDir, predicate) {
  const result = [];
  const visit = current => {
    for (const entry of fs.readdirSync(path.join(root, current), { withFileTypes: true })) {
      const relativePath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile() && predicate(relativePath)) result.push(relativePath);
    }
  };
  visit(relativeDir);
  return result;
}

function testInputs(root, reportName) {
  const isTest = reportName === 'go'
    ? file => file.endsWith('_test.go')
    : file => /\.(?:test|spec)\.tsx?$/.test(file);
  return TEST_ROOTS[reportName].flatMap(dir => walkFiles(root, dir, isTest));
}

function digestFiles(root, files) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of [...new Set(files)].sort()) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.statSync(absolutePath).isFile()) throw new Error(`binding input is not a file: ${relativePath}`);
    const bytes = fs.readFileSync(absolutePath);
    hash.update(`${relativePath}\0${bytes.length}\0`);
    hash.update(bytes);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function emittedArtifactDigest(reportName) {
  const artifactPath = EMITTED_ARTIFACT_PATHS[reportName];
  if (!artifactPath || !fs.statSync(artifactPath).isFile()) {
    throw new Error(`missing emitted ${reportName} build artifact: ${artifactPath}`);
  }
  const bytes = fs.readFileSync(artifactPath);
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function resolveLocalImport(root, importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(root, path.dirname(importer), specifier);
  const extensionless = /\.[cm]?js$/.test(base) ? base.replace(/\.[cm]?js$/, '') : base;
  for (const candidate of [base, ...['.ts', '.tsx', '.js', '.mjs', '.json'].map(ext => extensionless + ext), ...['.ts', '.tsx', '.js'].map(ext => path.join(extensionless, `index${ext}`))]) {
    try {
      if (fs.statSync(candidate).isFile()) return path.relative(root, candidate);
    } catch {}
  }
  throw new Error(`cannot resolve local binding import ${specifier} from ${importer}`);
}

function transitiveTypeScriptInputs(root, seeds) {
  const pending = [...seeds];
  const found = new Set();
  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (found.has(relativePath) || !/\.(?:[cm]?js|tsx?|json)$/.test(relativePath)) continue;
    found.add(relativePath);
    if (relativePath.endsWith('.json')) continue;
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const imports = source.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g);
    for (const match of imports) {
      const resolved = resolveLocalImport(root, relativePath, match[1]);
      if (resolved) pending.push(resolved);
    }
  }
  return [...found];
}

export function coverageArtifactDigest(reportName) {
  const files = [RAW_REPORT_PATHS[reportName]];
  if (reportName !== 'go') files.push(path.join(path.dirname(RAW_REPORT_PATHS[reportName]), 'coverage-final.json'));
  const hash = crypto.createHash('sha256');
  for (const file of files.sort()) {
    const bytes = fs.readFileSync(file);
    hash.update(`${path.basename(file)}\0${bytes.length}\0`);
    hash.update(bytes);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function loadManifest(root) {
  const manifestPath = path.join(root, 'docs/runbooks/phase-3-coverage-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 3 || manifest.minimumPercent !== 90 || !Array.isArray(manifest.modules)) {
    throw new Error('unsupported Phase 3 coverage manifest schema');
  }
  validateSemanticInventory(root, manifest);
  return manifest;
}

function validateSemanticInventory(root, manifest) {
  if (!Array.isArray(manifest.semanticInventory)) throw new Error('Phase 3 semantic inventory is missing');
  const byID = new Map(manifest.semanticInventory.map(entry => [entry.id, entry]));
  if (byID.size !== manifest.semanticInventory.length) throw new Error('duplicate Phase 3 semantic inventory id');
  for (const [id, [requiredPath, requiredSymbols]] of Object.entries(REQUIRED_SEMANTIC_INVENTORY)) {
    const entry = byID.get(id);
    if (!entry || entry.path !== requiredPath
      || JSON.stringify(entry.symbols) !== JSON.stringify(requiredSymbols)) {
      throw new Error(`missing or altered semantic inventory entry: ${id}`);
    }
  }
  for (const entry of manifest.semanticInventory) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.path !== 'string'
      || !Array.isArray(entry.symbols) || entry.symbols.length === 0) {
      throw new Error('invalid Phase 3 semantic inventory entry');
    }
    const sourcePath = path.join(root, entry.path);
    const source = fs.readFileSync(sourcePath, 'utf8');
    for (const symbol of entry.symbols) {
      if (typeof symbol !== 'string' || !new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`).test(source)) {
        throw new Error(`stale semantic inventory symbol ${entry.path}#${symbol}`);
      }
    }
    const covered = manifest.modules.some(module => module.path === entry.path
      && (!module.scope || entry.symbols.every(symbol => module.scope.includes(symbol))));
    if (!covered) throw new Error(`semantic inventory is not coverage-bound: ${entry.id}`);
  }
}

export function expectedBinding(root, reportName, manifest = loadManifest(root)) {
  if (!(reportName in REPORT_PATHS)) throw new Error(`unknown report: ${reportName}`);
  const sourcePaths = manifest.modules.filter(entry => entry.report === reportName).map(entry => entry.path);
  if (sourcePaths.length === 0) throw new Error(`manifest has no ${reportName} entries`);
  const manifestPath = 'docs/runbooks/phase-3-coverage-manifest.json';
  const sourceDigest = digestFiles(root, sourcePaths);
  const bindingInputs = [
    manifestPath,
    'docker/scripts/phase-3-coverage-lib.mjs',
    'docker/scripts/bind-phase-3-coverage.mjs',
    'docker/scripts/produce-phase-3-coverage.mjs',
    'docker/scripts/verify-phase-3-coverage.mjs',
    ...CONFIG_PATHS[reportName],
    ...testInputs(root, reportName),
    ...(manifest.bindingInputs?.[reportName] ?? []),
    ...sourcePaths,
  ];
  const expandedInputs = reportName === 'go'
    ? [...bindingInputs, ...TEST_ROOTS.go.flatMap(dir => walkFiles(root, dir, file => file.endsWith('.go')))]
    : transitiveTypeScriptInputs(root, bindingInputs);
  let revision;
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    revision = 'unversioned';
  }
  const inputsDigest = digestFiles(root, expandedInputs);
  const artifactDigest = emittedArtifactDigest(reportName);
  const buildHash = crypto.createHash('sha256')
    .update(`phase3-coverage-v2\0${reportName}\0${revision}\0${sourceDigest}\0${inputsDigest}\0${artifactDigest}`)
    .digest('hex');
  return {
    producer: PRODUCERS[reportName],
    sourceDigest,
    buildDigest: `sha256:${buildHash}`,
    emittedArtifactDigest: artifactDigest,
    manifestDigest: digestFiles(root, [manifestPath]),
  };
}

export function renderRanges(ranges) {
  return ranges.map(([start, end]) => `L${start}-${end}`).join(',');
}

export function manifestMetricKey(root, entry) {
  return entry.report === 'go'
    ? `${entry.path}${entry.scope ? `#${entry.scope.join(',')}` : ''}`
    : `${path.join(root, entry.path)}${entry.ranges ? `#${renderRanges(entry.ranges)}` : ''}`;
}

export function expectedMetricKeys(root, reportName, manifest = loadManifest(root)) {
  return manifest.modules.filter(entry => entry.report === reportName).map(entry => manifestMetricKey(root, entry)).sort();
}

export function validateMetricsSchema(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return false;
  return Object.entries(metrics).every(([key, value]) => {
    if (!key || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(value).every(([dimension, metric]) => {
      if (!['statements', 'branches', 'functions', 'lines'].includes(dimension)) return false;
      if (typeof metric === 'number') return Number.isFinite(metric) && metric >= 0 && metric <= 100;
      return metric && typeof metric === 'object' && Number.isFinite(metric.pct) && metric.pct >= 0 && metric.pct <= 100;
    });
  });
}
