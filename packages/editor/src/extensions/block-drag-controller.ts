import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { blockDragDropKey, type BlockDragDropState } from './block-drag-drop';
import { canMoveBlock, documentBlocks, moveBlockTransaction, selectedBlock, siblingDestination, type BlockDestination, type DocumentBlock } from './block-movement';

type BlockRect = DocumentBlock & { dom: HTMLElement; rect: DOMRect };
/** Editor chrome owns input/geometry; ProseMirror owns all content and decorations. */
export class BlockDragController {
  private readonly root = document.createElement('div');
  private readonly handle = document.createElement('button');
  private readonly menu = document.createElement('div');
  private readonly indicator = document.createElement('div');
  private readonly live = document.createElement('div');
  private host: HTMLElement;
  private readonly abort = new AbortController();
  private readonly resize: ResizeObserver;
  private activeId: string | null = null;
  private armedId: string | null = null;
  private sourceId: string | null = null;
  private destination: BlockDestination | null = null;
  private point = { x: 0, y: 0 };
  private frame = 0;
  private feedbackTimer = 0;
  private ghost: HTMLElement | null = null;
  private destroyed = false;
  private lastMoveRevision = 0;
  private lastFrameTime = 0;

  constructor(private readonly view: EditorView, private readonly editor: Editor, private readonly types: string[]) {
    this.host = view.dom.parentElement ?? view.dom;
    this.host.classList.add('has-block-controls');
    this.root.className = 'beskar-editor block-controls';
    this.handle.className = 'block-drag-handle';
    this.handle.type = 'button';
    this.handle.draggable = true;
    this.handle.hidden = true;
    this.handle.setAttribute('aria-label', 'Block actions. Drag to reorder');
    this.handle.setAttribute('aria-haspopup', 'menu');
    this.handle.setAttribute('aria-expanded', 'false');
    this.handle.title = 'Drag to reorder · Click for block actions (Alt+F10)';
    this.handle.innerHTML = '<svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/><circle cx="5" cy="10" r="1.5"/><circle cx="11" cy="10" r="1.5"/><circle cx="5" cy="16" r="1.5"/><circle cx="11" cy="16" r="1.5"/></g></svg>';
    this.menu.className = 'block-action-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'Block actions');
    this.menu.hidden = true;
    for (const [label, direction, shortcut] of [['Move up', -1, '↑'], ['Move down', 1, '↓']] as const) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.dataset.direction = String(direction);
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      item.textContent = `${label}    ${mac ? '⌘⌥' : 'Ctrl+Alt+'}${shortcut}`;
      item.addEventListener('click', () => this.move(direction));
      this.menu.append(item);
    }
    this.indicator.className = 'block-drag-drop-indicator';
    this.indicator.hidden = true;
    this.live.className = 'block-controls-announcement';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('aria-atomic', 'true');
    this.root.append(this.handle, this.menu, this.indicator, this.live);
    document.body.append(this.root);
    this.syncTheme();
    const listen = (target: EventTarget, event: string, listener: EventListener, capture = false) => target.addEventListener(event, listener, { signal: this.abort.signal, capture });
    listen(document, 'pointermove', this.pointerMove as EventListener);
    listen(document, 'pointerdown', this.pointerDown as EventListener, true);
    listen(document, 'pointerup', () => { this.armedId = null; });
    // Native HTML dragging intentionally cancels the originating pointer stream.
    listen(document, 'pointercancel', () => { if (!this.sourceId) this.armedId = null; });
    listen(this.handle, 'dragstart', this.dragStart as EventListener);
    listen(this.handle, 'click', () => { if (!this.sourceId) this.openMenu(); });
    listen(document, 'dragover', this.dragOver as EventListener, true);
    listen(document, 'drop', this.drop as EventListener, true);
    listen(document, 'dragend', () => { if (this.sourceId) this.finish(true); }, true);
    listen(document, 'keydown', this.keyDown as EventListener, true);
    listen(window, 'blur', () => { if (this.sourceId) this.finish(true); });
    listen(document, 'scroll', () => this.schedule(), true);
    listen(window, 'resize', () => this.schedule());
    listen(this.view.dom, 'beskar:block-menu', () => {
      this.setActive(selectedBlock(this.view.state, this.types)?.id ?? null);
      this.openMenu();
    });
    // Keep editor selection and menu focus stable through the mouse down/up sequence.
    listen(this.menu, 'mousedown', event => event.preventDefault());
    listen(this.root, 'focusout', event => {
      const next = (event as FocusEvent).relatedTarget as Node | null;
      if (next && !this.root.contains(next)) this.closeMenu(false);
    });
    this.resize = new ResizeObserver(() => this.schedule());
    this.resize.observe(this.view.dom);
    this.resize.observe(this.host);
    this.schedule();
  }

  private bindHost() {
    const parent = this.view.dom.parentElement;
    if (!parent) return;
    if (parent === this.host) { parent.classList.add('has-block-controls'); return; }
    this.resize.unobserve(this.host);
    this.host.classList.remove('has-block-controls');
    this.host = parent;
    this.host.classList.add('has-block-controls');
    this.resize.observe(this.host);
    this.syncTheme();
  }

  private syncTheme() {
    const el = this.view.dom.closest('.beskar-editor') ?? this.view.dom;
    const style = getComputedStyle(el);
    for (const prop of Array.from(style)) if (prop.startsWith('--')) this.root.style.setProperty(prop, style.getPropertyValue(prop));
    this.root.style.color = style.color;
    this.root.style.fontFamily = style.fontFamily;
    this.root.classList.toggle('dark', !!el.closest('.dark, [data-theme="dark"]'));
  }
  private patch(meta: Partial<BlockDragDropState>) {
    if (this.destroyed) return;
    const state = blockDragDropKey.getState(this.view.state)!;
    if (Object.entries(meta).every(([key, value]) => state[key as keyof BlockDragDropState] === value)) return;
    this.view.dispatch(this.view.state.tr.setMeta(blockDragDropKey, meta).setMeta('addToHistory', false));
  }
  private blocks(): BlockRect[] {
    return documentBlocks(this.view.state.doc, this.types).flatMap(block => {
      const dom = this.view.nodeDOM(block.pos);
      return dom instanceof HTMLElement ? [{ ...block, dom, rect: dom.getBoundingClientRect() }] : [];
    });
  }
  private setActive(id: string | null) {
    if (id && id !== this.activeId) this.syncTheme();
    this.activeId = id;
    this.patch({ activeId: id });
    this.position();
  }
  private anchor(block: BlockRect): number {
    const { dom, node, rect } = block;
    if (node.isAtom || ['table', 'columns', 'imageBlock', 'embedBlock', 'tableOfContents', 'childPagesList'].includes(node.type.name)) return rect.top + Math.min(18, rect.height / 2);
    const el = dom.querySelector<HTMLElement>('summary, [data-type="detailsSummary"], pre, li p, p, .note-block-content') ?? dom;
    // The first rendered text rect includes padding, borders and nested node-view layout.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode())) {
      if (!text.textContent?.trim() || !(text.parentElement?.getClientRects().length)) continue;
      const range = document.createRange();
      range.setStart(text, 0); range.setEnd(text, Math.min(text.textContent.length, 1));
      const r = range.getBoundingClientRect();
      if (r.height) return r.top + r.height / 2;
    }
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    return el.getBoundingClientRect().top + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth) + line / 2;
  }
  private position() {
    const block = this.blocks().find(b => b.id === this.activeId);
    this.handle.hidden = !this.editor.isEditable || !block;
    if (!block || this.handle.hidden) { this.closeMenu(false); return; }
    const bounds = this.visibleBounds();
    const anchor = this.anchor(block);
    if (anchor < bounds.top || anchor > bounds.bottom) { this.handle.hidden = true; this.closeMenu(false); return; }
    const height = this.handle.getBoundingClientRect().height;
    this.handle.style.left = `${Math.max(4, this.view.dom.getBoundingClientRect().left - this.handle.offsetWidth - 4)}px`;
    this.handle.style.top = `${this.anchor(block) - height / 2}px`;
    if (!this.menu.hidden) {
      this.updateMenu();
      this.menu.style.left = `${Math.max(4, Math.min(parseFloat(this.handle.style.left), window.innerWidth - this.menu.offsetWidth - 8))}px`;
      this.menu.style.top = `${Math.max(4, Math.min(this.anchor(block) + height / 2, window.innerHeight - this.menu.offsetHeight - 8))}px`;
    }
  }
  private pointerMove = (event: PointerEvent) => {
    if (!this.editor.isEditable || this.sourceId || this.armedId || !this.menu.hidden) return;
    const target = event.target as Node;
    if (this.root.contains(target)) return;
    if (!this.host.contains(target)) {
      if (!this.root.contains(document.activeElement)) this.setActive(null);
      return;
    }
    const blocks = this.blocks();
    // Resolve the row before considering its gutter, so adjacent blocks never retain an old ID.
    const block = blocks.find(b => event.clientY >= b.rect.top && event.clientY <= b.rect.bottom);
    this.setActive(block?.id ?? null);
  };
  private pointerDown = (event: PointerEvent) => {
    if (this.handle.contains(event.target as Node)) {
      this.armedId = this.activeId;
      // Keep the editor's cursor until the move is committed. Native draggable still starts.
      return;
    }
    if (!this.menu.contains(event.target as Node)) this.closeMenu(false);
    if (this.editor.isEditable && this.host.contains(event.target as Node)) {
      const block = this.blocks().find(b => event.clientY >= b.rect.top && event.clientY <= b.rect.bottom);
      this.setActive(block?.id ?? null);
    }
  };
  private openMenu() {
    if (!this.activeId || !this.editor.isEditable) return;
    this.syncTheme();
    this.menu.hidden = false;
    this.handle.setAttribute('aria-expanded', 'true');
    this.position();
    this.menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  private updateMenu() {
    for (const item of Array.from(this.menu.querySelectorAll<HTMLButtonElement>('button'))) {
      item.disabled = !this.activeId || !siblingDestination(this.view.state, this.activeId, Number(item.dataset.direction) as -1 | 1, this.types);
    }
  }
  private closeMenu(focus: boolean) {
    this.menu.hidden = true;
    this.handle.setAttribute('aria-expanded', 'false');
    if (focus && !this.handle.hidden) this.handle.focus();
  }
  private move(direction: -1 | 1) {
    if (!this.activeId) return;
    const destination = siblingDestination(this.view.state, this.activeId, direction, this.types);
    const tr = destination && moveBlockTransaction(this.view.state, this.activeId, destination, this.types);
    if (!tr) return;
    this.view.dispatch(tr);
    this.closeMenu(false);
    this.view.focus();
    this.announce(direction < 0 ? 'Block moved up.' : 'Block moved down.');
  }
  private announce(message: string) {
    this.live.textContent = '';
    queueMicrotask(() => { if (!this.destroyed) this.live.textContent = message; });
  }
  private keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && (this.sourceId || !this.menu.hidden)) {
      event.preventDefault(); event.stopPropagation();
      if (this.sourceId) { this.finish(true); this.view.focus(); }
      else this.closeMenu(true);
      return;
    }
    if (!this.menu.hidden && this.root.contains(event.target as Node)) {
      const items = Array.from(this.menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === 'Tab') this.closeMenu(false);
    }
  };
  private dragStart = (event: DragEvent) => {
    const source = this.blocks().find(b => b.id === (this.armedId ?? this.activeId));
    if (!source || !this.editor.isEditable || !event.dataTransfer) { event.preventDefault(); return; }
    this.sourceId = source.id;
    this.point = { x: event.clientX, y: event.clientY };
    this.closeMenu(false);
    this.patch({ isDragging: true, draggingId: source.id, draggedNodeType: source.node.type.name });
    this.handle.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-beskar-block', source.id);
    event.dataTransfer.setData('text/plain', source.node.textContent || source.node.type.name);
    this.syncTheme();
    const ghost = document.createElement('div');
    ghost.className = 'beskar-editor block-drag-preview';
    ghost.style.cssText = this.root.style.cssText;
    ghost.style.width = `${Math.min(source.rect.width, 600)}px`;
    const pm = document.createElement('div'); pm.className = 'ProseMirror';
    const clone = source.dom.cloneNode(true) as HTMLElement;
    clone.classList.remove('block-is-active', 'block-is-dragging', 'block-was-moved', 'ProseMirror-selectednode');
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    clone.querySelectorAll('.grip-row, .grip-column, button, .note-block-toolbar-floating, .image-block-toolbar-floating').forEach(el => el.remove());
    pm.append(clone); ghost.append(pm); document.body.append(ghost); this.ghost = ghost;
    event.dataTransfer.setDragImage(ghost, 16, 16);
    this.announce('Moving block. Drop at the highlighted line. Escape to cancel.');
    this.schedule();
  };
  private visibleBounds() {
    const host = this.host.getBoundingClientRect();
    const bounds = { left: Math.max(0, host.left), right: Math.min(window.innerWidth, host.right), top: Math.max(0, host.top), bottom: Math.min(window.innerHeight, host.bottom) };
    for (let el = this.host.parentElement; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        bounds.top = Math.max(bounds.top, rect.top + el.clientTop);
        bounds.bottom = Math.min(bounds.bottom, rect.top + el.clientTop + el.clientHeight);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        bounds.left = Math.max(bounds.left, rect.left + el.clientLeft);
        bounds.right = Math.min(bounds.right, rect.left + el.clientLeft + el.clientWidth);
      }
    }
    return bounds;
  }
  private inside(x: number, y: number) {
    const r = this.visibleBounds();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
  /** The same root block boundaries drive both the indicator and the committed move. */
  private resolveTarget(x: number, y: number): BlockDestination | null {
    if (!this.sourceId || !this.inside(x, y)) return null;
    const blocks = this.blocks();
    if (blocks.some(b => b.id === this.sourceId && y >= b.rect.top && y <= b.rect.bottom)) return null;
    const boundaries = blocks.filter(b => b.id !== this.sourceId).flatMap(b => [
      { id: b.id, side: 'before' as const, y: b.rect.top },
      { id: b.id, side: 'after' as const, y: b.rect.bottom },
    ]);
    boundaries.sort((a, b) => Math.abs(y - a.y) - Math.abs(y - b.y));
    const closest = boundaries[0];
    if (!closest) return null;
    const dest = { id: closest.id, side: closest.side };
    return canMoveBlock(this.view.state, this.sourceId, dest, this.types) ? dest : null;
  }
  private showTarget() {
    this.destination = this.resolveTarget(this.point.x, this.point.y);
    const target = this.blocks().find(b => b.id === this.destination?.id);
    this.indicator.hidden = !target || !this.destination;
    if (target && this.destination) {
      this.indicator.style.left = `${target.rect.left}px`;
      this.indicator.style.width = `${target.rect.width}px`;
      this.indicator.style.top = `${(this.destination.side === 'before' ? target.rect.top : target.rect.bottom) - 1}px`;
    }
  }
  private dragOver = (event: DragEvent) => {
    if (!this.sourceId) return;
    this.point = { x: event.clientX, y: event.clientY };
    this.showTarget();
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.destination ? 'move' : 'none';
  };
  private drop = (event: DragEvent) => {
    if (!this.sourceId) return;
    event.preventDefault(); event.stopPropagation();
    // Native browsers may coalesce the final dragover. Resolve its final coordinates through
    // exactly the same boundary resolver as the preview, against the live document.
    const destination = this.resolveTarget(event.clientX, event.clientY);
    const tr = this.inside(event.clientX, event.clientY) && destination && moveBlockTransaction(this.view.state, this.sourceId, destination, this.types, true);
    if (tr) this.view.dispatch(tr);
    this.finish(!tr);
    if (tr) this.view.focus();
  };
  private finish(cancelled: boolean) {
    const wasDragging = !!this.sourceId;
    this.sourceId = null; this.armedId = null; this.destination = null;
    this.indicator.hidden = true;
    this.handle.classList.remove('is-dragging');
    this.ghost?.remove(); this.ghost = null;
    this.patch({ isDragging: false, draggingId: null, draggedNodeType: null });
    if (wasDragging) this.announce(cancelled ? 'Move cancelled. Block order unchanged.' : 'Block moved.');
    if (this.editor.isEditable) this.schedule();
  }
  private autoScroll(dt: number) {
    let el: HTMLElement | null = this.host;
    while (el && el !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) break;
      el = el.parentElement;
    }
    const scroll = el && el !== document.body ? el : document.scrollingElement as HTMLElement;
    if (!scroll || !this.inside(this.point.x, this.point.y)) return;
    const rect = scroll === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : scroll.getBoundingClientRect();
    const top = Math.max(0, rect.top), bottom = Math.min(window.innerHeight, rect.bottom);
    const edge = 56;
    const speed = this.point.y < top + edge ? -Math.min(1, (top + edge - this.point.y) / edge) : this.point.y > bottom - edge ? Math.min(1, (this.point.y - bottom + edge) / edge) : 0;
    if (speed) scroll.scrollTop += speed * Math.min(dt, 32) * 0.65;
  }
  private schedule() {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(time => {
      this.frame = 0;
      this.bindHost();
      if (!this.view.dom.isConnected) { this.schedule(); return; }
      if (!this.editor.isEditable) { this.finish(false); this.setActive(null); this.closeMenu(false); return; }
      if (this.sourceId && !documentBlocks(this.view.state.doc, this.types).some(b => b.id === this.sourceId)) this.finish(true);
      this.position();
      if (this.sourceId) {
        this.autoScroll(time - (this.lastFrameTime || time));
        this.showTarget();
        this.schedule();
      }
      this.lastFrameTime = time;
    });
  }
  update() {
    const feedback = blockDragDropKey.getState(this.view.state);
    const moved = feedback?.movedId;
    if (moved && feedback.moveRevision !== this.lastMoveRevision) {
      this.lastMoveRevision = feedback.moveRevision;
      this.activeId = moved;
      this.announce('Block moved.');
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = window.setTimeout(() => { this.patch({ movedId: null }); }, 850);
    }
    this.schedule();
  }
  destroy() {
    this.destroyed = true;
    this.abort.abort(); this.resize.disconnect();
    cancelAnimationFrame(this.frame); clearTimeout(this.feedbackTimer);
    this.ghost?.remove(); this.root.remove();
    this.host.classList.remove('has-block-controls');
  }
}
