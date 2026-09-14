# Guide: Embed a persistent whiteboard in a React app

**Use case:** the most common `glideboard` scenario — a whiteboard page in your product that loads a saved document, lets the user edit it, and saves changes back.

**Reference:** [glideboard: Overview & Board Lifecycle](../glideboard/overview-and-lifecycle.md).

## Minimal embed

```tsx
import { Glideboard } from '@durgakiran/glideboard';
import '@durgakiran/glideboard/styles.css';   // import once, globally, in your app

function WhiteboardPage() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <Glideboard sessionKey="board-1" />
    </div>
  );
}
```

This alone works: local-only editing with the default shape/tool set, no persistence. Everything below layers on top.

## Loading and saving a document

```tsx
import { useRef, useCallback } from 'react';
import { Glideboard, type GlideboardHandle, type GlideDocument } from '@durgakiran/glideboard';

function WhiteboardPage({ boardId, savedDocument, savedRevision }: {
  boardId: string;
  savedDocument: GlideDocument | null;
  savedRevision: string | null;
}) {
  const boardRef = useRef<GlideboardHandle>(null);

  const handleDocumentChange = useCallback(async (document: GlideDocument) => {
    await fetch(`/api/boards/${boardId}`, {
      method: 'PUT',
      body: JSON.stringify(document),
    });
  }, [boardId]);

  return (
    <Glideboard
      ref={boardRef}
      sessionKey={boardId}
      initialDocument={savedDocument}
      initialDocumentDisposition={
        savedDocument
          ? { kind: 'acknowledged-baseline', durableRevision: savedRevision! }
          : { kind: 'new-unsaved-seed' }
      }
      onDocumentChange={handleDocumentChange}
      documentChangeDebounceMs={800}
    />
  );
}
```

**Use `sessionKey={boardId}`, not a constant.** Since changing `sessionKey` remounts the whole session, keying it to the board's own id is what makes navigating from board A to board B (in an SPA, without a full page reload) actually load board B's document instead of continuing to show board A's editor with new props ignored.

`initialDocumentDisposition` isn't optional decoration — it tells `glideboard` what kind of trust to place in `initialDocument`:
- `{ kind: 'acknowledged-baseline', durableRevision }` — "this came from the server and is the source of truth"; use this for a normal load.
- `{ kind: 'new-unsaved-seed' }` — "there's nothing saved yet"; use this for a brand-new board.
- `{ kind: 'local-recovery', recoveryCheckpoint }` — "this is a locally-cached draft, possibly ahead of what the server has"; use this if you're restoring from local storage/IndexedDB after a crash, not from your normal save endpoint.

Picking the wrong disposition doesn't crash anything, but it affects how `glideboard` reconciles this seed against collaboration state if you later attach real-time collaboration (see [Add real-time collaboration](./add-realtime-collaboration-to-glideboard.md)) — get this right even before you need collaboration, so the seam is already correct when you do.

## Saving on unmount and explicit save

`onDocumentChange` covers the steady-state autosave case. For "save immediately, right now" (a save button, saving before navigation), or to make sure a debounced pending save isn't lost when the user navigates away:

```tsx
async function handleSaveClick() {
  const document = boardRef.current!.serialize();
  await fetch(`/api/boards/${boardId}`, { method: 'PUT', body: JSON.stringify(document) });
}
```

```tsx
<Glideboard ... pendingSaveOnUnmount="flush" />
```

The default is `'cancel'` — a debounced `onDocumentChange` that hasn't fired yet is dropped, not flushed, when the board unmounts. If losing up to `documentChangeDebounceMs` of edits on navigation is unacceptable for your app, set this explicitly to `'flush'`.

## Read-only mode

```tsx
<Glideboard sessionKey={boardId} initialDocument={savedDocument} readOnly />
```

Renders the current document with all editing tools disabled — useful for a "view this version" or a permissions-gated viewer. `readOnly` is reactive: toggling the prop on a live `Glideboard` flips edit access without remounting the session (unlike `customShapes`, which is startup-only).

## Multiple pages

```tsx
const pages = boardRef.current!.getPages();
boardRef.current!.setActivePage(pages[1].id);
boardRef.current!.createPage('New page');
```

A board's pages are part of its document — they persist through `serialize()`/`initialDocument` like everything else; there's nothing extra to wire up for multi-page support beyond calling these when you build page-tab UI (`glideboard` ships a `PageTabs` component internally, driving the default toolbar's page switcher, but it isn't itself exported for reuse outside `<Glideboard>` today).
