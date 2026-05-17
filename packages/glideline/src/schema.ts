/**
 * Glideline — GlideSchema (Phase 1)
 *
 * Responsibilities:
 *  1. Register ShapeUtil classes (extracts static props + migrations)
 *  2. Validate shape props on every store.put()
 *  3. Load a GlideDocument: run per-record migrations up to current version
 *  4. Save a GlideDocument: stamp schema header with current versions
 *  5. Preserve unknown types and forward-versioned records (no crash, no drop)
 */

import type { GlideShape, GlideDocument, AnyRecord, GlideMigrations } from './types';
import { migrateRecord } from './migrations';

export const CURRENT_STORE_VERSION = 1;

// Internal interface for what we need from a ShapeUtil class (static side)
interface ShapeUtilClass {
  type: string;
  props?: Record<string, { validate(v: unknown): unknown }>;
  migrations?: GlideMigrations;
}

export class GlideSchema {
  private _shapeUtils = new Map<string, ShapeUtilClass>();
  private _frozen = false;

  /**
   * Freeze the schema. Called by createEditor() after all plugins are installed.
   * Any subsequent registerShapeUtil() throws immediately.
   */
  freeze(): void {
    this._frozen = true;
  }

  get frozen(): boolean { return this._frozen; }

  /**
   * Register a ShapeUtil class. Extracts static.props validators and
   * static.migrations for use in validateProps() and load().
   */
  registerShapeUtil(UtilClass: ShapeUtilClass): void {
    if (this._frozen) {
      throw new Error(
        `GlideSchema is frozen. registerShapeUtil() called after createEditor() completed. ` +
        `Register all shapes inside a plugin before calling createEditor().`,
      );
    }
    const type = UtilClass.type;
    if (!type) throw new Error(`ShapeUtil must have a static 'type' property`);
    this._shapeUtils.set(type, UtilClass);
  }

  /**
   * Validate a shape's props against its ShapeUtil's static validators.
   * Called on every store.put(). Throws on the first failing field.
   * Unknown types (no registered util) are silently skipped.
   */
  validateProps(shape: GlideShape): void {
    const util = this._shapeUtils.get(shape.type);
    if (!util) return; // Unknown type — skip validation

    const propValidators = util.props;
    if (!propValidators) return;

    const props = shape.props as Record<string, unknown>;
    for (const [key, validator] of Object.entries(propValidators)) {
      try {
        validator.validate(props[key]);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
          `Shape "${shape.id}" (type: "${shape.type}") prop "${key}": ${msg}`,
        );
      }
    }
  }

  /**
   * Load a GlideDocument:
   *  - For each record, check its saved version against the registered util's currentVersion
   *  - Run up() migrators to bring it to the current version
   *  - Unknown types → preserve as-is
   *  - Future-versioned records (savedVersion > currentVersion) → preserve as-is
   */
  load(doc: GlideDocument): AnyRecord[] {
    const savedShapeVersions = doc.schema.shapes ?? {};

    return doc.records.map((raw): AnyRecord => {
      const record = raw as AnyRecord;
      const type = record['type'] as string | undefined;
      if (!type) return record;

      const util = this._shapeUtils.get(type);
      if (!util) return record; // Unknown type — preserve opaque

      const migrations = util.migrations;
      if (!migrations) return record; // No migrations — assume already current

      const savedVersion = savedShapeVersions[type] ?? 0;
      if (savedVersion > migrations.currentVersion) return record; // Forward compat — preserve

      return migrateRecord(record, migrations, savedVersion);
    });
  }

  /**
   * Serialise records to a GlideDocument with schema header.
   * Stamps the current version of each registered shape type.
   */
  save(records: AnyRecord[]): GlideDocument {
    const shapeVersions: Record<string, number> = {};
    for (const [type, util] of this._shapeUtils) {
      shapeVersions[type] = util.migrations?.currentVersion ?? 0;
    }

    return {
      schema: {
        storeVersion: CURRENT_STORE_VERSION,
        shapes: shapeVersions,
        bindings: {},
      },
      records: records as GlideDocument['records'],
    };
  }

  /** Returns the registered util class for a type, or undefined. */
  getUtil(type: string): ShapeUtilClass | undefined {
    return this._shapeUtils.get(type);
  }

  /** Whether a type is registered. */
  hasUtil(type: string): boolean {
    return this._shapeUtils.has(type);
  }
}
