/** Store-v2 schema, migration, validation, and forward-compatibility boundary. */

import type {
  GlideShape,
  GlideDocument,
  AnyRecord,
  GlideMigrations,
  RecordKind,
  RecordReferenceDescriptor,
} from './types';
import { isGlideBinding, isGlideShape } from './types';
import { migrateRecord } from './migrations';
import {
  generateRebalancedOrderKeys,
  getShapeOrderParentId,
} from './ordering';

/**
 * Version of the persisted GlideDocument/store envelope.
 *
 * This is not the npm package version and not a shape or binding version.
 * Shape and binding evolution is tracked separately by each record's
 * `schemaVersion` and by `schema.shapes` / `schema.bindings` in the document.
 *
 * Store v1 inferred record categories from their fields. Store v2 persists an
 * explicit `kind`, per-record `schemaVersion`, and `meta` envelope and has a
 * document-level v1-to-v2 migration. Store v3 normalizes shape order to
 * canonical parent-scoped keys. Store v4 folds legacy arrow record rotation
 * into its path points. Increment this value only when the document-wide format
 * changes and add the corresponding migration pipeline.
 */
export const CURRENT_STORE_VERSION = 4;

export interface DocumentLimits {
  maxRecords: number;
  maxDocumentBytes: number;
  maxPropsBytes: number;
  maxMetaBytes: number;
  maxDepth: number;
}

export const DEFAULT_DOCUMENT_LIMITS: Readonly<DocumentLimits> = Object.freeze({
  maxRecords: 100_000,
  maxDocumentBytes: 64 * 1024 * 1024,
  maxPropsBytes: 1024 * 1024,
  maxMetaBytes: 64 * 1024,
  maxDepth: 64,
});

export interface LoadReport {
  readonly sourceStoreVersion: number;
  readonly targetStoreVersion: number;
  readonly recordCount: number;
  readonly migrations: readonly string[];
  readonly opaqueRecordIds: readonly string[];
  readonly repairs: readonly string[];
  readonly warnings: readonly string[];
}

export interface LoadedDocument {
  readonly records: AnyRecord[];
  readonly report: LoadReport;
}

export class DocumentValidationError extends Error {
  constructor(message: string, readonly recordId?: string) {
    super(recordId ? `Record "${recordId}": ${message}` : message);
    this.name = 'DocumentValidationError';
  }
}

interface UtilClass {
  type: string;
  props?: Record<string, { validate(v: unknown): unknown }>;
  migrations?: GlideMigrations;
  references?: readonly RecordReferenceDescriptor[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function valueDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') return depth;
  const children = Array.isArray(value) ? value : Object.values(value as object);
  let maximum = depth;
  for (const child of children) maximum = Math.max(maximum, valueDepth(child, depth + 1));
  return maximum;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith('/')) throw new Error(`reference path "${pointer}" must be a JSON Pointer`);
  return pointer.slice(1).split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function readPointer(record: AnyRecord, pointer: string): unknown {
  let value: unknown = record;
  for (const segment of pointerSegments(pointer)) {
    if (!isPlainObject(value) && !Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function inferLegacyKind(
  record: AnyRecord,
  shapeUtils: Map<string, UtilClass>,
  bindingUtils: Map<string, UtilClass>,
): RecordKind {
  const type = String(record['type'] ?? '');
  if (isGlideBinding(record) && bindingUtils.has(type)) return 'binding';
  if (shapeUtils.has(type) && isGlideShape(record)) return 'shape';
  return 'opaque';
}

export class GlideSchema {
  private _shapeUtils = new Map<string, UtilClass>();
  private _bindingUtils = new Map<string, UtilClass>();
  private _frozen = false;
  readonly limits: Readonly<DocumentLimits>;

  constructor(limits: Partial<DocumentLimits> = {}) {
    this.limits = Object.freeze({ ...DEFAULT_DOCUMENT_LIMITS, ...limits });
  }

  freeze(): void { this._frozen = true; }
  get frozen(): boolean { return this._frozen; }

  registerShapeUtil(UtilClass: UtilClass): void {
    this._registerUtil(this._shapeUtils, 'ShapeUtil', UtilClass);
  }

  registerBindingUtil(UtilClass: UtilClass): void {
    this._registerUtil(this._bindingUtils, 'BindingUtil', UtilClass);
  }

  private _registerUtil(target: Map<string, UtilClass>, label: string, UtilClass: UtilClass): void {
    if (this._frozen) throw new Error(`GlideSchema is frozen. register${label}() called after createEditor() completed.`);
    if (!UtilClass.type) throw new Error(`${label} must have a static 'type' property`);
    if (target.has(UtilClass.type)) throw new Error(`Duplicate ${label} type "${UtilClass.type}"`);
    for (const reference of UtilClass.references ?? []) pointerSegments(reference.path);
    target.set(UtilClass.type, UtilClass);
  }

  /** Normalize legacy creation input into an explicit persisted record envelope. */
  prepareRecord(raw: AnyRecord, versionHint?: number): AnyRecord {
    if (!isPlainObject(raw)) throw new DocumentValidationError('record must be a plain JSON object');
    const explicitKind = typeof raw['kind'] === 'string' && raw['kind'].length > 0
      ? raw['kind'] as RecordKind
      : null;
    const kind = explicitKind ?? inferLegacyKind(raw, this._shapeUtils, this._bindingUtils);
    const type = typeof raw['type'] === 'string' ? raw['type'] : '';
    const util = kind === 'shape'
      ? this._shapeUtils.get(type)
      : kind === 'binding'
        ? this._bindingUtils.get(type)
        : undefined;
    const schemaVersion = raw['schemaVersion'] ?? versionHint ?? util?.migrations?.currentVersion ?? 0;

    return {
      ...raw,
      kind,
      schemaVersion,
      meta: raw['meta'] ?? {},
      ...((kind === 'shape' || kind === 'binding' || kind === 'asset') && raw['props'] === undefined
        ? { props: {} }
        : {}),
    };
  }

  validateProps(shape: GlideShape): void {
    const record = shape as unknown as AnyRecord;
    if (!this.isRenderableShape(record)) return;
    this._validateUtilProps(record, this._shapeUtils.get(shape.type)!);
  }

  validateRecord(record: AnyRecord): void {
    const id = record['id'];
    if (typeof id !== 'string' || id.trim() === '' || id.length > 512) {
      throw new DocumentValidationError('id must be a non-empty string no longer than 512 characters');
    }
    const type = record['type'];
    if (typeof type !== 'string' || type.trim() === '' || type.length > 256) {
      throw new DocumentValidationError('type must be a non-empty string no longer than 256 characters', id);
    }
    const kind = record['kind'];
    if (typeof kind !== 'string' || kind.trim() === '') {
      throw new DocumentValidationError('kind must be a non-empty string', id);
    }
    const version = record['schemaVersion'];
    if (!Number.isInteger(version) || (version as number) < 0) {
      throw new DocumentValidationError('schemaVersion must be a non-negative integer', id);
    }
    if (!isPlainObject(record['meta'])) throw new DocumentValidationError('meta must be a plain JSON object', id);
    if (jsonBytes(record['meta']) > this.limits.maxMetaBytes) throw new DocumentValidationError('metadata exceeds configured size limit', id);
    if (valueDepth(record) > this.limits.maxDepth) throw new DocumentValidationError('record exceeds configured nesting-depth limit', id);

    if (kind === 'shape') {
      for (const field of ['x', 'y', 'rotation']) {
        if (!finite(record[field])) throw new DocumentValidationError(`${field} must be a finite number`, id);
      }
      if (typeof record['index'] !== 'string' || record['index'].length === 0 || record['index'].length > 256) {
        throw new DocumentValidationError('index must be a non-empty string no longer than 256 characters', id);
      }
      if (!isPlainObject(record['props'])) throw new DocumentValidationError('props must be a plain JSON object', id);
      if (jsonBytes(record['props']) > this.limits.maxPropsBytes) throw new DocumentValidationError('props exceeds configured size limit', id);
      const util = this._shapeUtils.get(type);
      if (util && this._isVersionSupported(record, util)) this._validateUtilProps(record, util);
      return;
    }

    if (kind === 'binding') {
      if (typeof record['fromId'] !== 'string' || typeof record['toId'] !== 'string') {
        throw new DocumentValidationError('binding fromId and toId must be strings', id);
      }
      if (!isPlainObject(record['props'])) throw new DocumentValidationError('props must be a plain JSON object', id);
      if (jsonBytes(record['props']) > this.limits.maxPropsBytes) throw new DocumentValidationError('props exceeds configured size limit', id);
      const util = this._bindingUtils.get(type);
      if (util && this._isVersionSupported(record, util)) this._validateUtilProps(record, util);
      return;
    }

    if (kind === 'page') {
      if (typeof record['name'] !== 'string' || record['name'].length === 0 || record['name'].length > 512) {
        throw new DocumentValidationError('page name must be a non-empty string no longer than 512 characters', id);
      }
      return;
    }

    if (kind === 'asset') {
      if (!isPlainObject(record['props'])) throw new DocumentValidationError('asset props must be a plain JSON object', id);
      if (jsonBytes(record['props']) > this.limits.maxPropsBytes) throw new DocumentValidationError('asset props exceeds configured size limit', id);
    }
  }

  validateCandidate(records: readonly AnyRecord[]): void {
    if (records.length > this.limits.maxRecords) throw new DocumentValidationError('document exceeds configured record-count limit');
    const byId = new Map<string, AnyRecord>();
    for (const record of records) {
      this.validateRecord(record);
      const id = record['id'] as string;
      if (byId.has(id)) throw new DocumentValidationError(`duplicate record id "${id}"`);
      byId.set(id, record);
    }

    const terminalOwners = new Set<string>();
    for (const record of records) {
      const id = record['id'] as string;
      if (record['kind'] === 'binding') {
        const from = byId.get(record['fromId'] as string);
        const to = byId.get(record['toId'] as string);
        if (!from || from['kind'] !== 'shape') throw new DocumentValidationError('binding fromId must reference a shape', id);
        if (!to || to['kind'] !== 'shape') throw new DocumentValidationError('binding toId must reference a shape', id);
        const terminal = (record['props'] as AnyRecord)['terminal'];
        if (typeof terminal === 'string') {
          const owner = `${record['fromId']}:${terminal}`;
          if (terminalOwners.has(owner)) throw new DocumentValidationError(`duplicate binding terminal "${terminal}"`, id);
          terminalOwners.add(owner);
        }
      }

      for (const [field, expectedKind] of [['pageId', 'page'], ['assetId', 'asset']] as const) {
        const targetId = record[field];
        if (targetId === undefined || targetId === null) continue;
        const target = typeof targetId === 'string' ? byId.get(targetId) : undefined;
        if (!target || target['kind'] !== expectedKind) throw new DocumentValidationError(`${field} must reference a ${expectedKind}`, id);
      }

      for (const reference of this.getReferenceDescriptors(record)) {
        const targetId = readPointer(record, reference.path);
        if (targetId === undefined || targetId === null) continue;
        if (typeof targetId !== 'string') {
          throw new DocumentValidationError(`${reference.path} must contain a record ID or null`, id);
        }
        const target = byId.get(targetId);
        if (!target || (reference.targetKind && target['kind'] !== reference.targetKind)) {
          const suffix = reference.targetKind ? ` ${reference.targetKind}` : '';
          throw new DocumentValidationError(`${reference.path} must reference an existing${suffix} record`, id);
        }
      }

      if (record['kind'] === 'binding') {
        const terminal = (record['props'] as AnyRecord)['terminal'];
        if (terminal === 'start' || terminal === 'end') {
          const from = byId.get(record['fromId'] as string);
          const cachedTarget = from
            ? readPointer(from, `/props/${terminal}/boundShapeId`)
            : undefined;
          // Null is allowed during a live handle preview while the durable
          // binding remains in place. Any concrete cached target must agree
          // with the authoritative binding record.
          if (typeof cachedTarget === 'string' && cachedTarget !== record['toId']) {
            throw new DocumentValidationError(`binding target conflicts with the arrow ${terminal} terminal`, id);
          }
        }
      }
    }

    this._validateParentGraph(byId);
  }

  loadDocument(input: unknown): LoadedDocument {
    if (!isPlainObject(input)) throw new DocumentValidationError('document must be a plain JSON object');
    if (jsonBytes(input) > this.limits.maxDocumentBytes) throw new DocumentValidationError('document exceeds configured decoded-size limit');
    if (!isPlainObject(input['schema'])) throw new DocumentValidationError('document.schema must be an object');
    if (!Array.isArray(input['records'])) throw new DocumentValidationError('document.records must be an array');
    if (input['records'].length > this.limits.maxRecords) throw new DocumentValidationError('document exceeds configured record-count limit');

    const header = input['schema'] as AnyRecord;
    const sourceStoreVersion = Number(header['storeVersion'] ?? 1);
    if (!Number.isInteger(sourceStoreVersion) || sourceStoreVersion < 1) throw new DocumentValidationError('invalid storeVersion');
    if (sourceStoreVersion > CURRENT_STORE_VERSION) throw new DocumentValidationError(`unsupported future storeVersion ${sourceStoreVersion}`);
    const shapeVersions = isPlainObject(header['shapes']) ? header['shapes'] : {};
    const bindingVersions = isPlainObject(header['bindings']) ? header['bindings'] : {};
    if (sourceStoreVersion >= 2 && (!isPlainObject(header['shapes']) || !isPlainObject(header['bindings']))) {
      throw new DocumentValidationError('store-v2 schema must include shape and binding version maps');
    }
    const migrations: string[] = sourceStoreVersion < CURRENT_STORE_VERSION
      ? [`store:${sourceStoreVersion}->${CURRENT_STORE_VERSION}`]
      : [];
    const opaqueRecordIds: string[] = [];
    const ids = new Set<string>();

    let records = input['records'].map((value, ordinal) => {
      if (!isPlainObject(value)) throw new DocumentValidationError(`record at index ${ordinal} must be an object`);
      const raw = { ...value };
      if (sourceStoreVersion >= 2) {
        if (typeof raw['kind'] !== 'string' || raw['kind'].length === 0) {
          throw new DocumentValidationError('store-v2 record is missing kind', String(raw['id'] ?? ordinal));
        }
        if (!Number.isInteger(raw['schemaVersion'])) {
          throw new DocumentValidationError('store-v2 record is missing schemaVersion', String(raw['id'] ?? ordinal));
        }
        if (!isPlainObject(raw['meta'])) {
          throw new DocumentValidationError('store-v2 record is missing meta', String(raw['id'] ?? ordinal));
        }
      }
      const inferredKind = typeof raw['kind'] === 'string'
        ? raw['kind']
        : inferLegacyKind(raw, this._shapeUtils, this._bindingUtils);
      const type = String(raw['type'] ?? '');
      const util = inferredKind === 'shape'
        ? this._shapeUtils.get(type)
        : inferredKind === 'binding'
          ? this._bindingUtils.get(type)
          : undefined;
      const headerVersion = Number((inferredKind === 'binding' ? bindingVersions : shapeVersions)[type] ?? 0);
      const savedVersion = Number(raw['schemaVersion'] ?? headerVersion);
      let migrated = raw;
      if (util?.migrations && savedVersion <= util.migrations.currentVersion) {
        if (savedVersion < util.migrations.currentVersion) {
          migrated = migrateRecord(raw, util.migrations, savedVersion);
          migrations.push(`${String(raw['id'])}:${savedVersion}->${util.migrations.currentVersion}`);
        }
        migrated = { ...migrated, schemaVersion: util.migrations.currentVersion };
      }
      const prepared = this.prepareRecord(migrated, savedVersion);
      const id = prepared['id'];
      if (typeof id === 'string') {
        if (ids.has(id)) throw new DocumentValidationError(`duplicate record id "${id}"`);
        ids.add(id);
        if (prepared['kind'] === 'opaque' || !this.hasRuntimeCapability(prepared)) opaqueRecordIds.push(id);
      }
      return prepared;
    });

    if (sourceStoreVersion < 2) {
      const shapes = records.filter(record => record['kind'] === 'shape');
      if (shapes.length > 0) {
        const existingPage = records.find(record => record['kind'] === 'page');
        let pageId = typeof existingPage?.['id'] === 'string' ? existingPage['id'] : 'page:default';
        let pageSuffix = 1;
        while (!existingPage && ids.has(pageId)) pageId = `page:default:${pageSuffix++}`;
        if (!existingPage) {
          const page: AnyRecord = {
            id: pageId,
            kind: 'page',
            type: 'page',
            schemaVersion: 0,
            name: 'Page 1',
            meta: {},
          };
          records = [...records, page];
          ids.add(pageId);
          migrations.push('legacy:add-default-page');
        }

        records = records.map(record => record['kind'] === 'shape' && record['pageId'] === undefined
          ? { ...record, pageId }
          : record);

        migrations.push('legacy:add-page-membership');
      }
    }

    if (sourceStoreVersion < 3) {
      const originalOrdinal = new Map(records.map((record, ordinal) => [String(record['id']), ordinal]));
      const groups = new Map<string, AnyRecord[]>();
      for (const record of records) {
        if (record['kind'] !== 'shape') continue;
        const group = getShapeOrderParentId(record);
        const members = groups.get(group) ?? [];
        members.push(record);
        groups.set(group, members);
      }
      const normalizedIndex = new Map<string, string>();
      for (const members of groups.values()) {
        members.sort((left, right) => {
          const leftIndex = String(left['index'] ?? '');
          const rightIndex = String(right['index'] ?? '');
          const byIndex = leftIndex < rightIndex ? -1 : leftIndex > rightIndex ? 1 : 0;
          const byOrdinal = (originalOrdinal.get(String(left['id'])) ?? 0)
            - (originalOrdinal.get(String(right['id'])) ?? 0);
          const leftId = String(left['id']);
          const rightId = String(right['id']);
          return byIndex || byOrdinal || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0);
        });
        const keys = generateRebalancedOrderKeys(members.length);
        members.forEach((record, ordinal) => normalizedIndex.set(String(record['id']), keys[ordinal]!));
      }
      records = records.map(record => normalizedIndex.has(String(record['id']))
        ? { ...record, index: normalizedIndex.get(String(record['id']))! }
        : record);
      migrations.push('store:normalize-canonical-order');
    }

    if (sourceStoreVersion < 4) {
      records = records.map(record => {
        if (record['kind'] !== 'shape' || record['type'] !== 'arrow') return record;
        const rotation = Number(record['rotation'] ?? 0);
        if (!Number.isFinite(rotation) || rotation === 0) return { ...record, rotation: 0 };
        const props = isPlainObject(record['props']) ? record['props'] : {};
        const start = isPlainObject(props['start']) ? props['start'] : {};
        const end = isPlainObject(props['end']) ? props['end'] : {};
        const startPoint = isPlainObject(start['point']) ? start['point'] : {};
        const endPoint = isPlainObject(end['point']) ? end['point'] : {};
        const sx = Number(startPoint['x'] ?? 0);
        const sy = Number(startPoint['y'] ?? 0);
        const ex = Number(endPoint['x'] ?? 0);
        const ey = Number(endPoint['y'] ?? 0);
        const centerX = (sx + ex) / 2;
        const centerY = (sy + ey) / 2;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const rotate = (x: number, y: number) => ({
          x: centerX + (x - centerX) * cos - (y - centerY) * sin,
          y: centerY + (x - centerX) * sin + (y - centerY) * cos,
        });
        const rotatedStart = rotate(sx, sy);
        const rotatedEnd = rotate(ex, ey);
        return {
          ...record,
          x: Number(record['x'] ?? 0) + rotatedStart.x,
          y: Number(record['y'] ?? 0) + rotatedStart.y,
          rotation: 0,
          props: {
            ...props,
            start: { ...start, point: { x: 0, y: 0 } },
            end: {
              ...end,
              point: {
                x: rotatedEnd.x - rotatedStart.x,
                y: rotatedEnd.y - rotatedStart.y,
              },
            },
          },
        };
      });
      migrations.push('store:fold-arrow-rotation');
    }

    this.validateCandidate(records);
    return {
      records,
      report: Object.freeze({
        sourceStoreVersion,
        targetStoreVersion: CURRENT_STORE_VERSION,
        recordCount: records.length,
        migrations: Object.freeze(migrations),
        opaqueRecordIds: Object.freeze(opaqueRecordIds),
        repairs: Object.freeze([]),
        warnings: Object.freeze([]),
      }),
    };
  }

  /** Compatibility API retained for existing callers. */
  load(doc: GlideDocument): AnyRecord[] { return this.loadDocument(doc).records; }

  save(records: AnyRecord[]): GlideDocument {
    const shapeVersions = Object.fromEntries(Array.from(this._shapeUtils, ([type, util]) => [type, util.migrations?.currentVersion ?? 0]));
    const bindingVersions = Object.fromEntries(Array.from(this._bindingUtils, ([type, util]) => [type, util.migrations?.currentVersion ?? 0]));
    const prepared = records.map(record => this.prepareRecord(record));
    this.validateCandidate(prepared);
    return {
      schema: { storeVersion: CURRENT_STORE_VERSION, shapes: shapeVersions, bindings: bindingVersions },
      records: prepared as GlideDocument['records'],
    };
  }

  getUtil(type: string): UtilClass | undefined { return this._shapeUtils.get(type); }
  getBindingUtil(type: string): UtilClass | undefined { return this._bindingUtils.get(type); }
  hasUtil(type: string): boolean { return this._shapeUtils.has(type); }
  hasBindingUtil(type: string): boolean { return this._bindingUtils.has(type); }

  isShapeRecord(record: AnyRecord): boolean { return record['kind'] === 'shape'; }
  isBindingRecord(record: AnyRecord): boolean { return record['kind'] === 'binding'; }
  isRenderableShape(record: AnyRecord): boolean {
    if (record['kind'] !== 'shape') return false;
    const util = this._shapeUtils.get(String(record['type']));
    return Boolean(util && this._isVersionSupported(record, util));
  }
  hasRuntimeCapability(record: AnyRecord): boolean {
    if (record['kind'] === 'shape') return this.isRenderableShape(record);
    if (record['kind'] === 'binding') {
      const util = this._bindingUtils.get(String(record['type']));
      return Boolean(util && this._isVersionSupported(record, util));
    }
    return record['kind'] === 'page' || record['kind'] === 'asset';
  }

  getReferenceDescriptors(record: AnyRecord): readonly RecordReferenceDescriptor[] {
    const util = record['kind'] === 'shape'
      ? this._shapeUtils.get(String(record['type']))
      : record['kind'] === 'binding'
        ? this._bindingUtils.get(String(record['type']))
        : undefined;
    return util?.references ?? [];
  }

  private _isVersionSupported(record: AnyRecord, util: UtilClass): boolean {
    return Number(record['schemaVersion'] ?? 0) <= (util.migrations?.currentVersion ?? 0);
  }

  private _validateUtilProps(record: AnyRecord, util: UtilClass): void {
    if (!util.props) return;
    const props = record['props'] as AnyRecord;
    for (const [key, validator] of Object.entries(util.props)) {
      try {
        validator.validate(props[key]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new DocumentValidationError(`prop "${key}": ${message}`, String(record['id']));
      }
    }
  }

  private _validateParentGraph(byId: Map<string, AnyRecord>): void {
    for (const record of byId.values()) {
      const id = record['id'] as string;
      const parentId = record['parentId'];
      if (parentId === undefined || parentId === null) continue;
      if (typeof parentId !== 'string' || !byId.has(parentId)) throw new DocumentValidationError('parentId must reference an existing record', id);
      const seen = new Set([id]);
      let cursor: AnyRecord | undefined = record;
      while (typeof cursor?.['parentId'] === 'string') {
        const nextId = cursor['parentId'] as string;
        if (seen.has(nextId)) throw new DocumentValidationError('parent relationship contains a cycle', id);
        seen.add(nextId);
        cursor = byId.get(nextId);
      }
    }
  }
}
