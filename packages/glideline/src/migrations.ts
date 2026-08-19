/**
 * Glideline — Migration system (Phase 1)
 *
 * Co-located with ShapeUtil classes. Each ShapeUtil owns its migration history.
 * defineMigrations() validates the sequence at definition time (startup crash
 * is better than silent corruption).
 */

import type { GlideMigrations, GlideMigrator, AnyRecord } from './types.js';

export type { GlideMigrations, GlideMigrator };

/**
 * Define and validate a migration sequence for a ShapeUtil.
 *
 * Rules:
 *  - migrator keys must be contiguous starting at 1
 *  - the last key must equal currentVersion
 *
 * @throws if the sequence is non-contiguous or the last key ≠ currentVersion
 */
export function defineMigrations(def: GlideMigrations): GlideMigrations {
  const keys = Object.keys(def.migrators).map(Number).sort((a, b) => a - b);

  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== i + 1) {
      throw new Error(
        `defineMigrations: version sequence must be contiguous starting at 1. ` +
        `Got [${keys.join(', ')}]`,
      );
    }
  }

  if (keys.length > 0 && keys[keys.length - 1] !== def.currentVersion) {
    throw new Error(
      `defineMigrations: last migrator version (${keys[keys.length - 1]}) ` +
      `must equal currentVersion (${def.currentVersion})`,
    );
  }

  return def;
}

/**
 * Run a record from `fromVersion` up to `migrations.currentVersion`.
 * Returns a new object — never mutates the input.
 *
 * If `fromVersion === migrations.currentVersion` → returns record unchanged.
 * If `fromVersion > migrations.currentVersion`  → returns record unchanged (forward compat).
 */
export function migrateRecord(
  record: AnyRecord,
  migrations: GlideMigrations,
  fromVersion: number,
): AnyRecord {
  if (fromVersion >= migrations.currentVersion) return { ...record };

  let current: AnyRecord = { ...record };
  for (let v = fromVersion + 1; v <= migrations.currentVersion; v++) {
    const migrator = migrations.migrators[v];
    if (!migrator) throw new Error(`migrateRecord: no migrator for version ${v}`);
    current = migrator.up(current);
  }
  return current;
}

/**
 * Run a record from `fromVersion` down to `toVersion`.
 * Used when sending records to an older Yjs peer.
 */
export function migrateRecordDown(
  record: AnyRecord,
  migrations: GlideMigrations,
  fromVersion: number,
  toVersion: number,
): AnyRecord {
  let current: AnyRecord = { ...record };
  for (let v = fromVersion; v > toVersion; v--) {
    const migrator = migrations.migrators[v];
    if (!migrator) throw new Error(`migrateRecordDown: no migrator for version ${v}`);
    current = migrator.down(current);
  }
  return current;
}
