import { StateNode } from '../state-node.js';
import { signal } from '@preact/signals';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent, DoubleClickEvent } from '../state-node.js';
import type { ShapeId, Vec2, AnyRecord } from '../types.js';
import { makeBox } from '../types.js';
import type { ArrowShape, ArrowProps } from '../shapes/ArrowUtil.js';
import type { BindingPreview, BindingPreviewCandidate } from '../editor.js';
import type { ResizeHandle, ResizeInfo } from '../shapes/ShapeUtil.js';
import {
  applyMatrixToPoint,
  invertMatrix,
  multiplyMatrices,
  rotationMatrix,
  translationMatrix,
  type Matrix2d,
} from '../transform.js';

const DRAG_THRESHOLD = 4;

function shouldConstrainResizeAspect(shape: import('../types.js').GlideShape, shiftKey: boolean): boolean {
  if (shape.type === 'text') return true;
  const persisted = shape.type === 'raster-image' || shape.type === 'sanitized-svg'
    ? (shape.props as Record<string, unknown>)['aspectLocked'] !== false
    : shape.meta['aspectLocked'];
  if (typeof persisted !== 'boolean') return shiftKey;
  const locked = persisted;
  return locked ? !shiftKey : shiftKey;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function buildBindingPreview(editor: StateNode['editor'], targetShape: { id: ShapeId; type: string; x: number; y: number }, point: Vec2, terminal: 'start' | 'end') {
  const snapped = editor.transforms.getClosestConnectionAnchor(targetShape.id, point);

  return {
    terminal,
    targetId: targetShape.id,
    targetType: targetShape.type,
    normalizedAnchor: snapped.normalizedAnchor,
    point: snapped.point,
    candidateAnchors: editor.transforms.getConnectionAnchors(targetShape.id),
  };
}

function matchingPreview(
  preview: BindingPreview | null,
  terminal: 'start' | 'end',
  targetId: ShapeId | null
): BindingPreviewCandidate | null {
  if (!preview || !targetId) return null;
  if (preview.terminal === terminal && preview.targetId === targetId) return preview;
  return null;
}

// ─────────────────────────────────────────────────────────────
// Idle
// ─────────────────────────────────────────────────────────────

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(e: PointerDownEvent): void {
    if (e.target === 'handle' && e.handleId) {
      const sel = this.editor.getSelectedShapeIds();
      
      // Arrow handles
      if (['start', 'end', 'bend'].includes(e.handleId)) {
        if (sel.length === 1) {
          const id = sel[0]!;
          const shape = this.editor.getShape(id);
          if (shape && shape.type === 'arrow') {
            const bindings = this.editor.getBindingsFromShape(id) || [];
            const b = bindings.find((b: any) => b.props.terminal === e.handleId);
            this.parent!.transition('draggingHandle', {
              arrowId: id,
              handleType: e.handleId,
              origin: e.point,
              initialProps: { ...(shape.props as any) },
              initialBinding: b ? { ...b } : null,
            });
            return;
          }
        }
      }

      // Rotation handle
      if (e.handleId === 'rotate') {
        const boxes = sel.map(id => {
          const s = this.editor.getShape(id); if (!s) return null;
          return this.editor.getShapeWorldBounds(s);
        }).filter(Boolean) as any[];
        
        if (boxes.length > 0) {
          const minX = Math.min(...boxes.map((b: any) => b.minX));
          const minY = Math.min(...boxes.map((b: any) => b.minY));
          const maxX = Math.max(...boxes.map((b: any) => b.maxX));
          const maxY = Math.max(...boxes.map((b: any) => b.maxY));
          const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
          const startAngle = Math.atan2(e.point.y - center.y, e.point.x - center.x);
          
          const initRot = new Map(sel.map(id => {
            const s = this.editor.getShape(id);
            return [id, s?.rotation ?? 0] as [ShapeId, number];
          }));
          
          const initialCenters = new Map(sel.map(id => {
            const s = this.editor.getShape(id); if (!s) return null;
            const b = this.editor.getShapeUtil(s.type).getGeometry(s as any).getBounds();
            return [id, this.editor.localToPage(id, {
              x: b.minX + b.w / 2,
              y: b.minY + b.h / 2,
            })] as [ShapeId, Vec2];
          }).filter(Boolean) as [ShapeId, Vec2][]);
          
          const initialShapes = new Map(sel.map(id => {
            const s = this.editor.getShape(id); if (!s) return null;
            return [id, JSON.parse(JSON.stringify(s))] as [ShapeId, import('../types.js').GlideShape];
          }).filter(Boolean) as [ShapeId, import('../types.js').GlideShape][]);

          const initialWorldTransforms = new Map(sel.map(id => [
            id,
            this.editor.getWorldTransform(id),
          ] as [ShapeId, Matrix2d]));

          this.parent!.transition('draggingRotation', {
            shapeIds: sel, center, initialRotation: initRot, initialCenters,
            initialShapes, initialWorldTransforms, startAngle,
          });
          return;
        }
      }

      // Resize handle
      const resizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      if (resizeHandles.includes(e.handleId)) {
        if (sel.length === 1) {
          const shape = this.editor.getShape(sel[0]!);
          if (!shape || !this.editor.getShapeUtil(shape.type)
            .getResizeHandles(shape as any).includes(e.handleId as ResizeHandle)) return;
        }
        const boxes = sel.map(id => {
          const s = this.editor.getShape(id); if (!s) return null;
          return this.editor.getShapeWorldBounds(s);
        }).filter(Boolean) as any[];
        
        const minX = Math.min(...boxes.map((b: any) => b.minX));
        const minY = Math.min(...boxes.map((b: any) => b.minY));
        const maxX = Math.max(...boxes.map((b: any) => b.maxX));
        const maxY = Math.max(...boxes.map((b: any) => b.maxY));
        const initialBounds = makeBox(minX, minY, maxX - minX, maxY - minY);

          const initialGeom = new Map(sel.map(id => {
          const s = this.editor.getShape(id); if (!s) return null;
          const b = this.editor.getShapeUtil(s.type).getGeometry(s as any).getBounds();
          const clone = JSON.parse(JSON.stringify(s));
          return [id, { shape: clone, bounds: b, worldTransform: this.editor.getWorldTransform(id) }];
          }).filter(Boolean) as [ShapeId, {
          shape: import('../types.js').GlideShape;
          bounds: import('../types.js').Box2d;
          worldTransform: Matrix2d;
          }][]);
          let groupDescendants: DraggingResizeState['groupDescendants'];
          if (sel.length === 1 && this.editor.getShape(sel[0]!)?.type === 'group') {
            groupDescendants = new Map();
            const visit = (parentId: ShapeId) => {
              for (const child of this.editor.getChildren(parentId)) {
                groupDescendants!.set(child.id as ShapeId, {
                  shape: JSON.parse(JSON.stringify(child)),
                  worldTransform: this.editor.getWorldTransform(child.id as ShapeId),
                  depth: this.editor.getAncestors(child.id as ShapeId).length,
                });
                visit(child.id as ShapeId);
              }
            };
            visit(sel[0]!);
          }
        
        this.parent!.transition('draggingResize', {
          shapeIds: sel,
          handle: e.handleId as ResizeHandle,
          origin: e.point,
          initialGeom,
          initialBounds,
          groupDescendants,
        });
        return;
      }
    }

    // Standard shape/canvas pointing logic
    if (e.target === 'shape' && e.shapeId) {
      const selectableId = this.editor.getSelectableShapeId(e.shapeId);
      if (!selectableId) {
        this.parent!.transition('pointingCanvas', { ...e, target: 'canvas', shapeId: undefined });
        return;
      }
      e = { ...e, shapeId: selectableId };
      // Select on enter if not already selected
      if (!e.shiftKey && !this.editor.getSelectedShapeIds().includes(selectableId)) {
        this.editor.setSelectedShapeIds([selectableId]);
      }
      this.parent!.transition('pointingShape', e);
    } else {
      // Check if clicking inside a multi-selection bounding box
      const sel = this.editor.getSelectedShapeIds();
      if (sel.length > 1 && !e.shiftKey) {
        const boxes = sel.map(id => {
          const s = this.editor.getShape(id); if (!s) return null;
          return this.editor.getShapeWorldBounds(s);
        }).filter(Boolean) as any[];

        if (boxes.length > 0) {
          const minX = Math.min(...boxes.map((b: any) => b.minX));
          const minY = Math.min(...boxes.map((b: any) => b.minY));
          const maxX = Math.max(...boxes.map((b: any) => b.maxX));
          const maxY = Math.max(...boxes.map((b: any) => b.maxY));

          if (e.point.x >= minX && e.point.x <= maxX && e.point.y >= minY && e.point.y <= maxY) {
            // Act as if we clicked the first shape in the selection to start a drag
            this.parent!.transition('pointingShape', { ...e, target: 'shape', shapeId: sel[0] });
            return;
          }
        }
      }

      this.parent!.transition('pointingCanvas', e);
    }
  }

  override onDoubleClick(e: DoubleClickEvent): void {
    if (e.shapeId) {
      const selectableId = this.editor.getSelectableShapeId(e.shapeId) ?? e.shapeId;
      const shape = this.editor.getShape(selectableId);
      if (!shape) return;
      if (shape.type === 'group' && this.editor.enterGroup(shape.id as ShapeId)) return;
      const util = this.editor.getShapeUtil(shape.type);
      if (util.canEditLabel(shape as any)) {
        this.editor.setSelectedShapeIds([selectableId]);
        this.editor.startEditing(
          selectableId,
          util.getTextEditProps(shape as any, e.point) ?? undefined,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// PointingShape
// ─────────────────────────────────────────────────────────────

class PointingShape extends StateNode {
  static override readonly id = 'pointingShape';

  private _origin!: Vec2;
  private _shapeId!: ShapeId;
  private _shiftKey = false;

  override onEnter(info: PointerDownEvent): void {
    this._origin   = info.point;
    this._shapeId  = info.shapeId!;
    this._shiftKey = info.shiftKey;
  }

  override onPointerMove(e: PointerMoveEvent): void {
    if (dist(this._origin, e.point) > DRAG_THRESHOLD) {
      // Ensure shape is selected before dragging
      const sel = this.editor.getSelectedShapeIds();
      if (!sel.includes(this._shapeId)) {
        this.editor.setSelectedShapeIds([this._shapeId]);
      }

      // Alt+drag: duplicate first, then drag the copies
      let startPositions = this._capturePositions();
      if (startPositions.size === 0) return;
      if ((e as any).altKey) {
        const origIds = Array.from(startPositions.keys());
        const newIds = this.editor.duplicateShapes(origIds, { x: 0, y: 0 });
        // Remap startPositions to the new (duplicate) ids
        startPositions = new Map();
        for (let i = 0; i < origIds.length; i++) {
          const orig = origIds[i]!;
          const dup  = newIds[i]!;
          const shape = this.editor.getShape(orig);
          if (shape) startPositions.set(dup, { x: shape.x, y: shape.y });
        }
        this.editor.setSelectedShapeIds(Array.from(startPositions.keys()));
      }

      const initialShapes = new Map<ShapeId, import('../types.js').GlideShape>();
      for (const id of startPositions.keys()) {
        const shape = this.editor.getShape(id);
        if (!shape) continue;
        initialShapes.set(id, JSON.parse(JSON.stringify(shape)));
        const parent = this.editor.getShape(shape.parentId as ShapeId);
        if (parent?.type === 'group') initialShapes.set(parent.id as ShapeId, JSON.parse(JSON.stringify(parent)));
      }
      this.parent!.transition('dragging', {
        origin: this._origin,
        startPositions,
        initialShapes,
        constrainAxis: false,
      });
    }
  }

  override onPointerUp(_e: PointerUpEvent): void {
    // Commit selection
    const sel = this.editor.getSelectedShapeIds();
    if (this._shiftKey) {
      // Toggle
      if (sel.includes(this._shapeId)) {
        this.editor.setSelectedShapeIds(sel.filter(id => id !== this._shapeId));
      } else {
        this.editor.setSelectedShapeIds([...sel, this._shapeId]);
      }
    } else {
      this.editor.setSelectedShapeIds([this._shapeId]);
    }
    this.parent!.transition('idle');
  }

  private _capturePositions(): Map<ShapeId, Vec2> {
    const map = new Map<ShapeId, Vec2>();
    const selected = new Set(this.editor.getSelectedShapeIds());
    for (const id of selected) {
      const shape = this.editor.getShape(id);
      if (!shape || this.editor.isShapeEffectivelyLocked(id)) continue;
      let parent = this.editor.getShape(shape.parentId as ShapeId);
      let hasSelectedAncestor = false;
      while (parent) {
        if (selected.has(parent.id as ShapeId)) {
          hasSelectedAncestor = true;
          break;
        }
        parent = this.editor.getShape(parent.parentId as ShapeId);
      }
      if (!hasSelectedAncestor) map.set(id, { x: shape.x, y: shape.y });
    }
    return map;
  }
}

// ─────────────────────────────────────────────────────────────
// Dragging
// ─────────────────────────────────────────────────────────────

class Dragging extends StateNode {
  static override readonly id = 'dragging';

  private _origin!: Vec2;
  private _startPositions!: Map<ShapeId, Vec2>;
  private _initialShapes!: Map<ShapeId, import('../types.js').GlideShape>;
  private _initialBounds!: import('../types.js').Box2d;
  /** 'x' | 'y' | null — determined on first significant move when shift held */
  private _axis: 'x' | 'y' | null = null;

  override onEnter(info: { origin: Vec2; startPositions: Map<ShapeId, Vec2>; initialShapes: Map<ShapeId, import('../types.js').GlideShape>; constrainAxis?: boolean }): void {
    this._origin         = info.origin;
    this._startPositions = info.startPositions;
    this._initialShapes = info.initialShapes;
    this._axis           = null;
    const boxes = [...this._startPositions.keys()].map(id => this.editor.getShapeVisualWorldBounds(id));
    this._initialBounds = makeBox(
      Math.min(...boxes.map(box => box.minX)),
      Math.min(...boxes.map(box => box.minY)),
      Math.max(...boxes.map(box => box.maxX)) - Math.min(...boxes.map(box => box.minX)),
      Math.max(...boxes.map(box => box.maxY)) - Math.min(...boxes.map(box => box.minY)),
    );
    this.editor.beginHistoryPreview();
  }

  override onPointerMove(e: PointerMoveEvent): void {
    let dx = e.point.x - this._origin.x;
    let dy = e.point.y - this._origin.y;

    // Shift+drag: lock to dominant axis
    if ((e as any).shiftKey) {
      if (!this._axis) {
        // Determine axis on first large-enough move
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          this._axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        }
      }
      if (this._axis === 'x') dy = 0;
      if (this._axis === 'y') dx = 0;
    } else {
      this._axis = null;
    }

    const snapped = this.editor.snapping.snapTranslation(
      this.editor, [...this._startPositions.keys()], this._initialBounds, { x: dx, y: dy }, Boolean(e.altKey),
    );
    dx = snapped.delta.x;
    dy = snapped.delta.y;

    this.editor.batch('Drag', () => {
      for (const [id, start] of this._startPositions) {
        const shape = this.editor.getShape(id);
        if (!shape) continue;
        const delta = this.editor.pageDeltaToParent(shape.parentId, { x: dx, y: dy });
        this.editor.updateShape(id, { x: start.x + delta.x, y: start.y + delta.y });
      }
    }, { history: 'ignore' }); // live preview — not a history record
  }

  override onPointerUp(_e: PointerUpEvent): void {
    const dx = _e.point.x - this._origin.x;
    const dy = _e.point.y - this._origin.y;
    let fdx = dx, fdy = dy;
    if (this._axis === 'x') fdy = 0;
    if (this._axis === 'y') fdx = 0;
    const snapped = this.editor.snapping.snapTranslation(
      this.editor, [...this._startPositions.keys()], this._initialBounds, { x: fdx, y: fdy }, Boolean(_e.altKey),
    );
    fdx = snapped.delta.x;
    fdy = snapped.delta.y;
    const startPositions = this._startPositions;

    // Publish the final pointer location atomically as an ignored preview.
    // The store may correctly treat this as a no-op when the last move event
    // already reached the same point, so history is recorded from the initial
    // snapshots explicitly below.
    this.editor.batch('Move Shapes Preview', () => {
      for (const [id, start] of startPositions) {
        const shape = this.editor.getShape(id);
        if (!shape) continue;
        const delta = this.editor.pageDeltaToParent(shape.parentId, { x: fdx, y: fdy });
        this.editor.updateShape(id, { x: start.x + delta.x, y: start.y + delta.y });
      }
      this._captureFrameDrop(_e.point);
    }, { history: 'ignore' });

    const before = new Map<string, AnyRecord | null>();
    for (const [id, initial] of this._initialShapes) before.set(id, initial as unknown as AnyRecord);
    this.editor.recordHistoryPreview('Move Shapes', before);

    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      const startPositions = this._startPositions;
      this.editor.batch('Cancel Drag', () => {
        for (const [id, start] of startPositions) {
          this.editor.updateShape(id, { x: start.x, y: start.y });
        }
      }, { history: 'ignore' });
      this.editor.cancelHistoryPreview();
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.editor.snapping.clearGuides();
    this.editor.cancelHistoryPreview();
  }

  private _captureFrameDrop(point: Vec2): void {
    const moved = new Set(this._startPositions.keys());
    const frame = this.editor.getTopShapeAtPoint(point, shape => {
      if (shape.type !== 'frame' || moved.has(shape.id as ShapeId)) return false;
      if (this.editor.isShapeEffectivelyLocked(shape.id as ShapeId)) return false;
      return !this.editor.getAncestors(shape.id as ShapeId).some(parent => moved.has(parent.id as ShapeId));
    });
    if (frame) {
      const ids = [...moved].filter(id => this.editor.getShape(id)?.parentId !== frame.id);
      if (ids.length > 0) this.editor.reparentShapes(ids, frame.id as ShapeId);
      return;
    }
    const byTarget = new Map<string, ShapeId[]>();
    for (const id of moved) {
      const shape = this.editor.getShape(id);
      const parent = shape ? this.editor.getShape(shape.parentId as ShapeId) : undefined;
      if (!shape || parent?.type !== 'frame') continue;
      const target = parent.parentId;
      const ids = byTarget.get(target) ?? [];
      ids.push(id);
      byTarget.set(target, ids);
    }
    for (const [target, ids] of byTarget) this.editor.reparentShapes(ids, target as any);
  }
}

// ─────────────────────────────────────────────────────────────
// DraggingHandle
// ─────────────────────────────────────────────────────────────

class DraggingHandle extends StateNode {
  static override readonly id = 'draggingHandle';

  private _arrowId!: ShapeId;
  private _handleType!: 'start' | 'end' | 'bend';
  private _origin!: Vec2;
  private _initialProps!: ArrowProps;
  private _initialBinding: any = null;
  private _initialArrow!: ArrowShape;
  /** World-space arrow position at drag start (= shape.x, shape.y). */
  private _initialArrowX!: number;
  private _initialArrowY!: number;
  private _initialEndWorld!: Vec2;

  override onEnter(info: {
    arrowId: ShapeId;
    handleType: 'start' | 'end' | 'bend';
    origin: Vec2;
    initialProps: ArrowProps;
    initialBinding: any;
  }): void {
    this._arrowId        = info.arrowId;
    this._handleType     = info.handleType;
    this._origin         = info.origin;
    this._initialProps   = info.initialProps;
    this._initialBinding = info.initialBinding;
    this.editor.clearBindingPreview();
    // Capture initial world position of the arrow (= start terminal world pos)
    const arrow = this.editor.getShape(info.arrowId) as ArrowShape;
    this._initialArrow = JSON.parse(JSON.stringify(arrow)) as ArrowShape;
    this._initialArrowX = arrow?.x ?? 0;
    this._initialArrowY = arrow?.y ?? 0;
    this._initialEndWorld = this.editor.localToPage(info.arrowId, arrow.props.end.point);
    this.editor.beginHistoryPreview();
  }

  override onPointerMove(e: PointerMoveEvent): void {
    const arrow = this.editor.getShape(this._arrowId) as ArrowShape;
    if (!arrow) return;

    this.editor.batch('Drag Handle', () => {
      if (this._handleType === 'bend') {
        const { start, end, routeStyle } = this._initialProps;
        if (routeStyle !== 'curve') {
          const fromShape = start.boundShapeId ? this.editor.getShape(start.boundShapeId) : null;
          const toShape   = end.boundShapeId   ? this.editor.getShape(end.boundShapeId)   : null;
          if (fromShape && toShape) {
            const bindings = this.editor.getBindingsFromShape(this._arrowId) || [];
            const startBind = bindings.find((b: any) => b.props.terminal === 'start');
            const endBind   = bindings.find((b: any) => b.props.terminal === 'end');
            const fromEdge = startBind?.props.fromEdge ?? 'right';
            const toEdge = endBind?.props.fromEdge ?? 'left';

            const dx = e.point.x - this._origin.x;
            const dy = e.point.y - this._origin.y;

            let newBend = this._initialProps.bend;
            const topology = `${fromEdge}→${toEdge}` as const;

            if (topology === 'right→left' || topology === 'left→right') {
              newBend = this._initialProps.bend + dx;
            } else if (topology === 'top→bottom' || topology === 'bottom→top') {
              newBend = this._initialProps.bend + dy;
            } else if (fromEdge === toEdge) {
              switch (fromEdge) {
                case 'right':  newBend = this._initialProps.bend + dx; break;
                case 'left':   newBend = this._initialProps.bend - dx; break;
                case 'top':    newBend = this._initialProps.bend - dy; break;
                case 'bottom': newBend = this._initialProps.bend + dy; break;
              }
            } else {
              const isFromHoriz = fromEdge === 'right' || fromEdge === 'left';
              if (isFromHoriz) {
                const dirX = fromEdge === 'right' ? 1 : -1;
                newBend = this._initialProps.bend + dx * dirX;
              } else {
                const dirY = fromEdge === 'bottom' ? 1 : -1;
                newBend = this._initialProps.bend + dy * dirY;
              }
            }

            this.editor.updateShape(this._arrowId, {
              props: {
                ...arrow.props,
                bend: newBend,
              }
            });
          }
          return;
        }

        // Curve bend — local coords. start.point={0,0}, end.point=local offset.
        const sx = start.point.x;  // = 0
        const sy = start.point.y;  // = 0
        const ex = end.point.x;
        const ey = end.point.y;
        const mx = (sx + ex) / 2;
        const my = (sy + ey) / 2;
        const dx = ex - sx;
        const dy = ey - sy;
        const chord = Math.sqrt(dx * dx + dy * dy);

        if (chord < 1e-9) {
          this.editor.updateShape(this._arrowId, {
            props: { ...arrow.props, bend: 0 }
          });
          return;
        }

        const perpX = dy / chord;
        const perpY = -dx / chord;
        // The bend handle's world position relative to the arrow's origin
        const localCursor = this.editor.pageToLocal(this._arrowId, e.point);
        const localCursorX = localCursor.x;
        const localCursorY = localCursor.y;
        const px = localCursorX - mx;
        const py = localCursorY - my;
        const dist_perp = px * perpX + py * perpY;
        const bend = (2 * dist_perp) / chord;

        this.editor.updateShape(this._arrowId, {
          props: { ...arrow.props, bend }
        });
      } else {
        const term = this._handleType;
        const initialTerminal = this._initialProps[term];
        const dx = e.point.x - this._origin.x;
        const dy = e.point.y - this._origin.y;

        if (term === 'start') {
          // Moving the start terminal: shape.x/y moves, start.point stays {0,0}
          // end.point adjusts to keep end world position stable
          // Use _origin as initial world arrow.x
          const newArrowX = this._origin.x + dx;
          const newArrowY = this._origin.y + dy;

          // Simpler: new start world = cursor; new end local = old_world_end - cursor_world_start
          const nextStartWorldX = e.point.x;
          const nextStartWorldY = e.point.y;
          const oldWorldEndX = this._initialEndWorld.x;
          const oldWorldEndY = this._initialEndWorld.y;

          const otherTerminal = 'end';
          const otherBoundId = arrow.props[otherTerminal].boundShapeId;
          const targetShape = this.editor.getTopShapeAtPoint(
            e.point,
            shape => shape.type !== 'arrow' && shape.id !== otherBoundId && shape.id !== this._arrowId,
          );

          let finalStartX = nextStartWorldX;
          let finalStartY = nextStartWorldY;
          let boundShapeId: ShapeId | null = null;
          let normalizedAnchor = { x: 0.5, y: 0.5 };

          if (targetShape) {
            const preview = buildBindingPreview(this.editor, targetShape as any, e.point, 'start');
            const snapped = { normalizedAnchor: preview.normalizedAnchor, point: preview.point };
            finalStartX = snapped.point.x;
            finalStartY = snapped.point.y;
            boundShapeId = targetShape.id as ShapeId;
            normalizedAnchor = snapped.normalizedAnchor;
            this.editor.setBindingPreview(preview);
          } else {
            this.editor.clearBindingPreview();
          }

          const parentStart = this.editor.pageToParent(arrow.parentId, {
            x: finalStartX,
            y: finalStartY,
          });
          const parentEnd = this.editor.pageToParent(arrow.parentId, {
            x: oldWorldEndX,
            y: oldWorldEndY,
          });
          this.editor.updateShape(this._arrowId, {
            x: parentStart.x,
            y: parentStart.y,
            props: {
              ...arrow.props,
              start: {
                ...initialTerminal,
                point: { x: 0, y: 0 },
                boundShapeId,
              },
              end: {
                ...arrow.props.end,
                point: {
                  x: parentEnd.x - parentStart.x,
                  y: parentEnd.y - parentStart.y,
                },
              },
            }
          });
        } else {
          // Moving the end terminal: end.point changes (local offset)
          const localEnd = this.editor.pageToLocal(this._arrowId, e.point);

          const otherTerminal = 'start';
          const otherBoundId = arrow.props[otherTerminal].boundShapeId;
          const targetShape = this.editor.getTopShapeAtPoint(
            e.point,
            shape => shape.type !== 'arrow' && shape.id !== otherBoundId && shape.id !== this._arrowId,
          );

          let finalEndLocalX = localEnd.x;
          let finalEndLocalY = localEnd.y;
          let boundShapeId: ShapeId | null = null;
          let normalizedAnchor = { x: 0.5, y: 0.5 };

          if (targetShape) {
            const preview = buildBindingPreview(this.editor, targetShape as any, e.point, 'end');
            const snapped = { normalizedAnchor: preview.normalizedAnchor, point: preview.point };
            const snappedLocal = this.editor.pageToLocal(this._arrowId, snapped.point);
            finalEndLocalX = snappedLocal.x;
            finalEndLocalY = snappedLocal.y;
            boundShapeId = targetShape.id as ShapeId;
            normalizedAnchor = snapped.normalizedAnchor;
            this.editor.setBindingPreview(preview);
          } else {
            this.editor.clearBindingPreview();
          }

          this.editor.updateShape(this._arrowId, {
            props: {
              ...arrow.props,
              end: {
                ...arrow.props.end,
                point: { x: finalEndLocalX, y: finalEndLocalY },
                boundShapeId,
                normalizedAnchor,
              }
            }
          });
        }
      }
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    const activePreview = this.editor.bindingPreview.peek();
    this.editor.clearBindingPreview();
    const arrow = this.editor.getShape(this._arrowId) as ArrowShape;
    if (!arrow) {
      this.parent!.transition('idle');
      return;
    }

    const finalProps = { ...arrow.props };
    const finalEndWorld = this.editor.localToPage(this._arrowId, finalProps.end.point);
    let newBindingId: string | null = null;

    // Finalize bindings and the last pointer position as one publication. The
    // live arrow preview is already in the store, so history is synthesized
    // from the snapshots captured when the interaction began.
    this.editor.batch(
      'Finalize Arrow Handle Preview',
      () => {
        if (this._handleType !== 'bend' && this._initialBinding) {
          this.editor.deleteBinding(this._initialBinding.id);
        }

        if (this._handleType !== 'bend') {
          const term = this._handleType;
          const otherTerminal = term === 'start' ? 'end' : 'start';
          const otherBoundId = finalProps[otherTerminal].boundShapeId;
          const targetShape = this.editor.getTopShapeAtPoint(
            e.point,
            shape => shape.type !== 'arrow' && shape.id !== otherBoundId && shape.id !== this._arrowId,
          );

          if (targetShape) {
            const previewCandidate = matchingPreview(activePreview, term, targetShape.id as ShapeId);
            const snapped = previewCandidate
              ? { normalizedAnchor: previewCandidate.normalizedAnchor, point: previewCandidate.point }
              : this.editor.transforms.getClosestConnectionAnchor(targetShape.id as ShapeId, e.point);

            if (term === 'start') {
              // World end = arrow.x + end.point (local)
              const parentStart = this.editor.pageToParent(arrow.parentId, snapped.point);
              const parentEnd = this.editor.pageToParent(arrow.parentId, finalEndWorld);
              finalProps.start = {
                boundShapeId: targetShape.id as ShapeId,
                normalizedAnchor: snapped.normalizedAnchor,
                point: { x: 0, y: 0 },
              };
              finalProps.end = {
                ...finalProps.end,
                point: {
                  x: parentEnd.x - parentStart.x,
                  y: parentEnd.y - parentStart.y,
                },
              };
              // Update arrow world position to match new start anchor
              this.editor.updateShape(this._arrowId, { x: parentStart.x, y: parentStart.y });
            } else {
              // end terminal: store as local offset from arrow.x/y
              const snappedLocal = this.editor.pageToLocal(this._arrowId, snapped.point);
              finalProps.end = {
                boundShapeId: targetShape.id as ShapeId,
                normalizedAnchor: snapped.normalizedAnchor,
                point: {
                  x: snappedLocal.x,
                  y: snappedLocal.y,
                },
              };
            }

            const newBinding = {
              id: this.editor.createBindingId('arrow'),
              type: 'arrow',
              fromId: this._arrowId,
              toId: targetShape.id,
              meta: {},
              props: {
                terminal: term,
                normalizedAnchor: snapped.normalizedAnchor,
                fromEdge: this.editor.transforms.getAnchorPageEdge(targetShape.id as ShapeId, snapped.normalizedAnchor),
              },
            };
            newBindingId = newBinding.id;
            this.editor.createBinding(newBinding as any);
          }
        }

        this.editor.updateShape(this._arrowId, { props: finalProps });
      },
      { history: 'ignore' },
    );

    const before = new Map<string, AnyRecord | null>([
      [this._arrowId, this._initialArrow as unknown as AnyRecord],
    ]);
    if (this._initialBinding) {
      before.set(this._initialBinding.id, this._initialBinding);
    }
    if (newBindingId) {
      before.set(newBindingId, null);
    }
    this.editor.recordHistoryPreview(
      this._handleType === 'bend' ? 'Adjust Arrow Bend' : 'Move Arrow Handle',
      before,
    );

    this.parent!.transition('idle');
  }


  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.clearBindingPreview();
      this.editor.batch('Cancel Drag Handle', () => {
        this.editor.updateShape(this._arrowId, {
          x: this._initialArrowX,
          y: this._initialArrowY,
          props: {
            ...this._initialProps,
          }
        });
      }, { history: 'ignore' });

      this.editor.cancelHistoryPreview();
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.editor.clearBindingPreview();
    this.editor.cancelHistoryPreview();
  }
}

// ─────────────────────────────────────────────────────────────
// PointingCanvas
// ─────────────────────────────────────────────────────────────

class PointingCanvas extends StateNode {
  static override readonly id = 'pointingCanvas';

  private _origin!: Vec2;

  override onEnter(info: PointerDownEvent): void {
    this._origin = info.point;
  }

  override onPointerMove(e: PointerMoveEvent): void {
    if (dist(this._origin, e.point) > DRAG_THRESHOLD) {
      this.parent!.transition('marqueeSelecting', { origin: this._origin, current: e.point });
    }
  }

  override onPointerUp(_e: PointerUpEvent): void {
    this.editor.setSelectedShapeIds([]);
    this.parent!.transition('idle');
  }
}

// ─────────────────────────────────────────────────────────────
// MarqueeSelecting
// ─────────────────────────────────────────────────────────────

class MarqueeSelecting extends StateNode {
  static override readonly id = 'marqueeSelecting';

  private _origin!: Vec2;
  readonly marqueeBoxSignal = signal(makeBox(0, 0, 0, 0));

  override onEnter(info: { origin: Vec2; current: Vec2 }): void {
    this._origin   = info.origin;
    this._updateMarquee(info.current);
  }

  override onExit(): void {
    this.marqueeBoxSignal.value = makeBox(0, 0, 0, 0);
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this._updateMarquee(e.point);
  }

  override onPointerUp(e: PointerUpEvent): void {
    this._updateMarquee(e.point);
    const shapes = this.editor.getShapesInBox(this.marqueeBoxSignal.peek());
    this.editor.setSelectedShapeIds([...new Set(shapes
      .map(shape => this.editor.getSelectableShapeId(shape.id as ShapeId))
      .filter((id): id is ShapeId => id !== null))]);
    this.marqueeBoxSignal.value = makeBox(0, 0, 0, 0);
    this.parent!.transition('idle');
  }

  private _updateMarquee(pt: Vec2): void {
    const x  = Math.min(this._origin.x, pt.x);
    const y  = Math.min(this._origin.y, pt.y);
    const w  = Math.abs(pt.x - this._origin.x);
    const h  = Math.abs(pt.y - this._origin.y);
    this.marqueeBoxSignal.value = makeBox(x, y, w, h);
  }
}

// ────────────────────────────────────────────────────────────
// DraggingResize
// ────────────────────────────────────────────────────────────

/**
 * Handle positions (relative to shape AABB):
 *   nw  n  ne
 *   w       e
 *   sw  s  se
 *
 * Each handle knows which corners it anchors and which it moves.
 */
export interface DraggingResizeState {
  shapeIds:    ShapeId[];
  handle:      ResizeHandle;
  origin:      Vec2;
  /** Per-shape snapshot: clone of shape + initial bounds */
  initialGeom: Map<ShapeId, {
    shape: import('../types.js').GlideShape;
    bounds: import('../types.js').Box2d;
    worldTransform: Matrix2d;
  }>;
  initialBounds: import('../types.js').Box2d;
  groupDescendants?: Map<ShapeId, {
    shape: import('../types.js').GlideShape;
    worldTransform: Matrix2d;
    depth: number;
  }>;
}

class DraggingResize extends StateNode {
  static override readonly id = 'draggingResize';

  private _info!: DraggingResizeState;

  override onEnter(info: DraggingResizeState): void {
    this._info = info;
    this.editor.beginHistoryPreview();
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this.editor.batch('Resize Preview', () => {
      this._applyResize(e.point, this._shouldConstrainAspect((e as any).shiftKey ?? false), (e as any).altKey ?? false);
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    this.editor.batch('Resize Shapes Preview', () => {
      this._applyResize(e.point, this._shouldConstrainAspect((e as any).shiftKey ?? false), (e as any).altKey ?? false);
    }, { history: 'ignore' });

    const before = new Map<string, AnyRecord | null>();
    for (const [id, { shape }] of this._info.initialGeom) {
      before.set(id, shape as unknown as AnyRecord);
    }
    for (const [id, { shape }] of this._info.groupDescendants ?? []) {
      before.set(id, shape as unknown as AnyRecord);
    }
    this.editor.recordHistoryPreview('Resize Shapes', before);
    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      // Restore all shapes to their initial geometry
      this.editor.batch('Cancel Resize', () => {
        for (const [id, { shape }] of this._info.initialGeom) {
          this.editor.updateShape(id, {
            x: shape.x, y: shape.y,
            props: shape.props as any,
          });
        }
        for (const [id, { shape }] of this._info.groupDescendants ?? []) {
          this.editor.updateShape(id, { x: shape.x, y: shape.y, rotation: shape.rotation, props: shape.props as any });
        }
      }, { history: 'ignore' });
      this.editor.cancelHistoryPreview();
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.editor.snapping.clearGuides();
    this.editor.cancelHistoryPreview();
  }

  private _applyResize(cursor: Vec2, constrainAspect: boolean, disableSnap: boolean): void {
    const { handle, origin, initialGeom, initialBounds } = this._info;
    if (this._info.groupDescendants) {
      this._applyGroupResize(cursor, constrainAspect);
      return;
    }
    if (initialGeom.size === 1) {
      const entry = initialGeom.entries().next().value as [ShapeId, {
        shape: import('../types.js').GlideShape;
        bounds: import('../types.js').Box2d;
        worldTransform: Matrix2d;
      }] | undefined;
      if (entry) {
        this._applySingleOrientedResize(
          entry[0],
          entry[1],
          cursor,
          shouldConstrainResizeAspect(entry[1].shape, constrainAspect),
          disableSnap,
        );
        return;
      }
    }
    const dx = cursor.x - origin.x;
    const dy = cursor.y - origin.y;

    // First, compute the new bounds of the selection box
    let { minX: bx, minY: by, w: bw, h: bh } = initialBounds;
    switch (handle) {
      case 'se': bw += dx; bh += dy; break;
      case 'sw': bx += dx; bw -= dx; bh += dy; break;
      case 'ne': bw += dx; by += dy; bh -= dy; break;
      case 'nw': bx += dx; bw -= dx; by += dy; bh -= dy; break;
      case 'e':  bw += dx; break;
      case 'w':  bx += dx; bw -= dx; break;
      case 's':  bh += dy; break;
      case 'n':  by += dy; bh -= dy; break;
    }

    // Enforce minimum size for the overall bounds
    if (bw < 4) { if (handle.includes('w')) bx = initialBounds.minX + initialBounds.w - 4; bw = 4; }
    if (bh < 4) { if (handle.includes('n')) by = initialBounds.minY + initialBounds.h - 4; bh = 4; }

    // Shift: constrain to original aspect ratio
    if (constrainAspect && initialBounds.w > 0 && initialBounds.h > 0) {
      const aspect = initialBounds.w / initialBounds.h;
      if (Math.abs(dx) >= Math.abs(dy)) {
        bh = bw / aspect;
        if (handle.includes('n')) by = initialBounds.minY + initialBounds.h - bh;
      } else {
        bw = bh * aspect;
        if (handle.includes('w')) bx = initialBounds.minX + initialBounds.w - bw;
      }
    }

    // Now map every shape using delegated resizing
    const newBounds = makeBox(bx, by, bw, bh);
    const scaleX = bw / (initialBounds.w || 1);
    const scaleY = bh / (initialBounds.h || 1);

    for (const [id, { shape }] of initialGeom) {
      // If initial bounds has no size, skip to avoid NaN
      if (initialBounds.w === 0 || initialBounds.h === 0) continue;

      const util = this.editor.getShapeUtil(shape.type);
      const result = util.onResize(shape as any, { handle, scaleX, scaleY, initialShape: shape as any, initialBounds, newBounds });
      this.editor.updateShape(id, result);
    }
  }

  private _applyGroupResize(cursor: Vec2, _constrainAspect: boolean): void {
    const { handle, origin, groupDescendants, initialGeom, shapeIds } = this._info;
    const groupId = shapeIds[0];
    const groupInitial = groupId ? initialGeom.get(groupId) : undefined;
    if (!groupDescendants || !groupInitial) return;
    const initialBounds = groupInitial.bounds;
    if (initialBounds.w === 0 || initialBounds.h === 0) return;

    const worldToGroup = invertMatrix(groupInitial.worldTransform);
    const localCursor = applyMatrixToPoint(worldToGroup, cursor);
    const localOrigin = applyMatrixToPoint(worldToGroup, origin);
    const dx = localCursor.x - localOrigin.x;
    const dy = localCursor.y - localOrigin.y;
    const requestedX = handle.includes('e') ? (initialBounds.w + dx) / initialBounds.w
      : handle.includes('w') ? (initialBounds.w - dx) / initialBounds.w : null;
    const requestedY = handle.includes('s') ? (initialBounds.h + dy) / initialBounds.h
      : handle.includes('n') ? (initialBounds.h - dy) / initialBounds.h : null;
    const requested = requestedX !== null && requestedY !== null
      ? (Math.abs(requestedX - 1) >= Math.abs(requestedY - 1) ? requestedX : requestedY)
      : requestedX ?? requestedY ?? 1;
    const scale = Math.max(Math.max(4 / initialBounds.w, 4 / initialBounds.h), requested);
    const w = initialBounds.w * scale;
    const h = initialBounds.h * scale;
    const minX = handle.includes('w') ? initialBounds.maxX - w
      : handle.includes('e') ? initialBounds.minX
      : initialBounds.minX + (initialBounds.w - w) / 2;
    const minY = handle.includes('n') ? initialBounds.maxY - h
      : handle.includes('s') ? initialBounds.minY
      : initialBounds.minY + (initialBounds.h - h) / 2;
    const scaleLocal: Matrix2d = {
      a: scale, b: 0, c: 0, d: scale,
      e: minX - initialBounds.minX * scale,
      f: minY - initialBounds.minY * scale,
    };
    const scaleWorld = multiplyMatrices(
      groupInitial.worldTransform,
      multiplyMatrices(scaleLocal, worldToGroup),
    );
    const entries = [...groupDescendants.entries()].sort((left, right) => left[1].depth - right[1].depth);
    for (const [id, initial] of entries) {
      const shape = initial.shape;
      if (shape.type === 'arrow') {
        const arrow = shape as ArrowShape;
        const startWorld = applyMatrixToPoint(scaleWorld, applyMatrixToPoint(initial.worldTransform, arrow.props.start.point));
        const endWorld = applyMatrixToPoint(scaleWorld, applyMatrixToPoint(initial.worldTransform, arrow.props.end.point));
        const start = this.editor.pageToParent(shape.parentId, startWorld);
        const end = this.editor.pageToParent(shape.parentId, endWorld);
        this.editor.updateShape<ArrowShape>(id, {
          x: start.x, y: start.y, props: {
            ...arrow.props,
            start: { ...arrow.props.start, point: { x: 0, y: 0 } },
            end: { ...arrow.props.end, point: { x: end.x - start.x, y: end.y - start.y } },
          },
        });
        continue;
      }
      const util = this.editor.getShapeUtil(shape.type);
      const bounds = util.getGeometry(shape as any).getBounds();
      const resized = shape.type === 'group' ? {} : util.onResize(shape as any, {
        handle,
        scaleX: scale,
        scaleY: scale,
        initialShape: shape as any,
        initialBounds: bounds,
        newBounds: makeBox(bounds.minX, bounds.minY,
          Math.max(1, bounds.w * scale), Math.max(1, bounds.h * scale)),
      }) as any;
      const nextShape = { ...shape, ...resized, x: shape.x, y: shape.y,
        props: { ...shape.props, ...(resized.props ?? {}) } } as import('../types.js').GlideShape;
      const desiredWorld = multiplyMatrices(scaleWorld, initial.worldTransform);
      const placement = this.editor.transforms.getLocalPlacementForWorldTransform(nextShape, desiredWorld, shape.parentId);
      this.editor.updateShape(id, { ...resized, ...placement });
    }
  }

  private _applySingleOrientedResize(
    id: ShapeId,
    initial: { shape: import('../types.js').GlideShape; bounds: import('../types.js').Box2d; worldTransform: Matrix2d },
    cursor: Vec2,
    constrainAspect: boolean,
    disableSnap: boolean,
  ): void {
    const { handle } = this._info;
    const { shape, bounds, worldTransform } = initial;
    const localCursor = applyMatrixToPoint(invertMatrix(worldTransform), cursor);
    const centerX = bounds.minX + bounds.w / 2;
    const centerY = bounds.minY + bounds.h / 2;
    const fixedX = handle.includes('w') ? bounds.maxX
      : handle.includes('e') ? bounds.minX : centerX;
    const fixedY = handle.includes('n') ? bounds.maxY
      : handle.includes('s') ? bounds.minY : centerY;
    let width = handle.includes('w') ? fixedX - localCursor.x
      : handle.includes('e') ? localCursor.x - fixedX : bounds.w;
    let height = handle.includes('n') ? fixedY - localCursor.y
      : handle.includes('s') ? localCursor.y - fixedY : bounds.h;
    width = Math.max(4, width);
    height = Math.max(4, height);
    if (constrainAspect && bounds.w > 0 && bounds.h > 0) {
      const aspect = bounds.w / bounds.h;
      if (!handle.includes('n') && !handle.includes('s')) height = width / aspect;
      else if (!handle.includes('e') && !handle.includes('w')) width = height * aspect;
      else if (width / height > aspect) height = width / aspect;
      else width = height * aspect;
    }
    const snappedDimensions = this.editor.snapping.snapDimensions(
      this.editor, id, width, height,
      { width: handle.includes('e') || handle.includes('w'), height: handle.includes('n') || handle.includes('s') },
      disableSnap,
    );
    width = snappedDimensions.width;
    height = snappedDimensions.height;
    if (constrainAspect && bounds.w > 0 && bounds.h > 0) {
      const aspect = bounds.w / bounds.h;
      if (!handle.includes('n') && !handle.includes('s')) height = width / aspect;
      else if (!handle.includes('e') && !handle.includes('w')) width = height * aspect;
      else if (width / height > aspect) height = width / aspect;
      else width = height * aspect;
    }

    const util = this.editor.getShapeUtil(shape.type);
    const localInitialShape = { ...shape, x: bounds.minX, y: bounds.minY };
    const newBounds = makeBox(bounds.minX, bounds.minY, width, height);
    const result = util.onResize(localInitialShape as any, {
      handle,
      scaleX: width / (bounds.w || 1),
      scaleY: height / (bounds.h || 1),
      initialShape: localInitialShape as any,
      initialBounds: bounds,
      newBounds,
    });
    const resizedShape = {
      ...shape,
      ...result,
      x: shape.x,
      y: shape.y,
      props: { ...shape.props, ...((result as any).props ?? {}) },
    } as import('../types.js').GlideShape;
    const resizedBounds = util.getGeometry(resizedShape as any).getBounds();
    const opposite = (candidate: import('../types.js').Box2d): Vec2 => ({
      x: handle.includes('w') ? candidate.maxX
        : handle.includes('e') ? candidate.minX : candidate.minX + candidate.w / 2,
      y: handle.includes('n') ? candidate.maxY
        : handle.includes('s') ? candidate.minY : candidate.minY + candidate.h / 2,
    });
    const fixedPage = applyMatrixToPoint(worldTransform, opposite(bounds));
    const translation = this.editor.transforms.getTranslationForLocalPoint(
      resizedShape,
      opposite(resizedBounds),
      fixedPage,
    );
    this.editor.updateShape(id, {
      ...result,
      x: translation.x,
      y: translation.y,
    });
  }

  private _shouldConstrainAspect(shiftKey: boolean): boolean {
    if (this._info.initialGeom.size === 1) return shiftKey;
    return shouldConstrainSelectionResizeAspect(
      Array.from(this._info.initialGeom.values(), entry => entry.shape),
      shiftKey,
    );
  }
}

// ────────────────────────────────────────────────────────────
// DraggingRotation
// ────────────────────────────────────────────────────────────

export interface RotationInfo {
  shapeIds:        ShapeId[];
  center:          Vec2;
  /** Per-shape rotation at start (radians). */
  initialRotation: Map<ShapeId, number>;
  /** Per-shape center at start */
  initialCenters:  Map<ShapeId, Vec2>;
  initialShapes:   Map<ShapeId, import('../types.js').GlideShape>;
  initialWorldTransforms: Map<ShapeId, Matrix2d>;
  /** Angle from center to cursor at drag start (radians). */
  startAngle:      number;
}

const SNAP_ANGLE = Math.PI / 12; // 15°

class DraggingRotation extends StateNode {
  static override readonly id = 'draggingRotation';

  private _info!: RotationInfo;

  override onEnter(info: RotationInfo): void {
    this._info = info;
    this.editor.beginHistoryPreview();
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this.editor.batch('Rotate Preview', () => {
      this._applyRotation(e.point, (e as any).shiftKey ?? false);
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    this.editor.batch('Rotate Shapes Preview', () => {
      this._applyRotation(e.point, (e as any).shiftKey ?? false);
    }, { history: 'ignore' });

    const before = new Map<string, AnyRecord | null>();
    for (const [id, shape] of this._info.initialShapes) {
      before.set(id, shape as unknown as AnyRecord);
    }
    this.editor.recordHistoryPreview('Rotate Shapes', before);
    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.batch('Cancel Rotate', () => {
        for (const [id, r] of this._info.initialRotation) {
          const shape = this._info.initialShapes.get(id);
          if (shape) {
            this.editor.updateShape(id, { 
              rotation: r,
              x: shape.x, y: shape.y,
              props: shape.props as any
            });
          }
        }
      }, { history: 'ignore' });
      this.editor.cancelHistoryPreview();
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.editor.cancelHistoryPreview();
  }

  private _applyRotation(cursor: Vec2, snap: boolean): void {
    const { center, startAngle } = this._info;
    const currentAngle = Math.atan2(cursor.y - center.y, cursor.x - center.x);
    let delta = currentAngle - startAngle;

    // Shift: snap to 15° increments
    if (snap) {
      delta = Math.round(delta / SNAP_ANGLE) * SNAP_ANGLE;
    }

    const orbit = multiplyMatrices(
      translationMatrix(center.x, center.y),
      multiplyMatrices(rotationMatrix(delta), translationMatrix(-center.x, -center.y)),
    );

    for (const id of this._info.shapeIds) {
      const initS = this._info.initialShapes.get(id);
      const initialWorld = this._info.initialWorldTransforms.get(id);
      if (!initS || !initialWorld) continue;
      if (initS.type === 'arrow') {
        const arrow = initS as ArrowShape;
        const startWorld = applyMatrixToPoint(initialWorld, arrow.props.start.point);
        const endWorld = applyMatrixToPoint(initialWorld, arrow.props.end.point);
        const nextStartWorld = applyMatrixToPoint(orbit, startWorld);
        const nextEndWorld = applyMatrixToPoint(orbit, endWorld);
        const start = this.editor.pageToParent(arrow.parentId, nextStartWorld);
        const end = this.editor.pageToParent(arrow.parentId, nextEndWorld);
        this.editor.updateShape<ArrowShape>(id, {
          x: start.x, y: start.y, rotation: 0,
          props: {
            ...arrow.props,
            start: { ...arrow.props.start, point: { x: 0, y: 0 } },
            end: { ...arrow.props.end, point: { x: end.x - start.x, y: end.y - start.y } },
          },
        });
      } else {
        const desiredWorld = multiplyMatrices(orbit, initialWorld);
        const placement = this.editor.transforms.getLocalPlacementForWorldTransform(
          initS,
          desiredWorld,
          initS.parentId,
        );
        this.editor.updateShape(id, placement);
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// SelectTool (root)
// ────────────────────────────────────────────────────────────

export class SelectTool extends StateNode {
  static override readonly id = 'select';
  static override children = () => [
    Idle,
    PointingShape,
    Dragging,
    PointingCanvas,
    MarqueeSelecting,
    DraggingHandle,
    DraggingResize,
    DraggingRotation,
  ];

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      if (this.editor.exitGroup()) return;
      this.editor.setSelectedShapeIds([]);
      this.transition('idle');
    }
  }
}

function shouldConstrainSelectionResizeAspect(
  shapes: Iterable<import('../types.js').GlideShape>,
  shiftKey: boolean,
): boolean {
  for (const shape of shapes) {
    if (shouldConstrainResizeAspect(shape, shiftKey)) return true;
  }
  return false;
}
