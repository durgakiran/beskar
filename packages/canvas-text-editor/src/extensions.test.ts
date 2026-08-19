import { Editor } from '@tiptap/core';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createCanvasTextExtensions } from './extensions.js';

describe('canvas text extensions', () => {
  it('contains only the lightweight schema profile', () => {
    const names = createCanvasTextExtensions().map(extension => extension.name);
    expect(names).toEqual(expect.arrayContaining([
      'doc', 'paragraph', 'text', 'bold', 'italic', 'code', 'hardBreak',
      'bulletList', 'orderedList', 'listItem', 'link', 'highlight', 'undoRedo',
    ]));
    expect(names).not.toEqual(expect.arrayContaining(['heading', 'blockquote', 'codeBlock', 'image', 'table']));
  });

  it('converges character edits through shape fragments', () => {
    const firstDoc = new Y.Doc();
    const secondDoc = new Y.Doc();
    const syncFirst = (update: Uint8Array, origin: unknown) => {
      if (origin !== secondDoc) Y.applyUpdate(secondDoc, update, firstDoc);
    };
    const syncSecond = (update: Uint8Array, origin: unknown) => {
      if (origin !== firstDoc) Y.applyUpdate(firstDoc, update, secondDoc);
    };
    firstDoc.on('update', syncFirst);
    secondDoc.on('update', syncSecond);
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc), firstDoc);

    const first = new Editor({ extensions: createCanvasTextExtensions({ fragment: firstDoc.getXmlFragment('shape:text-1') }) });
    const second = new Editor({ extensions: createCanvasTextExtensions({ fragment: secondDoc.getXmlFragment('shape:text-1') }) });
    first.commands.insertContent('Hello');
    second.commands.setTextSelection(second.state.doc.content.size);
    second.commands.insertContent(' world');

    expect(first.getText()).toBe('Hello world');
    expect(second.getJSON()).toEqual(first.getJSON());

    first.destroy();
    second.destroy();
    firstDoc.destroy();
    secondDoc.destroy();
  });

  it('merges disconnected concurrent marks when clients reconnect', () => {
    const firstDoc = new Y.Doc();
    const first = new Editor({ extensions: createCanvasTextExtensions({ fragment: firstDoc.getXmlFragment('shape:text-2') }) });
    first.commands.insertContent('Merge');

    const secondDoc = new Y.Doc();
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc));
    const second = new Editor({ extensions: createCanvasTextExtensions({ fragment: secondDoc.getXmlFragment('shape:text-2') }) });
    const firstUpdates: Uint8Array[] = [];
    const secondUpdates: Uint8Array[] = [];
    firstDoc.on('update', update => firstUpdates.push(update));
    secondDoc.on('update', update => secondUpdates.push(update));

    first.chain().setTextSelection({ from: 1, to: 3 }).toggleBold().run();
    second.chain().setTextSelection({ from: 3, to: 6 }).toggleItalic().run();
    firstUpdates.forEach(update => Y.applyUpdate(secondDoc, update));
    secondUpdates.forEach(update => Y.applyUpdate(firstDoc, update));

    expect(second.getJSON()).toEqual(first.getJSON());
    const content = first.getJSON().content?.[0]?.content ?? [];
    expect(content.some(node => node.marks?.some(mark => mark.type === 'bold'))).toBe(true);
    expect(content.some(node => node.marks?.some(mark => mark.type === 'italic'))).toBe(true);

    first.destroy();
    second.destroy();
    firstDoc.destroy();
    secondDoc.destroy();
  });

  it('publishes collaborator selections through awareness', async () => {
    const firstDoc = new Y.Doc();
    const secondDoc = new Y.Doc();
    firstDoc.on('update', (update, origin) => {
      if (origin !== secondDoc) Y.applyUpdate(secondDoc, update, firstDoc);
    });
    secondDoc.on('update', (update, origin) => {
      if (origin !== firstDoc) Y.applyUpdate(firstDoc, update, secondDoc);
    });
    const firstAwareness = new Awareness(firstDoc);
    const secondAwareness = new Awareness(secondDoc);
    firstAwareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin !== secondAwareness) {
        applyAwarenessUpdate(secondAwareness, encodeAwarenessUpdate(firstAwareness, [...added, ...updated, ...removed]), firstAwareness);
      }
    });
    secondAwareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin !== firstAwareness) {
        applyAwarenessUpdate(firstAwareness, encodeAwarenessUpdate(secondAwareness, [...added, ...updated, ...removed]), secondAwareness);
      }
    });

    const first = new Editor({ extensions: createCanvasTextExtensions({
      fragment: firstDoc.getXmlFragment('shape:text-caret'),
      awareness: firstAwareness,
      user: { id: 'a', name: 'Asha', color: '#2563eb' },
    }) });
    const second = new Editor({ extensions: createCanvasTextExtensions({
      fragment: secondDoc.getXmlFragment('shape:text-caret'),
      awareness: secondAwareness,
      user: { id: 'b', name: 'Ben', color: '#dc2626' },
    }) });
    first.commands.insertContent('Shared');
    second.commands.setTextSelection(3);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(firstAwareness.getStates().get(secondAwareness.clientID)?.user).toMatchObject({ name: 'Ben' });
    expect(first.storage.collaborationCaret.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientId: secondAwareness.clientID, name: 'Ben' }),
    ]));

    first.destroy();
    second.destroy();
    await new Promise(resolve => setTimeout(resolve, 10));
    firstAwareness.destroy();
    secondAwareness.destroy();
    firstDoc.destroy();
    secondDoc.destroy();
  });
});
