import type { GlideEditor, GlideShape, GlideBinding } from '@durgakiran/glideline';
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

function applyFullMapState(editor: GlideEditor, recordsMap: GlideboardSharedMap<AnyRecord>) {
  const nextRecords = Array.from(recordsMap.values()).map(record => cloneRecord(record));
  const nextIds = new Set(nextRecords.map(record => String(record.id ?? '')));
  const existingIds = getAllRecordIds(editor);
  const removeIds = existingIds.filter(id => !nextIds.has(id));

  if (removeIds.length > 0) {
    editor.store.remove(removeIds);
  }
  if (nextRecords.length > 0) {
    editor.store.put(nextRecords as Record<string, unknown>[]);
  }
}

export function bindGlideboardCollaboration(
  editor: GlideEditor,
  config: GlideboardCollaborationConfig,
) {
  const recordsMap = config.doc.getMap<AnyRecord>(RECORDS_KEY);
  const originalPut = editor.store.put.bind(editor.store);
  const originalRemove = editor.store.remove.bind(editor.store);
  let applyingRemote = false;

  if (recordsMap.size > 0) {
    applyingRemote = true;
    try {
      applyFullMapState(editor, recordsMap);
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

  editor.store.put = ((records: Record<string, unknown>[]) => {
    originalPut(records);
    if (applyingRemote) return;
    config.doc.transact(() => {
      for (const record of records) {
        recordsMap.set(String(record.id), cloneRecord(record as AnyRecord));
      }
    });
  }) as typeof editor.store.put;

  editor.store.remove = ((ids: string[]) => {
    originalRemove(ids);
    if (applyingRemote) return;
    config.doc.transact(() => {
      for (const id of ids) {
        recordsMap.delete(id);
      }
    });
  }) as typeof editor.store.remove;

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

      if (toRemove.length > 0) {
        originalRemove(toRemove);
      }
      if (toPut.length > 0) {
        originalPut(toPut);
      }
    } finally {
      applyingRemote = false;
    }
  };

  recordsMap.observe(handleRemoteChange);

  if (config.provider?.awareness && config.user) {
    config.provider.awareness.setLocalStateField('user', {
      id: config.user.id,
      name: config.user.name,
      color: config.user.color,
    });
  }

  return () => {
    recordsMap.unobserve(handleRemoteChange);
    editor.store.put = originalPut;
    editor.store.remove = originalRemove;
    config.provider?.awareness?.setLocalStateField('user', null);
  };
}
