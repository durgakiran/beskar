#!/usr/bin/env node

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { coverageArtifactDigest, expectedBinding, expectedMetricKeys, loadManifest, manifestMetricKey, RAW_REPORT_PATHS, REPORT_PATHS, renderRanges, validateMetricsSchema } from './phase-3-coverage-lib.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const reportName = process.argv[2];
if (!reportName || !(reportName in REPORT_PATHS) || process.argv.length !== 3) {
  console.error('usage: bind-phase-3-coverage.mjs <glideboard|glideline|demo|ui|go>');
  process.exit(2);
}

const rawPath = RAW_REPORT_PATHS[reportName];
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const metrics = {};
const manifest = loadManifest(root);
const manifestEntries = manifest.modules.filter(entry => entry.report === reportName);
if (reportName === 'go') Object.assign(metrics, raw);
if (reportName !== 'go') {
  const detailedPath = path.join(path.dirname(rawPath), 'coverage-final.json');
  const detailed = JSON.parse(fs.readFileSync(detailedPath, 'utf8'));
  for (const entry of manifestEntries) {
    const absolutePath = path.join(root, entry.path);
    if (!entry.ranges) {
      const rawKey = Object.keys(raw).find(candidate => candidate !== 'total' && path.resolve(candidate) === absolutePath);
      if (!rawKey) throw new Error(`${reportName} report omitted ${entry.path}`);
      metrics[absolutePath] = raw[rawKey];
      continue;
    }
    const coverage = detailed[absolutePath];
    if (!coverage) throw new Error(`${reportName} detailed report omitted ${entry.path}`);
    try {
      metrics[`${absolutePath}#${renderRanges(entry.ranges)}`] = scopedMetrics(coverage, entry.ranges);
    } catch (error) {
      throw new Error(`${entry.path} ${renderRanges(entry.ranges)}: ${error.message}`);
    }
  }
}
if (!validateMetricsSchema(metrics)) throw new Error(`${reportName} producer emitted invalid coverage metrics`);

const binding = expectedBinding(root, reportName, manifest);
const output = {
  schemaVersion: 1,
  reportName,
  ...binding,
  coverageArtifactDigest: coverageArtifactDigest(reportName),
  generatedAtUtc: new Date().toISOString(),
  metrics,
};

for (const entry of manifestEntries) {
  const key = manifestMetricKey(root, entry);
  if (!metrics[key]) throw new Error(`${reportName} producer omitted manifest entry ${entry.path}`);
}
if (JSON.stringify(Object.keys(metrics).sort()) !== JSON.stringify(expectedMetricKeys(root, reportName, manifest))) {
  throw new Error(`${reportName} producer metric keys do not exactly equal its manifest keys`);
}

fs.mkdirSync(path.dirname(REPORT_PATHS[reportName]), { recursive: true });
const temporaryPath = `${REPORT_PATHS[reportName]}.${process.pid}.${crypto.randomUUID()}.tmp`;
try {
  fs.writeFileSync(temporaryPath, `${JSON.stringify(output)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporaryPath, REPORT_PATHS[reportName]);
} finally {
  fs.rmSync(temporaryPath, { force: true });
}
console.log(`bound ${reportName} coverage report: ${REPORT_PATHS[reportName]}`);

function scopedMetrics(coverage, ranges) {
  const sourceLines = fs.readFileSync(coverage.path, 'utf8').split(/\r?\n/).length;
  if (!Array.isArray(ranges) || ranges.length === 0) throw new Error('scoped ranges must not be empty');
  for (const range of ranges) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger)
      || range[0] < 1 || range[1] < range[0] || range[1] > sourceLines) {
      throw new Error(`stale or invalid scoped range ${JSON.stringify(range)} for ${sourceLines}-line source`);
    }
  }
  const includesLine = line => ranges.some(([start, end]) => line >= start && line <= end);
  const ratio = (dimension, values) => {
    if (values.length === 0) throw new Error(`scoped ${dimension} selected zero instrumentation`);
    const covered = values.filter(Boolean).length;
    return { pct: covered * 100 / values.length, covered, total: values.length };
  };
  const statementIds = Object.keys(coverage.statementMap).filter(id => includesLine(coverage.statementMap[id].start.line));
  const branchIds = Object.keys(coverage.branchMap).filter(id => {
    const map = coverage.branchMap[id];
    return includesLine((map.loc ?? map.locations[0]).start.line);
  });
  const functionIds = Object.keys(coverage.fnMap).filter(id => {
    const map = coverage.fnMap[id];
    const start = (map.decl ?? map.loc).start.line;
    const end = map.loc.end.line;
    return ranges.some(([rangeStart, rangeEnd]) => start <= rangeEnd && end >= rangeStart);
  });
  const lineCounts = new Map();
  for (const id of statementIds) {
    const line = coverage.statementMap[id].start.line;
    lineCounts.set(line, Math.max(lineCounts.get(line) ?? 0, coverage.s[id]));
  }
  for (const [start, end] of ranges) {
    if (!statementIds.some(id => {
      const line = coverage.statementMap[id].start.line;
      return line >= start && line <= end;
    })) throw new Error(`scoped range L${start}-${end} selected zero statements`);
  }
  return {
    statements: ratio('statements', statementIds.map(id => coverage.s[id] > 0)),
    branches: ratio('branches', branchIds.flatMap(id => coverage.b[id].map(count => count > 0))),
    functions: ratio('functions', functionIds.map(id => coverage.f[id] > 0)),
    lines: ratio('lines', [...lineCounts.values()].map(count => count > 0)),
  };
}
