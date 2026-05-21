/**
 * Glideline — StateNode FSM (Phase 3, Story 3.1)
 *
 * Hierarchical finite state machine for tool interactions.
 * Each tool is a root StateNode whose children represent discrete sub-states
 * (Idle, Pointing, Dragging, etc.). Events route to the active leaf first;
 * unhandled events bubble up to the parent.
 */

import type { GlideEditor } from './editor';
import type { Vec2, ShapeId } from './types';

// ─────────────────────────────────────────────────────────────
// Event union
// ─────────────────────────────────────────────────────────────

export type GlideEvent =
  | { type: 'pointerDown'; point: Vec2; shiftKey: boolean; target: 'shape' | 'canvas'; shapeId?: ShapeId }
  | { type: 'pointerMove'; point: Vec2 }
  | { type: 'pointerUp';   point: Vec2 }
  | { type: 'keyDown';     key: string }
  | { type: 'doubleClick'; point: Vec2; shapeId?: ShapeId };

export type PointerDownEvent  = Extract<GlideEvent, { type: 'pointerDown' }>;
export type PointerMoveEvent  = Extract<GlideEvent, { type: 'pointerMove' }>;
export type PointerUpEvent    = Extract<GlideEvent, { type: 'pointerUp' }>;
export type KeyDownEvent      = Extract<GlideEvent, { type: 'keyDown' }>;
export type DoubleClickEvent  = Extract<GlideEvent, { type: 'doubleClick' }>;

// ─────────────────────────────────────────────────────────────
// StateNode
// ─────────────────────────────────────────────────────────────

export abstract class StateNode {
  /** Unique ID for this state. Must match the key used in transition(). */
  static readonly id: string;

  /**
   * Return child state classes. First child is the initial (default) state.
   * Example: static children = () => [Idle, Pointing, Dragging];
   */
  static children?: () => (typeof StateNode)[];

  /** Injected by the editor during _init(). */
  editor!: GlideEditor;

  /** Parent node (undefined for root tools). */
  parent?: StateNode;

  /** Active child state. Points to `this` for leaf nodes. */
  current!: StateNode;

  private _childMap = new Map<string, StateNode>();

  // ── Lifecycle ───────────────────────────────────────────────

  /** Called once by the editor (or parent) after construction. */
  _init(editor: GlideEditor, parent?: StateNode): void {
    this.editor = editor;
    this.parent = parent;

    const childClasses = (this.constructor as typeof StateNode).children?.() ?? [];
    for (const ChildClass of childClasses) {
      const child = new (ChildClass as any)() as StateNode;
      child._init(editor, this);
      this._childMap.set(ChildClass.id, child);
    }

    // Start in first child (or self if leaf)
    this._resetCurrent();
  }

  /** Reset active child back to the initial (first) child state. */
  _reset(): void {
    this._resetCurrent();
    // Recursively reset children too
    for (const child of this._childMap.values()) child._reset();
  }

  private _resetCurrent(): void {
    if (this._childMap.size > 0) {
      this.current = this._childMap.values().next().value!;
    } else {
      this.current = this;
    }
  }

  // ── Transition ──────────────────────────────────────────────

  /**
   * Exit the currently active child, enter the named child.
   * Throws if `id` is not a registered child of this node.
   */
  transition(id: string, info?: unknown): void {
    const next = this._childMap.get(id);
    if (!next) {
      throw new Error(
        `StateNode(${(this.constructor as typeof StateNode).id}): ` +
        `unknown child state "${id}"`,
      );
    }
    if (this.current !== this) this.current.onExit();
    this.current = next;
    next.onEnter(info);
  }

  // ── Hooks ───────────────────────────────────────────────────

  onEnter(_info?: unknown): void {}
  onExit(): void {}

  // ── Event handlers (override in child states) ────────────────

  onPointerDown?(_e: PointerDownEvent): void;
  onPointerMove?(_e: PointerMoveEvent): void;
  onPointerUp?(_e: PointerUpEvent): void;
  onKeyDown?(_e: KeyDownEvent): void;
  onDoubleClick?(_e: DoubleClickEvent): void;

  // ── Event routing ────────────────────────────────────────────

  /**
   * Route event to active child first. If the child doesn't handle it
   * (no handler method defined), bubble up to this node's own handlers.
   * Returns true if the event was handled at any level.
   */
  handleEvent(event: GlideEvent): boolean {
    if (this.current !== this) {
      const handled = this.current.handleEvent(event);
      if (handled) return true;
      // Bubble: try own handlers
    }
    return this._dispatchToSelf(event);
  }

  private _dispatchToSelf(event: GlideEvent): boolean {
    switch (event.type) {
      case 'pointerDown':
        if (this.onPointerDown) { this.onPointerDown(event); return true; }
        break;
      case 'pointerMove':
        if (this.onPointerMove) { this.onPointerMove(event); return true; }
        break;
      case 'pointerUp':
        if (this.onPointerUp) { this.onPointerUp(event); return true; }
        break;
      case 'keyDown':
        if (this.onKeyDown) { this.onKeyDown(event); return true; }
        break;
      case 'doubleClick':
        if (this.onDoubleClick) { this.onDoubleClick(event); return true; }
        break;
    }
    return false;
  }
}
