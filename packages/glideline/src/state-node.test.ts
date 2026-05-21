/**
 * Unit tests: StateNode FSM (Story 3.1)
 * Covers: T3.1-01 through T3.1-06
 */

import { describe, it, expect, vi } from 'vitest';
import { StateNode } from './state-node';
import type { PointerDownEvent } from './state-node';
import { createEditor } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import type { GlidePlugin } from './editor';

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any] };
const makeEditor = () => createEditor({ plugins: [BoxPlugin] });

// ─────────────────────────────────────────────────────────────
// Minimal test tool fixtures
// ─────────────────────────────────────────────────────────────

class IdleState extends StateNode {
  static override id = 'idle';
  onEnterSpy = vi.fn();
  onExitSpy  = vi.fn();
  override onEnter() { this.onEnterSpy(); }
  override onExit()  { this.onExitSpy(); }
}

class PointingState extends StateNode {
  static override id = 'pointing';
  onEnterSpy = vi.fn();
  override onEnter() { this.onEnterSpy(); }
}

class TestTool extends StateNode {
  static override id = 'test-tool';
  static override children = () => [IdleState, PointingState];
}

// Tool with a spy on parent's onPointerDown (to test no double-fire)
class IdleWithHandler extends StateNode {
  static override id = 'idle';
  handleCount = 0;
  override onPointerDown() { this.handleCount++; }
}
class ParentWithHandlerAndChild extends StateNode {
  static override id = 'parent-tool';
  static override children = () => [IdleWithHandler];
  parentHandleCount = 0;
  override onPointerDown() { this.parentHandleCount++; }
}

// ─────────────────────────────────────────────────────────────
// T3.1-01: transition calls onExit then onEnter in order
// ─────────────────────────────────────────────────────────────

describe('T3.1-01: transition calls onExit then onEnter', () => {
  it('exits Idle before entering Pointing', () => {
    const editor = makeEditor();
    const tool = new TestTool() as any;
    tool._init(editor);

    const order: string[] = [];
    const idle    = tool.current as IdleState;
    const pointing = (tool as any)._childMap.get('pointing') as PointingState;

    idle.onExitSpy.mockImplementation(() => order.push('exit-idle'));
    pointing.onEnterSpy.mockImplementation(() => order.push('enter-pointing'));

    tool.transition('pointing');
    expect(order).toEqual(['exit-idle', 'enter-pointing']);
  });
});

// ─────────────────────────────────────────────────────────────
// T3.1-02: unknown child throws with ID in message
// ─────────────────────────────────────────────────────────────

describe('T3.1-02: unknown child throws', () => {
  it('throws containing the unknown id', () => {
    const editor = makeEditor();
    const tool = new TestTool() as any;
    tool._init(editor);
    expect(() => tool.transition('drawing')).toThrow('drawing');
  });
});

// ─────────────────────────────────────────────────────────────
// T3.1-03: editor injected into all states
// ─────────────────────────────────────────────────────────────

describe('T3.1-03: editor injected', () => {
  it('getSelectedShapeIds() callable from inside onEnter', () => {
    let called = false;
    class IdleCheck extends StateNode {
      static override id = 'idle';
      override onEnter() {
        this.editor.getSelectedShapeIds(); // must not throw
        called = true;
      }
    }
    class ToolCheck extends StateNode {
      static override id = 'check-tool';
      static override children = () => [IdleCheck];
    }

    const editor = makeEditor();
    editor._registerTool(ToolCheck);
    editor.setCurrentTool('check-tool');
    expect(called).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// T3.1-04: setCurrentTool resets to initial child
// ─────────────────────────────────────────────────────────────

describe('T3.1-04: starts in initial state after setCurrentTool', () => {
  it('current is idle after setCurrentTool("box")', () => {
    const editor = makeEditor();
    editor.setCurrentTool('box');
    const leaf = editor.getCurrentTool().current;
    expect((leaf.constructor as typeof StateNode).id).toBe('idle');
  });
});

// ─────────────────────────────────────────────────────────────
// T3.1-05: event handled by child does not propagate to parent
// ─────────────────────────────────────────────────────────────

describe('T3.1-05: event not double-fired', () => {
  it('parent onPointerDown not called when child handles it', () => {
    const editor = makeEditor();
    const tool = new ParentWithHandlerAndChild() as any;
    tool._init(editor);

    const child = tool.current as IdleWithHandler;
    tool.handleEvent({ type: 'pointerDown', point: { x: 0, y: 0 }, shiftKey: false, target: 'canvas' });

    expect(child.handleCount).toBe(1);
    expect(tool.parentHandleCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// T3.1-06: current points to active leaf after transition
// ─────────────────────────────────────────────────────────────

describe('T3.1-06: active leaf via .current', () => {
  it('tool.current.id === "pointing" after transition', () => {
    const editor = makeEditor();
    const tool = new TestTool() as any;
    tool._init(editor);

    tool.transition('pointing');
    expect((tool.current.constructor as typeof StateNode).id).toBe('pointing');
  });
});
