import type {
  GlideEditor,
  GlideShape,
  GlideBinding,
  MutationCapability,
  StoreChangeSet,
} from '@durgakiran/glideline';
import type {
  GlideboardCollaborationConfig,
  GlideboardMapEvent,
  GlideboardSharedMap,
} from './types';

type AnyRecord = GlideShape | GlideBinding | Record<string, unknown>;

const RECORDS_KEY = 'glideboard-records';

function cloneRecord<T extends AnyRecord>(record: T): T {
  return JSON.parse(JSON.stringify(record)) as T;
}

function getAllRecordIds(editor: GlideEditor): string[] {
  return editor.serialize().records
    .map(record => String(record.id ?? ''))
    .filter(Boolean);
}

function applyFullMapState(
  editor: GlideEditor,
  recordsMap: GlideboardSharedMap<AnyRecord>,
  capability: MutationCapability,
) {
  const nextRecords = Array.from(recordsMap.values()).map(record => cloneRecord(record));
  const nextIds = new Set(nextRecords.map(record => String(record.id ?? '')));
  const existingIds = getAllRecordIds(editor);
  const removeIds = existingIds.filter(id => !nextIds.has(id));

  editor.transactWithCapability(capability, { origin: 'remote', history: 'ignore' }, tx => {
    for (const id of removeIds) tx.remove(id);
    for (const record of nextRecords) tx.upsert(record as Record<string, unknown>);
  });
}

export function bindGlideboardCollaboration(
  editor: GlideEditor,
  config: GlideboardCollaborationConfig,
  capability: MutationCapability,
) {
  const recordsMap = config.doc.getMap<AnyRecord>(RECORDS_KEY);
  let applyingRemote = false;

  if (recordsMap.size > 0) {
    applyingRemote = true;
    try {
      applyFullMapState(editor, recordsMap, capability);
    } finally {
      applyingRemote = false;
    }
  } else {
    const localRecords = editor.serialize().records;
    if (localRecords.length > 0) {
      config.doc.transact(() => {
        for (const record of localRecords) {
          recordsMap.set(String(record.id), cloneRecord(record as AnyRecord));
        }
      });
    }
  }

  const publishLocalChanges = (changes: StoreChangeSet) => {
    if (applyingRemote || changes.origin === 'remote' || changes.scope === 'ephemeral') return;
    config.doc.transact(() => {
      for (const delta of changes.deltas) {
        if (delta.after === null) recordsMap.delete(delta.id);
        else recordsMap.set(delta.id, cloneRecord(delta.after as AnyRecord));
      }
    });
  };
  const stopPublishingLocalChanges = editor.store.listen(publishLocalChanges);

  const handleRemoteChange = (event: GlideboardMapEvent, transaction: any) => {
    if (transaction && transaction.local) return;
    if (applyingRemote) return;
    applyingRemote = true;
    try {
      const toRemove: string[] = [];
      const toPut: Record<string, unknown>[] = [];

      event.changes.keys.forEach((change, key) => {
        if (change.action === 'delete') {
          toRemove.push(key);
          return;
        }

        const record = recordsMap.get(key);
        if (record) {
          toPut.push(cloneRecord(record) as Record<string, unknown>);
        }
      });

      editor.transactWithCapability(capability, { origin: 'remote', history: 'ignore' }, tx => {
        for (const id of toRemove) tx.remove(id);
        for (const record of toPut) tx.upsert(record);
      });
    } finally {
      applyingRemote = false;
    }
  };

  recordsMap.observe(handleRemoteChange);

  return () => {
    recordsMap.unobserve(handleRemoteChange);
    stopPublishingLocalChanges();
  };
}
