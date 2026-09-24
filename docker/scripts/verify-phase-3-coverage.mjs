#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { coverageArtifactDigest, emittedArtifactDigest, expectedBinding, expectedMetricKeys, loadManifest, manifestMetricKey, REPORT_PATHS, validateMetricsSchema } from './phase-3-coverage-lib.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const manifest = loadManifest(root);
const reports = new Map();
let failed = false;
const onlyReport = process.argv[2]?.startsWith('--report=') ? process.argv[2].slice('--report='.length) : null;
if (process.argv.length > (onlyReport ? 3 : 2) || (onlyReport && !(onlyReport in REPORT_PATHS))) {
  console.error('usage: verify-phase-3-coverage.mjs [--report=glideboard|glideline|demo|ui|go]');
  process.exit(2);
}

const forbiddenEnvironment = Object.keys(process.env).filter(name => /^P3_(?:GLIDEBOARD|GLIDELINE|DEMO|UI|GO)_COVERAGE$/.test(name));
if (forbiddenEnvironment.length > 0) {
  console.error(`FAIL caller-selected coverage JSON is forbidden: ${forbiddenEnvironment.join(', ')}`);
  process.exit(2);
}

for (const [name, reportPath] of Object.entries(REPORT_PATHS)) {
  if (onlyReport && name !== onlyReport) continue;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const expected = expectedBinding(root, name, manifest);
    const exactKeys = ['schemaVersion', 'reportName', 'producer', 'sourceDigest', 'buildDigest', 'emittedArtifactDigest', 'manifestDigest', 'coverageArtifactDigest', 'generatedAtUtc', 'metrics'];
    if (JSON.stringify(Object.keys(report).sort()) !== JSON.stringify(exactKeys.sort())
      || report.schemaVersion !== 1 || report.reportName !== name
      || report.producer !== expected.producer || report.sourceDigest !== expected.sourceDigest
      || report.buildDigest !== expected.buildDigest || report.manifestDigest !== expected.manifestDigest
      || report.emittedArtifactDigest !== expected.emittedArtifactDigest
      || report.emittedArtifactDigest !== emittedArtifactDigest(name)
      || report.coverageArtifactDigest !== coverageArtifactDigest(name)
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.generatedAtUtc)
      || !validateMetricsSchema(report.metrics)
      || JSON.stringify(Object.keys(report.metrics).sort()) !== JSON.stringify(expectedMetricKeys(root, name, manifest))) {
      throw new Error('schema, producer, or source/build binding mismatch');
    }
    reports.set(name, report.metrics);
  } catch (error) {
    console.error(`FAIL ${name}: invalid repository-owned coverage report ${reportPath}: ${error.message}`);
    failed = true;
  }
}

for (const entry of manifest.modules) {
  if (onlyReport && entry.report !== onlyReport) continue;
  const report = reports.get(entry.report);
  if (!fs.existsSync(path.join(root, entry.path))) {
    console.error(`FAIL ${entry.surface}: manifest source is missing: ${entry.path}`);
    failed = true;
    continue;
  }
  if (!report) continue;
  const key = manifestMetricKey(root, entry);
  const metrics = report[key];
  if (!metrics) {
    console.error(`FAIL ${entry.surface}: no coverage metrics for manifest entry ${entry.path}`);
    failed = true;
    continue;
  }
  const rendered = [];
  let entryFailed = false;
  for (const dimension of entry.dimensions) {
    const value = Number(metrics[dimension]?.pct ?? metrics[dimension]);
    rendered.push(`${dimension}=${Number.isFinite(value) ? value.toFixed(2) : 'missing'}%`);
    if (!Number.isFinite(value) || value < manifest.minimumPercent) entryFailed = true;
  }
  if (entryFailed) failed = true;
  console.log(`${entryFailed ? 'FAIL' : 'PASS'} ${entry.path}${entry.scope || entry.ranges ? ' (scoped)' : ''}: ${rendered.join(' ')}`);
}

if (failed) process.exit(1);
