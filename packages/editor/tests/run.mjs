import { build } from 'tsup';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = await mkdtemp(join(root, '.extension-tests-'));
try {
  await build({
    entry: [join(root, 'tests/extensions.test.ts')],
    config: false,
    noExternal: [/\.css$/],
    outDir,
    format: ['esm'],
    dts: false,
    target: 'node22',
    removeNodeProtocol: false,
    silent: true,
    esbuildPlugins: [{
      name: 'omit-test-styles',
      setup(builder) {
        builder.onResolve({ filter: /\.css$/ }, (args) => ({ path: 'empty-style', namespace: 'empty-style' }));
        builder.onLoad({ filter: /.*/, namespace: 'empty-style' }, () => ({ contents: '', loader: 'js' }));
      },
    }],
    esbuildOptions(options) { options.packages = 'external'; },
  });
  const result = spawnSync(process.execPath, ['--test', join(outDir, 'extensions.test.mjs')], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(outDir, { recursive: true, force: true });
}
