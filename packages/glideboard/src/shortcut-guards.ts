export type ShortcutEvent = {
  readonly target: EventTarget | null;
  readonly nativeEvent?: Event;
  composedPath?(): EventTarget[];
};

export function getShortcutEventPath(event: ShortcutEvent): EventTarget[] {
  const source = event.nativeEvent ?? event;
  if (typeof source.composedPath === 'function') {
    const path = source.composedPath();
    if (path.length > 0) return path;
  }
  return event.target ? [event.target] : [];
}

function isShortcutIgnoredElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-glideboard-ignore-shortcuts]')) return true;
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const contentEditable = target.getAttribute('contenteditable');
  return contentEditable !== null && contentEditable.toLowerCase() !== 'false';
}

function getFocusedElement(ownerDocument: Document): Element | null {
  let active = ownerDocument.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Native capture listeners and React handlers must enforce the same editing boundary. */
export function shouldIgnoreGlideboardShortcuts(event: ShortcutEvent): boolean {
  const path = getShortcutEventPath(event);
  if (path.some(isShortcutIgnoredElement)) return true;
  const target = event.target;
  const pathNode = path.find(candidate => candidate instanceof Node) as Node | undefined;
  const ownerDocument = (target instanceof Node ? target.ownerDocument : null)
    ?? pathNode?.ownerDocument
    ?? document;
  let active = getFocusedElement(ownerDocument);
  while (active) {
    if (isShortcutIgnoredElement(active)) return true;
    active = active.parentElement;
  }
  return false;
}
