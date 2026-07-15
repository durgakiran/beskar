import { StateNode } from '../state-node';
import { signal } from '@preact/signals';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent, DoubleClickEvent } from '../state-node';
import type { ShapeId, Vec2, AnyRecord } from '../types';
import { makeBox } from '../types';
import type { ArrowShape, ArrowProps } from '../shapes/ArrowUtil';
import { getClosestConnectionPoint, getConnectionPoints, anchorToEdge } from '../shapes/ArrowUtil';
import type { BindingPreview, BindingPreviewCandidate } from '../editor';
import type { ResizeHandle, ResizeInfo } from '../shapes/ShapeUtil';

const DRAG_THRESHOLD = 4;

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function toWorldBounds(
  localBounds: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number; x?: number; y?: number },
  shape: { x: number; y: number }
) {
  return {
    ...localBounds,
    x: localBounds.minX + shape.x,
    y: localBounds.minY + shape.y,
    minX: localBounds.minX + shape.x,
    minY: localBounds.minY + shape.y,
    maxX: localBounds.maxX + shape.x,
    maxY: localBounds.maxY + shape.y,
  };
}

function buildBindingPreview(editor: StateNode['editor'], targetShape: { id: ShapeId; type: string; x: number; y: number }, point: Vec2, terminal: 'start' | 'end') {
  const util = editor.getShapeUtil(targetShape.type);
  const localBounds = util.getGeometry(targetShape as any).getBounds();
  const worldBounds = toWorldBounds(localBounds, targetShape);
  const snapped = getClosestConnectionPoint(point, worldBounds);

  return {
    terminal,
    targetId: targetShape.id,
    targetType: targetShape.type,
    normalizedAnchor: snapped.normalizedAnchor,
    point: snapped.point,
    candidateAnchors: getConnectionPoints(worldBounds),
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
          const b = this.editor.getShapeUtil(s.type).getGeometry(s as any).getBounds();
          return { minX: b.minX + s.x, minY: b.minY + s.y, maxX: b.maxX + s.x, maxY: b.maxY + s.y, w: b.w, h: b.h };
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
            return [id, { x: b.minX + s.x + b.w / 2, y: b.minY + s.y + b.h / 2 }] as [ShapeId, Vec2];
          }).filter(Boolean) as [ShapeId, Vec2][]);
          
          const initialShapes = new Map(sel.map(id => {
            const s = this.editor.getShape(id); if (!s) return null;
            return [id, JSON.parse(JSON.stringify(s))] as [ShapeId, import('../types').GlideShape];
          }).filter(Boolean) as [ShapeId, import('../types').GlideShape][]);

          this.parent!.transition('draggingRotation', { shapeIds: sel, center, initialRotation: initRot, initialCenters, initialShapes, startAngle });
          return;
        }
      }

      // Resize handle
      const resizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      if (resizeHandles.includes(e.handleId)) {
        const boxes = sel.map(id => {
          const s = this.editor.getShape(id); if (!s) return null;
          const b = this.editor.getShapeUtil(s.type).getGeometry(s as any).getBounds();
          return { minX: b.minX + s.x, minY: b.minY + s.y, maxX: b.maxX + s.x, maxY: b.maxY + s.y, w: b.w, h: b.h };
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
          return [id, { shape: clone, bounds: b }];
        }).filter(Boolean) as [ShapeId, { shape: import('../types').GlideShape; bounds: import('../types').Box2d }][]);
        
        this.parent!.transition('draggingResize', {
          shapeIds: sel,
          handle: e.handleId as ResizeHandle,
          origin: e.point,
          initialGeom,
          initialBounds,
        });
        return;
      }
    }

    // Standard shape/canvas pointing logic
    if (e.target === 'shape' && e.shapeId) {
      // Select on enter if not already selected
      if (!e.shiftKey && !this.editor.getSelectedShapeIds().includes(e.shapeId)) {
        this.editor.setSelectedShapeIds([e.shapeId]);
      }
      this.parent!.transition('pointingShape', e);
    } else {
      // Check if clicking inside a multi-selection bounding box
      const sel = this.editor.getSelectedShapeIds();
      if (sel.length > 1 && !e.shiftKey) {
        const boxes = sel.map(id => {
          const s = this.editor.getShape(id); if (!s) return null;
          const localBounds = this.editor.getShapeUtil(s.type).getGeometry(s as any).getBounds();
          return {
            minX: localBounds.minX + s.x,
            minY: localBounds.minY + s.y,
            maxX: localBounds.maxX + s.x,
            maxY: localBounds.maxY + s.y,
          };
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
    // Double-click on a labeled shape → start inline editing
    if (e.shapeId) {
      const shape = this.editor.getShape(e.shapeId);
      if (!shape) return;
      const labeledTypes = ['box', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'sticky-note', 'text', 'frame'];
      if (labeledTypes.includes(shape.type)) {
        this.editor.setSelectedShapeIds([e.shapeId]);
        this.editor.startEditing(e.shapeId);
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

      this.parent!.transition('dragging', {
        origin: this._origin,
        startPositions,
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
    for (const id of this.editor.getSelectedShapeIds()) {
      const shape = this.editor.getShape(id);
      if (shape) map.set(id, { x: shape.x, y: shape.y });
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
  /** 'x' | 'y' | null — determined on first significant move when shift held */
  private _axis: 'x' | 'y' | null = null;

  override onEnter(info: { origin: Vec2; startPositions: Map<ShapeId, Vec2>; constrainAxis?: boolean }): void {
    this._origin         = info.origin;
    this._startPositions = info.startPositions;
    this._axis           = null;
    this.editor.history.beginPreview();
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

    this.editor.history.batch('Drag', () => {
      for (const [id, start] of this._startPositions) {
        this.editor.updateShape(id, { x: start.x + dx, y: start.y + dy });
      }
    }, { history: 'ignore' }); // live preview — not a history record
  }

  override onPointerUp(_e: PointerUpEvent): void {
    const dx = _e.point.x - this._origin.x;
    const dy = _e.point.y - this._origin.y;
    let fdx = dx, fdy = dy;
    if (this._axis === 'x') fdy = 0;
    if (this._axis === 'y') fdx = 0;
    const startPositions = this._startPositions;

    // Publish the final pointer location atomically as an ignored preview.
    // The store may correctly treat this as a no-op when the last move event
    // already reached the same point, so history is recorded from the initial
    // snapshots explicitly below.
    this.editor.history.batch('Move Shapes Preview', () => {
      for (const [id, start] of startPositions) {
        this.editor.updateShape(id, { x: start.x + fdx, y: start.y + fdy });
      }
    }, { history: 'ignore' });

    const before = new Map<string, AnyRecord | null>();
    for (const [id, start] of startPositions) {
      const current = this.editor.getShape(id);
      if (current) before.set(id, { ...current, x: start.x, y: start.y });
    }
    this.editor.history.recordPreview('Move Shapes', before);

    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      const startPositions = this._startPositions;
      this.editor.history.batch('Cancel Drag', () => {
        for (const [id, start] of startPositions) {
          this.editor.updateShape(id, { x: start.x, y: start.y });
        }
      }, { history: 'ignore' });
      this.editor.history.cancelPreview();
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.editor.history.cancelPreview();
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
    this.editor.history.beginPreview();
  }

  override onPointerMove(e: PointerMoveEvent): void {
    const arrow = this.editor.getShape(this._arrowId) as ArrowShape;
    if (!arrow) return;

    this.editor.history.batch('Drag Handle', () => {
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
        const localCursorX = e.point.x - arrow.x;
        const localCursorY = e.point.y - arrow.y;
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
          const oldWorldEndX = this._initialArrowX + this._initialProps.end.point.x;
          const oldWorldEndY = this._initialArrowY + this._initialProps.end.point.y;

          const otherTerminal = 'end';
          const otherBoundId = arrow.props[otherTerminal].boundShapeId;
          const hits = this.editor.getShapesAtPoint(e.point)
            .filter(s => s.type !== 'arrow' && s.id !== otherBoundId && s.id !== this._arrowId);

          let finalStartX = nextStartWorldX;
          let finalStartY = nextStartWorldY;
          let boundShapeId: ShapeId | null = null;
          let normalizedAnchor = { x: 0.5, y: 0.5 };

          if (hits.length > 0) {
            const targetShape = hits[hits.length - 1]!;
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

          this.editor.updateShape(this._arrowId, {
            x: finalStartX,
            y: finalStartY,
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
                  x: oldWorldEndX - finalStartX,
                  y: oldWorldEndY - finalStartY,
                },
              },
            }
          });
        } else {
          // Moving the end terminal: end.point changes (local offset)
          const initEndLocal = this._initialProps.end.point;
          const nextEndWorldX = e.point.x;
          const nextEndWorldY = e.point.y;
          const arrowX = (this.editor.getShape(this._arrowId) as ArrowShape)?.x ?? 0;
          const arrowY = (this.editor.getShape(this._arrowId) as ArrowShape)?.y ?? 0;

          const otherTerminal = 'start';
          const otherBoundId = arrow.props[otherTerminal].boundShapeId;
          const hits = this.editor.getShapesAtPoint(e.point)
            .filter(s => s.type !== 'arrow' && s.id !== otherBoundId && s.id !== this._arrowId);

          let finalEndLocalX = nextEndWorldX - arrowX;
          let finalEndLocalY = nextEndWorldY - arrowY;
          let boundShapeId: ShapeId | null = null;
          let normalizedAnchor = { x: 0.5, y: 0.5 };

          if (hits.length > 0) {
            const targetShape = hits[hits.length - 1]!;
            const preview = buildBindingPreview(this.editor, targetShape as any, e.point, 'end');
            const snapped = { normalizedAnchor: preview.normalizedAnchor, point: preview.point };
            finalEndLocalX = snapped.point.x - arrowX;
            finalEndLocalY = snapped.point.y - arrowY;
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
    const finalArrowX = arrow.x;
    const finalArrowY = arrow.y;
    let newBindingId: string | null = null;

    // Finalize bindings and the last pointer position as one publication. The
    // live arrow preview is already in the store, so history is synthesized
    // from the snapshots captured when the interaction began.
    this.editor.history.batch(
      'Finalize Arrow Handle Preview',
      () => {
        if (this._handleType !== 'bend' && this._initialBinding) {
          this.editor.deleteBinding(this._initialBinding.id);
        }

        if (this._handleType !== 'bend') {
          const term = this._handleType;
          const otherTerminal = term === 'start' ? 'end' : 'start';
          const otherBoundId = finalProps[otherTerminal].boundShapeId;
          const hits = this.editor.getShapesAtPoint(e.point)
            .filter(s => s.type !== 'arrow' && s.id !== otherBoundId && s.id !== this._arrowId);

          if (hits.length > 0) {
            const targetShape = hits[hits.length - 1]!;
            const previewCandidate = matchingPreview(activePreview, term, targetShape.id as ShapeId);
            const snapped = previewCandidate
              ? { normalizedAnchor: previewCandidate.normalizedAnchor, point: previewCandidate.point }
              : (() => {
                  const util = this.editor.getShapeUtil(targetShape.type);
                  const localBounds = util.getGeometry(targetShape as any).getBounds();
                  const worldBounds = {
                    ...localBounds,
                    minX: localBounds.minX + targetShape.x,
                    minY: localBounds.minY + targetShape.y,
                    maxX: localBounds.maxX + targetShape.x,
                    maxY: localBounds.maxY + targetShape.y,
                  };
                  return getClosestConnectionPoint(e.point, worldBounds);
                })();

            if (term === 'start') {
              // World end = arrow.x + end.point (local)
              const worldEndX = finalArrowX + finalProps.end.point.x;
              const worldEndY = finalArrowY + finalProps.end.point.y;
              finalProps.start = {
                boundShapeId: targetShape.id as ShapeId,
                normalizedAnchor: snapped.normalizedAnchor,
                point: { x: 0, y: 0 },
              };
              finalProps.end = {
                ...finalProps.end,
                point: {
                  x: worldEndX - snapped.point.x,
                  y: worldEndY - snapped.point.y,
                },
              };
              // Update arrow world position to match new start anchor
              this.editor.updateShape(this._arrowId, { x: snapped.point.x, y: snapped.point.y });
            } else {
              // end terminal: store as local offset from arrow.x/y
              finalProps.end = {
                boundShapeId: targetShape.id as ShapeId,
                normalizedAnchor: snapped.normalizedAnchor,
                point: {
                  x: snapped.point.x - finalArrowX,
                  y: snapped.point.y - finalArrowY,
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
                fromEdge: anchorToEdge(snapped.normalizedAnchor),
              },
            };
            newBindingId = newBinding.id;
            this.editor.createBinding(newBinding as any);
          }
        }

        this.editor.updateShape(this._arrowId, { props: finalProps });

        // Trigger updates to fire onAfterChangeToShape and refresh coordinates
        if (finalProps.start.boundShapeId) {
          const s = this.editor.getShape(finalProps.start.boundShapeId);
          if (s) this.editor.updateShape(finalProps.start.boundShapeId, { x: s.x });
        }
        if (finalProps.end.boundShapeId) {
          const s = this.editor.getShape(finalProps.end.boundShapeId);
          if (s) this.editor.updateShape(finalProps.end.boundShapeId, { x: s.x });
        }
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
    this.editor.history.recordPreview(
      this._handleType === 'bend' ? 'Adjust Arrow Bend' : 'Move Arrow Handle',
      before,
    );

    this.parent!.transition('idle');
  }


  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.clearBindingPreview();
      this.editor.history.batch('Cancel Drag Handle', () => {
        this.editor.updateShape(this._arrowId, {
          x: this._initialArrowX,
          y: this._initialArrowY,
          props: {
            ...this._initialProps,
          }
        });
        if (this._initialBinding) {
          this.editor.store.put([this._initialBinding]);
        }
      }, { history: 'ignore' });

      this.editor.history.cancelPreview();
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.editor.clearBindingPreview();
    this.editor.history.cancelPreview();
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
    this.editor.setSelectedShapeIds(shapes.map(s => s.id as ShapeId));
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
  initialGeom: Map<ShapeId, { shape: import('../types').GlideShape; bounds: import('../types').Box2d }>;
  initialBounds: import('../types').Box2d;
}

class DraggingResize extends StateNode {
  static override readonly id = 'draggingResize';

  private _info!: DraggingResizeState;

  override onEnter(info: DraggingResizeState): void {
    this._info = info;
    this.editor.history.beginPreview();
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this.editor.history.batch('Resize Preview', () => {
      this._applyResize(e.point, (e as any).shiftKey ?? false);
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    this.editor.history.batch('Resize Shapes Preview', () => {
      this._applyResize(e.point, (e as any).shiftKey ?? false);
    }, { history: 'ignore' });

    const before = new Map<string, AnyRecord | null>();
    for (const [id, { shape }] of this._info.initialGeom) {
      before.set(id, shape as unknown as AnyRecord);
    }
    this.editor.history.recordPreview('Resize Shapes', before);
    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      // Restore all shapes to their initial geometry
      this.editor.history.batch('Cancel Resize', () => {
        for (const [id, { shape }] of this._info.initialGeom) {
          this.editor.updateShape(id, {
            x: shape.x, y: shape.y,
            props: shape.props as any,
          });
        }
      }, { history: 'ignore' });
      this.editor.history.cancelPreview();
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.editor.history.cancelPreview();
  }

  private _applyResize(cursor: Vec2, constrainAspect: boolean): void {
    const { handle, origin, initialGeom, initialBounds } = this._info;
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
  initialShapes:   Map<ShapeId, import('../types').GlideShape>;
  /** Angle from center to cursor at drag start (radians). */
  startAngle:      number;
}

const SNAP_ANGLE = Math.PI / 12; // 15°

class DraggingRotation extends StateNode {
  static override readonly id = 'draggingRotation';

  private _info!: RotationInfo;

  override onEnter(info: RotationInfo): void {
    this._info = info;
    this.editor.history.beginPreview();
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this.editor.history.batch('Rotate Preview', () => {
      this._applyRotation(e.point, (e as any).shiftKey ?? false);
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    this.editor.history.batch('Rotate Shapes Preview', () => {
      this._applyRotation(e.point, (e as any).shiftKey ?? false);
    }, { history: 'ignore' });

    const before = new Map<string, AnyRecord | null>();
    for (const [id, shape] of this._info.initialShapes) {
      before.set(id, shape as unknown as AnyRecord);
    }
    this.editor.history.recordPreview('Rotate Shapes', before);
    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.history.batch('Cancel Rotate', () => {
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
      this.editor.history.cancelPreview();
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.editor.history.cancelPreview();
  }

  private _applyRotation(cursor: Vec2, snap: boolean): void {
    const { center, startAngle, initialRotation, initialCenters } = this._info;
    const currentAngle = Math.atan2(cursor.y - center.y, cursor.x - center.x);
    let delta = currentAngle - startAngle;

    // Shift: snap to 15° increments
    if (snap) {
      delta = Math.round(delta / SNAP_ANGLE) * SNAP_ANGLE;
    }

    const cos = Math.cos(delta);
    const sin = Math.sin(delta);

    for (const id of this._info.shapeIds) {
      const initRot = initialRotation.get(id) ?? 0;
      const initC = initialCenters.get(id);
      const initS = this._info.initialShapes.get(id);
      if (!initC || !initS) continue;

      // Orbit center around pivot
      const dx = initC.x - center.x;
      const dy = initC.y - center.y;
      const rotCx = center.x + (dx * cos - dy * sin);
      const rotCy = center.y + (dx * sin + dy * cos);

      const s = this.editor.getShape(id);
      if (s) {
        if (s.type === 'arrow') {
          const arr = initS as unknown as ArrowShape;
          const sWorld = { x: arr.x, y: arr.y };
          const eWorld = { x: arr.x + arr.props.end.point.x, y: arr.y + arr.props.end.point.y };

          const sdx = sWorld.x - center.x;
          const sdy = sWorld.y - center.y;
          const nsx = center.x + (sdx * cos - sdy * sin);
          const nsy = center.y + (sdx * sin + sdy * cos);

          const edx = eWorld.x - center.x;
          const edy = eWorld.y - center.y;
          const nex = center.x + (edx * cos - edy * sin);
          const ney = center.y + (edx * sin + edy * cos);

          this.editor.updateShape<ArrowShape>(id, {
            x: nsx,
            y: nsy,
            rotation: initRot + delta,
            props: {
              ...arr.props,
              start: { ...arr.props.start, point: { x: 0, y: 0 } },
              end: { ...arr.props.end, point: { x: nex - nsx, y: ney - nsy } },
            }
          });
        } else {
          const b = this.editor.getShapeUtil(s.type).getGeometry(s as any).getBounds();
          // Position top-left such that the shape's local center is at the new rotCx/rotCy
          // Wait, rotCx/rotCy is the world center. 
          // newX = rotCx - localCenter.x
          const localCx = b.minX + b.w / 2;
          const localCy = b.minY + b.h / 2;
          const newX = rotCx - localCx;
          const newY = rotCy - localCy;
          this.editor.updateShape(id, { x: newX, y: newY, rotation: initRot + delta });
        }
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
      this.editor.setSelectedShapeIds([]);
      this.transition('idle');
    }
  }
}
