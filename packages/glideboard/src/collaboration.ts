import * as Y from 'yjs';
import type {
  GlideEditor,
  AnyRecord,
  MutationCapability,
  StoreChangeSet,
  StoreRecord,
} from '@durgakiran/glideline';
import type { GlideboardCollaborationConfig } from './types.js';
import { GlideboardCollaborationCheckpointSource } from './collaboration/CollaborationCheckpointSource.js';
import type { CollaborationCheckpointSource } from './durability/types.js';

const LEGACY_RECORDS_KEY = 'glideboard-records';
const RECORDS_KEY = 'glideboard-records-v2';
const META_KEY = 'glideboard-meta';
const RICH_TEXT_FRAGMENTS_KEY = 'glideboard-rich-text-fragments-v1';
const SHARED_SCHEMA_VERSION = 2;
const SHARED_CAPABILITY_RANGE = Object.freeze({ min: 2, max: 2 });
const GENERATION_KEY = '$generation';
const TOMBSTONE_KEY = '$tombstone';
const OPAQUE_KEY = '$opaque';
const LOCAL_COMMAND_ORIGIN = Object.freeze({ kind: 'glideboard-local-command' });
const BOOTSTRAP_ORIGIN = Object.freeze({ kind: 'glideboard-bootstrap' });
const TEXT_FIELDS = new Set(['text', 'label', 'richText']);

function cloneRecord<T extends AnyRecord>(record: T): T {
  return JSON.parse(JSON.stringify(record)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertJsonValue(value: unknown, path = ''): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Unsupported non-finite number at ${path || '/'}.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}/${index}`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new Error(`Unsupported undefined value at ${path}/${key}.`);
      assertJsonValue(item, `${path}/${key}`);
    }
    return;
  }
  throw new Error(`Unsupported collaborative value at ${path || '/'}.`);
}

function cloneJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function syncObject(map: Y.Map<unknown>, object: Record<string, unknown>): void {
  assertJsonValue(object);
  for (const key of [...map.keys()]) {
    if (key === GENERATION_KEY || key === TOMBSTONE_KEY || key === OPAQUE_KEY) continue;
    if (!(key in object)) map.delete(key);
  }
  for (const [key, value] of Object.entries(object)) {
    const existing = map.get(key);
    if (existing instanceof Y.Map && isPlainObject(value)) {
      syncObject(existing, value);
    } else if (existing instanceof Y.Text && typeof value === 'string' && TEXT_FIELDS.has(key)) {
      const current = existing.toString();
      if (current !== value) {
        if (current.length) existing.delete(0, current.length);
        if (value.length) existing.insert(0, value);
      }
    } else if (existing instanceof Y.Array && Array.isArray(value)) {
      const current = existing.toJSON();
      if (JSON.stringify(current) !== JSON.stringify(value)) {
        if (existing.length) existing.delete(0, existing.length);
        if (value.length) existing.insert(0, value.map(item => cloneJson(item)));
      }
    } else if (isPlainObject(value)) {
      const nested = new Y.Map<unknown>();
      map.set(key, nested);
      syncObject(nested, value);
    } else if (typeof value === 'string' && TEXT_FIELDS.has(key)) {
      const text = new Y.Text();
      map.set(key, text);
      if (value) text.insert(0, value);
    } else if (Array.isArray(value)) {
      const array = new Y.Array<unknown>();
      map.set(key, array);
      if (value.length) array.insert(0, value.map(item => cloneJson(item)));
    } else if (existing !== value) {
      map.set(key, value);
    }
  }
}

function materializeSharedValue(value: unknown): unknown {
  if (value instanceof Y.Text) return value.toString();
  if (value instanceof Y.Array) return value.toArray().map(materializeSharedValue);
  if (value instanceof Y.Map) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of value.entries()) {
      if (key === GENERATION_KEY || key === TOMBSTONE_KEY || key === OPAQUE_KEY) continue;
      output[key] = materializeSharedValue(item);
    }
    return output;
  }
  return cloneJson(value);
}

function materializeRecord(shared: Y.Map<unknown>): AnyRecord | null {
  if (shared.get(TOMBSTONE_KEY) === true) return null;
  const opaque = shared.get(OPAQUE_KEY);
  if (opaque !== undefined) {
    if (!isPlainObject(opaque)) throw new Error('Opaque collaborative record payload is invalid.');
    return cloneJson(opaque) as AnyRecord;
  }
  const materialized = materializeSharedValue(shared);
  if (!isPlainObject(materialized)) throw new Error('Collaborative record is not an object.');
  return materialized as AnyRecord;
}

function nextGeneration(doc: Y.Doc, recordId: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${doc.clientID}-${Date.now()}-${Math.random()}`;
  return `${recordId}:${random}`;
}

function writeRecord(doc: Y.Doc, records: Y.Map<Y.Map<unknown>>, record: StoreRecord): void {
  const id = String(record.id ?? '');
  if (!id) throw new Error('Collaborative records require an ID.');
  let shared = records.get(id);
  if (!(shared instanceof Y.Map) || shared.get(TOMBSTONE_KEY) === true) {
    shared = new Y.Map<unknown>();
    records.set(id, shared);
    shared.set(GENERATION_KEY, nextGeneration(doc, id));
    shared.set(TOMBSTONE_KEY, false);
  }
  const cloned = cloneRecord(record as unknown as AnyRecord);
  if (cloned.kind === 'opaque') {
    for (const key of [...shared.keys()]) {
      if (key !== GENERATION_KEY && key !== TOMBSTONE_KEY) shared.delete(key);
    }
    shared.set(OPAQUE_KEY, cloned);
  } else {
    shared.delete(OPAQUE_KEY);
    syncObject(shared, cloned);
  }
}

function applyChangesToSharedDoc(
  doc: Y.Doc,
  records: Y.Map<Y.Map<unknown>>,
  changes: StoreChangeSet,
): void {
  for (const delta of changes.deltas) {
    if (delta.after === null) {
      const shared = records.get(delta.id);
      if (shared instanceof Y.Map) shared.set(TOMBSTONE_KEY, true);
      continue;
    }
    writeRecord(doc, records, delta.after);
  }
}

function materializeRecords(records: Y.Map<Y.Map<unknown>>): AnyRecord[] {
  const result: AnyRecord[] = [];
  for (const shared of records.values()) {
    if (!(shared instanceof Y.Map)) throw new Error('Incompatible whole-record collaboration value.');
    const record = materializeRecord(shared);
    if (record) result.push(record);
  }
  return result;
}

function changesMatchSharedState(records: Y.Map<Y.Map<unknown>>, changes: StoreChangeSet): boolean {
  for (const delta of changes.deltas) {
    const shared = records.get(delta.id);
    const actual = shared instanceof Y.Map ? materializeRecord(shared) : null;
    if (JSON.stringify(actual) !== JSON.stringify(delta.after)) return false;
  }
  return true;
}

function applyFullProjection(
  editor: GlideEditor,
  records: Y.Map<Y.Map<unknown>>,
  capability: MutationCapability,
): void {
  const nextRecords = materializeRecords(records).map(cloneRecord);
  const nextIds = new Set(nextRecords.map(record => String(record.id ?? '')));
  const removeIds = editor.serialize().records
    .map(record => String(record.id ?? ''))
    .filter(id => id && !nextIds.has(id));
  editor.transactWithCapability(capability, { origin: 'remote', history: 'ignore' }, tx => {
    for (const id of removeIds) tx.remove(id);
    for (const record of nextRecords) tx.upsert(record);
  });
}

function providerIsReady(config: GlideboardCollaborationConfig): boolean {
  return !config.provider || config.provider.synced !== false;
}

export function bindGlideboardCollaboration(
  editor: GlideEditor,
  config: GlideboardCollaborationConfig,
  capability: MutationCapability,
) {
  const doc = config.doc as Y.Doc;
  const records = doc.getMap<Y.Map<unknown>>(RECORDS_KEY);
  const legacyRecords = doc.getMap<AnyRecord>(LEGACY_RECORDS_KEY);
  const metadata = doc.getMap<unknown>(META_KEY);
  const richTextFragments = doc.getMap<Y.XmlFragment>(RICH_TEXT_FRAGMENTS_KEY);
  const checkpoints = new GlideboardCollaborationCheckpointSource();
  const localDocumentSchema = editor.serialize().schema;
  let disposed = false;
  let applyingRemote = false;
  let ready = providerIsReady(config);

  const recordCheckpoint = (storeRevision: number) => {
    void checkpoints.record(doc, storeRevision).catch(() => {});
  };

  const validateMetadata = (): boolean => {
    const version = metadata.get('schemaVersion');
    if (version !== undefined && version !== SHARED_SCHEMA_VERSION) {
      checkpoints.markIncompatible();
      return false;
    }
    const capabilityRange = metadata.get('clientCapabilityRange') as { min?: number; max?: number } | undefined;
    if (
      capabilityRange
      && (
        typeof capabilityRange.min !== 'number'
        || typeof capabilityRange.max !== 'number'
        || capabilityRange.min > SHARED_CAPABILITY_RANGE.max
        || capabilityRange.max < SHARED_CAPABILITY_RANGE.min
      )
    ) {
      checkpoints.markIncompatible();
      return false;
    }
    const sharedBoardIdentity = metadata.get('boardIdentity');
    if (
      config.boardIdentity
      && sharedBoardIdentity !== undefined
      && sharedBoardIdentity !== config.boardIdentity
    ) {
      checkpoints.markIncompatible();
      return false;
    }
    const requiredSchema = metadata.get('documentSchema') as typeof localDocumentSchema | undefined;
    if (requiredSchema) {
      const supports = requiredSchema.storeVersion <= localDocumentSchema.storeVersion
        && Object.entries(requiredSchema.shapes ?? {}).every(([type, version]) =>
          (localDocumentSchema.shapes[type] ?? -1) >= Number(version))
        && Object.entries(requiredSchema.bindings ?? {}).every(([type, version]) =>
          (localDocumentSchema.bindings[type] ?? -1) >= Number(version));
      if (!supports) {
        checkpoints.markIncompatible();
        return false;
      }
    }
    return true;
  };

  const projectCurrentSharedState = (): boolean => {
    if (!validateMetadata()) return false;
    applyingRemote = true;
    try {
      applyFullProjection(editor, records, capability);
      recordCheckpoint(editor.store.revision);
      if (ready) checkpoints.markHealthy();
      return true;
    } catch {
      // Retry from the complete Y.Doc once; a transient observer/projection
      // failure must not leave a partial store projection.
      try {
        applyFullProjection(editor, records, capability);
        recordCheckpoint(editor.store.revision);
        if (ready) checkpoints.markHealthy();
        return true;
      } catch {
        checkpoints.quarantine();
        return false;
      }
    } finally {
      applyingRemote = false;
    }
  };

  const seedOrMigrate = () => {
    if (disposed || !ready || !validateMetadata()) return;
    const previousDocumentSchema = metadata.get('documentSchema') as typeof localDocumentSchema | undefined;
    const hadSharedRecords = records.size > 0;
    const hadLegacyRecords = legacyRecords.size > 0;
    doc.transact(() => {
      if (metadata.get('schemaVersion') === undefined) {
        metadata.set('schemaVersion', SHARED_SCHEMA_VERSION);
        metadata.set('recordModel', 'nested-map-tombstone-v1');
        metadata.set('clientCapabilityRange', SHARED_CAPABILITY_RANGE);
      }
      if (config.boardIdentity && metadata.get('boardIdentity') === undefined) {
        metadata.set('boardIdentity', config.boardIdentity);
      }
      if (config.bootstrapRevision && metadata.get('bootstrapRevision') === undefined) {
        metadata.set('bootstrapRevision', config.bootstrapRevision);
      }
      if (metadata.get('documentSchema') === undefined) metadata.set('documentSchema', localDocumentSchema);
      if (records.size === 0 && legacyRecords.size > 0) {
        for (const record of legacyRecords.values()) writeRecord(doc, records, record as StoreRecord);
      } else if (records.size === 0) {
        for (const record of editor.serialize().records) writeRecord(doc, records, record as StoreRecord);
      }
      const migrationSchema = previousDocumentSchema
        ?? (hadLegacyRecords ? { storeVersion: 1, shapes: {}, bindings: {} } : undefined)
        ?? (hadSharedRecords ? {
          storeVersion: 2,
          shapes: localDocumentSchema.shapes,
          bindings: localDocumentSchema.bindings,
        } : undefined);
      if (migrationSchema && migrationSchema.storeVersion < localDocumentSchema.storeVersion && records.size > 0) {
        const migrated = editor.schema.loadDocument({
          schema: migrationSchema,
          records: materializeRecords(records),
        });
        for (const record of migrated.records) writeRecord(doc, records, record as StoreRecord);
        metadata.set('documentSchema', localDocumentSchema);
      }
    }, BOOTSTRAP_ORIGIN);
    projectCurrentSharedState();
  };

  const handleSharedChange = (_events: readonly unknown[], transaction: Y.Transaction) => {
    if (disposed || transaction.origin === LOCAL_COMMAND_ORIGIN || transaction.origin === BOOTSTRAP_ORIGIN) return;
    projectCurrentSharedState();
  };
  records.observeDeep(handleSharedChange);
  metadata.observeDeep(handleSharedChange);
  const handleRichTextChange = () => {
    if (!disposed) recordCheckpoint(editor.store.revision);
  };
  richTextFragments.observeDeep(handleRichTextChange);
  const handleLegacyChange = (_event: unknown, transaction: Y.Transaction) => {
    if (disposed || transaction.origin === BOOTSTRAP_ORIGIN) return;
    if (records.size > 0) {
      // A pre-v2 client is still writing whole-record values. Continuing would
      // silently fork the board, so freeze this client instead.
      checkpoints.markIncompatible();
      return;
    }
    if (ready) seedOrMigrate();
  };
  legacyRecords.observe(handleLegacyChange);

  const stopAtomicLocalProjection = editor.participateInCommitsWithCapability(capability, changes => {
    if (applyingRemote || changes.origin === 'remote' || changes.scope === 'ephemeral') return null;
    if (checkpoints.status.peek() !== 'healthy') {
      throw new Error(`Cannot edit while collaboration projection is ${checkpoints.status.peek()}.`);
    }
    let observerError: unknown;
    try {
      doc.transact(() => applyChangesToSharedDoc(doc, records, changes), LOCAL_COMMAND_ORIGIN);
    } catch (error) {
      observerError = error;
    }
    if (!changesMatchSharedState(records, changes)) {
      checkpoints.quarantine();
      throw observerError ?? new Error('Yjs did not reflect the prepared Glideline command.');
    }
    recordCheckpoint(changes.revision);
    return { publish() {} };
  });

  const handleProviderReady = (synced: boolean) => {
    if (!synced || disposed) return;
    ready = true;
    seedOrMigrate();
  };
  config.provider?.on?.('sync', handleProviderReady);
  config.provider?.on?.('synced', handleProviderReady);

  if (records.size > 0) projectCurrentSharedState();
  if (ready) seedOrMigrate();

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    config.provider?.off?.('sync', handleProviderReady);
    config.provider?.off?.('synced', handleProviderReady);
    records.unobserveDeep(handleSharedChange);
    metadata.unobserveDeep(handleSharedChange);
    richTextFragments.unobserveDeep(handleRichTextChange);
    legacyRecords.unobserve(handleLegacyChange);
    stopAtomicLocalProjection();
    checkpoints.dispose();
  };
  return Object.assign(cleanup, { checkpoints }) as (() => void) & {
    readonly checkpoints: CollaborationCheckpointSource;
  };
}
