const RECORDS_KEY = 'glideboard-records';
function cloneRecord(record) {
    return JSON.parse(JSON.stringify(record));
}
function getAllRecordIds(editor) {
    return editor.serialize().records
        .map(record => String(record.id ?? ''))
        .filter(Boolean);
}
function applyFullMapState(editor, recordsMap) {
    const nextRecords = Array.from(recordsMap.values()).map(record => cloneRecord(record));
    const nextIds = new Set(nextRecords.map(record => String(record.id ?? '')));
    const existingIds = getAllRecordIds(editor);
    const removeIds = existingIds.filter(id => !nextIds.has(id));
    if (removeIds.length > 0) {
        editor.store.remove(removeIds);
    }
    if (nextRecords.length > 0) {
        editor.store.put(nextRecords);
    }
}
export function bindGlideboardCollaboration(editor, config) {
    const recordsMap = config.doc.getMap(RECORDS_KEY);
    const originalPut = editor.store.put.bind(editor.store);
    const originalRemove = editor.store.remove.bind(editor.store);
    let applyingRemote = false;
    if (recordsMap.size > 0) {
        applyingRemote = true;
        try {
            applyFullMapState(editor, recordsMap);
        }
        finally {
            applyingRemote = false;
        }
    }
    else {
        const localRecords = editor.serialize().records;
        if (localRecords.length > 0) {
            config.doc.transact(() => {
                for (const record of localRecords) {
                    recordsMap.set(String(record.id), cloneRecord(record));
                }
            });
        }
    }
    editor.store.put = ((records) => {
        originalPut(records);
        if (applyingRemote)
            return;
        config.doc.transact(() => {
            for (const record of records) {
                recordsMap.set(String(record.id), cloneRecord(record));
            }
        });
    });
    editor.store.remove = ((ids) => {
        originalRemove(ids);
        if (applyingRemote)
            return;
        config.doc.transact(() => {
            for (const id of ids) {
                recordsMap.delete(id);
            }
        });
    });
    const handleRemoteChange = (event) => {
        if (applyingRemote)
            return;
        applyingRemote = true;
        try {
            const toRemove = [];
            const toPut = [];
            event.changes.keys.forEach((change, key) => {
                if (change.action === 'delete') {
                    toRemove.push(key);
                    return;
                }
                const record = recordsMap.get(key);
                if (record) {
                    toPut.push(cloneRecord(record));
                }
            });
            if (toRemove.length > 0) {
                originalRemove(toRemove);
            }
            if (toPut.length > 0) {
                originalPut(toPut);
            }
        }
        finally {
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
//# sourceMappingURL=collaboration.js.map