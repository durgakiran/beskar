import { CanvasTextEditor } from '@durgakiran/canvas-text-editor/editor';
import {
  createCanvasRichTextDocument,
  projectCanvasRichTextToPlainText,
  type CanvasRichTextDocument,
} from '@durgakiran/canvas-text-editor/model';
import { CanvasTextView } from '@durgakiran/canvas-text-editor/view';
import { useEffect, useMemo, useState } from 'react';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

const INITIAL_VALUE = createCanvasRichTextDocument('Select text to try bold, italic, code, highlight, lists, and links.');

interface CollaborationBridge {
  firstDoc: Y.Doc;
  secondDoc: Y.Doc;
  firstAwareness: Awareness;
  secondAwareness: Awareness;
  destroy(): void;
}

function createCollaborationBridge(): CollaborationBridge {
  const firstDoc = new Y.Doc();
  const secondDoc = new Y.Doc();
  const firstAwareness = new Awareness(firstDoc);
  const secondAwareness = new Awareness(secondDoc);

  const syncFirstDocument = (update: Uint8Array, origin: unknown) => {
    if (origin !== secondDoc) Y.applyUpdate(secondDoc, update, firstDoc);
  };
  const syncSecondDocument = (update: Uint8Array, origin: unknown) => {
    if (origin !== firstDoc) Y.applyUpdate(firstDoc, update, secondDoc);
  };
  firstDoc.on('update', syncFirstDocument);
  secondDoc.on('update', syncSecondDocument);
  Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc), firstDoc);

  const syncFirstAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === secondAwareness) return;
    const clients = [...added, ...updated, ...removed];
    applyAwarenessUpdate(secondAwareness, encodeAwarenessUpdate(firstAwareness, clients), firstAwareness);
  };
  const syncSecondAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === firstAwareness) return;
    const clients = [...added, ...updated, ...removed];
    applyAwarenessUpdate(firstAwareness, encodeAwarenessUpdate(secondAwareness, clients), secondAwareness);
  };
  firstAwareness.on('update', syncFirstAwareness);
  secondAwareness.on('update', syncSecondAwareness);

  return {
    firstDoc,
    secondDoc,
    firstAwareness,
    secondAwareness,
    destroy() {
      firstAwareness.off('update', syncFirstAwareness);
      secondAwareness.off('update', syncSecondAwareness);
      firstDoc.off('update', syncFirstDocument);
      secondDoc.off('update', syncSecondDocument);
      firstAwareness.destroy();
      secondAwareness.destroy();
      firstDoc.destroy();
      secondDoc.destroy();
    },
  };
}

function CollaborationPlayground({ session }: { session: number }) {
  const bridge = useMemo(createCollaborationBridge, [session]);
  const [firstText, setFirstText] = useState('');
  const [secondText, setSecondText] = useState('');

  useEffect(() => () => bridge.destroy(), [bridge]);

  const firstCollaboration = useMemo(() => ({
    fragment: bridge.firstDoc.getXmlFragment('shape:shared-text'),
    awareness: bridge.firstAwareness,
    user: { id: 'client-a', name: 'Mira', color: '#12b76a' },
  }), [bridge]);
  const secondCollaboration = useMemo(() => ({
    fragment: bridge.secondDoc.getXmlFragment('shape:shared-text'),
    awareness: bridge.secondAwareness,
    user: { id: 'client-b', name: 'Noah', color: '#f79009' },
  }), [bridge]);

  return (
    <div className="collaboration-grid">
      <section className="client-pane" aria-labelledby="client-a-title">
        <div className="client-heading">
          <span className="presence-dot presence-dot--green" />
          <h3 id="client-a-title">Client A</h3>
          <span>React 18</span>
        </div>
        <div className="canvas-surface canvas-surface--green">
          <CanvasTextEditor
            collaboration={firstCollaboration}
            autoFocus={false}
            onChange={value => setFirstText(projectCanvasRichTextToPlainText(value))}
          />
        </div>
        <output className="client-output">{firstText || 'Start typing here'}</output>
      </section>

      <section className="client-pane" aria-labelledby="client-b-title">
        <div className="client-heading">
          <span className="presence-dot presence-dot--orange" />
          <h3 id="client-b-title">Client B</h3>
          <span>Separate Y.Doc</span>
        </div>
        <div className="canvas-surface canvas-surface--orange">
          <CanvasTextEditor
            collaboration={secondCollaboration}
            autoFocus={false}
            onChange={value => setSecondText(projectCanvasRichTextToPlainText(value))}
          />
        </div>
        <output className="client-output">{secondText || 'Changes appear here'}</output>
      </section>
    </div>
  );
}

export default function App() {
  const [value, setValue] = useState<CanvasRichTextDocument>(INITIAL_VALUE);
  const [session, setSession] = useState(0);
  const plainText = projectCanvasRichTextToPlainText(value);

  return (
    <main>
      <header className="app-header">
        <div>
          <span className="package-name">@durgakiran/canvas-text-editor</span>
          <h1>Canvas text package verification</h1>
        </div>
        <div className="runtime-badges" aria-label="Runtime versions">
          <span>React 18.3</span>
          <span>TipTap 3.6.6</span>
          <span>Yjs collaboration</span>
        </div>
      </header>

      <section className="workspace-band" aria-labelledby="local-editor-title">
        <div className="section-heading">
          <div>
            <span className="step-label">Local editing</span>
            <h2 id="local-editor-title">Edit once, render without an editor</h2>
          </div>
          <button type="button" className="secondary-button" onClick={() => setValue(INITIAL_VALUE)}>Reset content</button>
        </div>

        <div className="local-grid">
          <section className="work-pane">
            <h3>Active editor</h3>
            <div className="canvas-surface canvas-surface--active">
              <CanvasTextEditor
                value={value}
                onChange={setValue}
                autoFocus={false}
              />
            </div>
          </section>
          <section className="work-pane">
            <h3>Static CanvasTextView</h3>
            <div className="canvas-surface canvas-surface--static">
              <CanvasTextView value={value} />
            </div>
          </section>
          <section className="data-pane">
            <div className="data-heading">
              <h3>Portable JSON</h3>
              <span>{plainText.length} characters</span>
            </div>
            <pre>{JSON.stringify(value, null, 2)}</pre>
          </section>
        </div>
      </section>

      <section className="collaboration-band" aria-labelledby="collaboration-title">
        <div className="section-heading">
          <div>
            <span className="step-label">Character collaboration</span>
            <h2 id="collaboration-title">Two clients, one convergent fragment</h2>
          </div>
          <button type="button" className="secondary-button" onClick={() => setSession(current => current + 1)}>New session</button>
        </div>
        <CollaborationPlayground session={session} />
      </section>
    </main>
  );
}
