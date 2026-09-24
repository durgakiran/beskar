#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { EMITTED_ARTIFACT_PATHS, RAW_REPORT_PATHS, REPORT_PATHS } from './phase-3-coverage-lib.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const reportName = process.argv[2];
const packages = { glideboard: 'packages/glideboard', glideline: 'packages/glideline', demo: 'packages/glideline-demo', ui: 'ui' };
if (!reportName || !(reportName in packages) || process.argv.length !== 3) {
  console.error('usage: produce-phase-3-coverage.mjs <glideboard|glideline|demo|ui>');
  process.exit(2);
}

for (const reportPath of [RAW_REPORT_PATHS[reportName], REPORT_PATHS[reportName], path.join(path.dirname(RAW_REPORT_PATHS[reportName]), 'coverage-final.json')]) {
  fs.rmSync(reportPath, { force: true });
}
const result = spawnSync('npm', ['exec', '--', 'vitest', 'run', '--config', 'vitest.phase3.config.ts', '--coverage'], {
  cwd: path.join(root, packages[reportName]),
  encoding: 'utf8',
  env: process.env,
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (!fs.existsSync(RAW_REPORT_PATHS[reportName])) throw new Error(`${reportName} coverage producer did not emit its raw report`);

const build = spawnSync('npm', ['run', 'build'], {
  cwd: path.join(root, packages[reportName]), encoding: 'utf8', env: process.env,
});
process.stdout.write(build.stdout ?? '');
process.stderr.write(build.stderr ?? '');
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const artifactPath = EMITTED_ARTIFACT_PATHS[reportName];
fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
fs.rmSync(artifactPath, { force: true });
const archive = spawnSync('tar', ['-czf', artifactPath, '-C', path.join(root, packages[reportName]), 'dist'], {
  cwd: root, encoding: 'utf8', env: process.env,
});
process.stdout.write(archive.stdout ?? '');
process.stderr.write(archive.stderr ?? '');
if (archive.error) throw archive.error;
if (archive.status !== 0 || !fs.existsSync(artifactPath)) process.exit(archive.status ?? 1);

const bind = spawnSync(process.execPath, [path.join(root, 'docker/scripts/bind-phase-3-coverage.mjs'), reportName], {
  cwd: root, encoding: 'utf8', env: process.env,
});
process.stdout.write(bind.stdout ?? '');
process.stderr.write(bind.stderr ?? '');
if (bind.error) throw bind.error;
if (bind.status !== 0) process.exit(bind.status ?? 1);

const verify = spawnSync(process.execPath, [path.join(root, 'docker/scripts/verify-phase-3-coverage.mjs'), `--report=${reportName}`], {
  cwd: root, encoding: 'utf8', env: process.env,
});
process.stdout.write(verify.stdout ?? '');
process.stderr.write(verify.stderr ?? '');
if (verify.error) throw verify.error;
process.exit(verify.status ?? 1);
