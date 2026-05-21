import { StateNode } from '../state-node';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent, DoubleClickEvent } from '../state-node';
import type { ShapeId, Vec2, AnyRecord } from '../types';
import { makeBox, bid, sid } from '../types';
import type { ArrowShape, ArrowProps } from '../shapes/ArrowUtil';
import { anchorToPoint, anchorToEdge, getClosestConnectionPoint } from '../shapes/ArrowUtil';
import { computeElbowPath, parseElbowPoints, getOrthoHandlePoint } from '../elbow-router';

const DRAG_THRESHOLD = 4;

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// ─────────────────────────────────────────────────────────────
// Idle
// ─────────────────────────────────────────────────────────────

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(e: PointerDownEvent): void {
    // 1. Check if clicked on any handle of currently selected arrows
    const selectedIds = this.editor.getSelectedShapeIds();
    for (const id of selectedIds) {
      const shape = this.editor.getShape(id);
      if (!shape || shape.type !== 'arrow') continue;

      const arrow = shape as ArrowShape;
      const { start, end, routeStyle, bend } = arrow.props;

      // Start handle
      if (dist(e.point, start.point) <= 8) {
        const bindings = this.editor.getBindingsFromShape(id);
        const b = bindings.find((b: any) => b.props.terminal === 'start');
        this.parent!.transition('draggingHandle', {
          arrowId: id,
          handleType: 'start',
          origin: e.point,
          initialProps: { ...arrow.props },
          initialBinding: b ? { ...b } : null,
        });
        return;
      }

      // End handle
      if (dist(e.point, end.point) <= 8) {
        const bindings = this.editor.getBindingsFromShape(id);
        const b = bindings.find((b: any) => b.props.terminal === 'end');
        this.parent!.transition('draggingHandle', {
          arrowId: id,
          handleType: 'end',
          origin: e.point,
          initialProps: { ...arrow.props },
          initialBinding: b ? { ...b } : null,
        });
        return;
      }

      // Bend handle
      if (routeStyle === 'curve') {
        const sx = start.point.x;
        const sy = start.point.y;
        const ex = end.point.x;
        const ey = end.point.y;
        const mx = (sx + ex) / 2;
        const my = (sy + ey) / 2;
        const dx = ex - sx;
        const dy = ey - sy;
        const chord = Math.sqrt(dx * dx + dy * dy);
        let cpx = mx;
        let cpy = my;
        if (chord >= 1e-9 && bend !== 0) {
          const perpX = dy / chord;
          const perpY = -dx / chord;
          const offset = chord * bend;
          cpx = mx + perpX * offset;
          cpy = my + perpY * offset;
        }
        const midX = 0.25 * start.point.x + 0.5 * cpx + 0.25 * end.point.x;
        const midY = 0.25 * start.point.y + 0.5 * cpy + 0.25 * end.point.y;

        if (dist(e.point, { x: midX, y: midY }) <= 8) {
          this.parent!.transition('draggingHandle', {
            arrowId: id,
            handleType: 'bend',
            origin: e.point,
            initialProps: { ...arrow.props },
            initialBinding: null,
          });
          return;
        }
      } else if (routeStyle === 'ortho') {
        const fromShape = start.boundShapeId ? this.editor.getShape(start.boundShapeId) : null;
        const toShape   = end.boundShapeId   ? this.editor.getShape(end.boundShapeId)   : null;
        if (fromShape && toShape) {
          const fu = this.editor.getShapeUtil(fromShape.type);
          const tu = this.editor.getShapeUtil(toShape.type);
          const fromBounds = fu.getGeometry(fromShape as any);
          const toBounds   = tu.getGeometry(toShape as any);
          const bindings = this.editor.getBindingsFromShape(id) || [];
          const startBind = bindings.find((b: any) => b.props.terminal === 'start');
          const endBind   = bindings.find((b: any) => b.props.terminal === 'end');
          const fromEdge = startBind?.props.fromEdge ?? 'right';
          const toEdge = endBind?.props.fromEdge ?? 'left';
          const pathStr = computeElbowPath(fromBounds, toBounds, fromEdge, toEdge, bend);
          const pts = parseElbowPoints(pathStr);
          const handlePt = getOrthoHandlePoint(pts);
          if (dist(e.point, handlePt) <= 8) {
            this.parent!.transition('draggingHandle', {
              arrowId: id,
              handleType: 'bend',
              origin: e.point,
              initialProps: { ...arrow.props },
              initialBinding: null,
            });
            return;
          }
        }
      }
    }

    // 2. Standard shape/canvas pointing logic
    if (e.target === 'shape' && e.shapeId) {
      // Select on enter if not already selected
      if (!e.shiftKey) {
        this.editor.setSelectedShapeIds([e.shapeId]);
      }
      this.parent!.transition('pointingShape', e);
    } else {
      this.parent!.transition('pointingCanvas', e);
    }
  }

  override onDoubleClick(e: DoubleClickEvent): void {
    // Double-click on a labeled shape → start inline editing
    if (e.shapeId) {
      const shape = this.editor.getShape(e.shapeId);
      if (!shape) return;
      const labeledTypes = ['box', 'ellipse', 'sticky-note', 'text', 'frame'];
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

    this.editor.history.batch('Move Shapes', () => {
      for (const [id, start] of startPositions) {
        this.editor.updateShape(id, { x: start.x + fdx, y: start.y + fdy });
      }
    });

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
      this.parent!.transition('idle');
    }
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
  }

  override onPointerMove(e: PointerMoveEvent): void {
    const arrow = this.editor.getShape(this._arrowId) as ArrowShape;
    if (!arrow) return;

    this.editor.history.batch('Drag Handle', () => {
      if (this._handleType === 'bend') {
        const { start, end, routeStyle } = this._initialProps;
        if (routeStyle === 'ortho') {
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

        const sx = start.point.x;
        const sy = start.point.y;
        const ex = end.point.x;
        const ey = end.point.y;
        const mx = (sx + ex) / 2;
        const my = (sy + ey) / 2;
        const dx = ex - sx;
        const dy = ey - sy;
        const chord = Math.sqrt(dx * dx + dy * dy);

        if (chord < 1e-9) {
          this.editor.updateShape(this._arrowId, {
            props: {
              ...arrow.props,
              bend: 0,
            }
          });
          return;
        }

        const perpX = dy / chord;
        const perpY = -dx / chord;
        const px = e.point.x - mx;
        const py = e.point.y - my;
        const dist_perp = px * perpX + py * perpY;
        const bend = (2 * dist_perp) / chord;

        this.editor.updateShape(this._arrowId, {
          props: {
            ...arrow.props,
            bend,
          }
        });
      } else {
        const term = this._handleType;
        const initialTerminal = this._initialProps[term];
        const dx = e.point.x - this._origin.x;
        const dy = e.point.y - this._origin.y;

        const nextPoint = {
          x: initialTerminal.point.x + dx,
          y: initialTerminal.point.y + dy,
        };

        if (this._initialBinding) {
          this.editor.deleteBinding(this._initialBinding.id);
        }

        const otherTerminal = term === 'start' ? 'end' : 'start';
        const otherBoundId = arrow.props[otherTerminal].boundShapeId;
        const hits = this.editor.getShapesAtPoint(e.point)
          .filter(s => s.type !== 'arrow' && s.id !== otherBoundId && s.id !== this._arrowId);

        let finalPoint = nextPoint;
        let boundShapeId: ShapeId | null = null;
        let normalizedAnchor = { x: 0.5, y: 0.5 };

        if (hits.length > 0) {
          const targetShape = hits[hits.length - 1];
          const util = this.editor.getShapeUtil(targetShape.type);
          const bounds = util.getGeometry(targetShape as any);
          const snapped = getClosestConnectionPoint(e.point, bounds);
          finalPoint = snapped.point;
          boundShapeId = targetShape.id as ShapeId;
          normalizedAnchor = snapped.normalizedAnchor;
        }

        this.editor.updateShape(this._arrowId, {
          props: {
            ...arrow.props,
            [term]: {
              boundShapeId,
              normalizedAnchor,
              point: finalPoint,
            }
          }
        });
      }
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    const arrow = this.editor.getShape(this._arrowId) as ArrowShape;
    if (!arrow) {
      this.parent!.transition('idle');
      return;
    }

    const finalProps = { ...arrow.props };

    // 1. Revert to initial state
    this.editor.history.batch('Revert Drag Handle', () => {
      this.editor.updateShape(this._arrowId, {
        props: {
          ...this._initialProps,
        }
      });
      if (this._initialBinding) {
        this.editor.store.put([this._initialBinding]);
      }
    }, { history: 'ignore' });

    // 2. Commit transaction
    this.editor.history.batch(
      this._handleType === 'bend' ? 'Adjust Arrow Bend' : 'Move Arrow Handle',
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
            const targetShape = hits[hits.length - 1];
            const util = this.editor.getShapeUtil(targetShape.type);
            const bounds = util.getGeometry(targetShape as any);
            const snapped = getClosestConnectionPoint(e.point, bounds);

            finalProps[term] = {
              boundShapeId: targetShape.id as ShapeId,
              normalizedAnchor: snapped.normalizedAnchor,
              point: snapped.point,
            };

            const newBinding = {
              id: bid(`bind-${term}-${Date.now()}-${Math.random().toString(36).slice(2)}`),
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
            this.editor.createBinding(newBinding as any);
          }
        }

        this.editor.updateShape(this._arrowId, {
          props: finalProps,
        });

        // Trigger updates to fire onAfterChangeToShape and refresh coordinates
        if (finalProps.start.boundShapeId) {
          const s = this.editor.getShape(finalProps.start.boundShapeId);
          if (s) this.editor.updateShape(finalProps.start.boundShapeId, { x: s.x });
        }
        if (finalProps.end.boundShapeId) {
          const s = this.editor.getShape(finalProps.end.boundShapeId);
          if (s) this.editor.updateShape(finalProps.end.boundShapeId, { x: s.x });
        }
      }
    );

    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.history.batch('Cancel Drag Handle', () => {
        this.editor.updateShape(this._arrowId, {
          props: {
            ...this._initialProps,
          }
        });
        if (this._initialBinding) {
          this.editor.store.put([this._initialBinding]);
        }
      }, { history: 'ignore' });

      this.parent!.transition('idle');
    }
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
  marqueeBox = makeBox(0, 0, 0, 0);

  override onEnter(info: { origin: Vec2; current: Vec2 }): void {
    this._origin   = info.origin;
    this._updateMarquee(info.current);
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this._updateMarquee(e.point);
  }

  override onPointerUp(e: PointerUpEvent): void {
    this._updateMarquee(e.point);
    const { minX, minY, maxX, maxY } = this.marqueeBox;
    const shapes = this.editor.getShapesInBox({ minX, minY, maxX, maxY });
    this.editor.setSelectedShapeIds(shapes.map(s => s.id as ShapeId));
    this.parent!.transition('idle');
  }

  private _updateMarquee(pt: Vec2): void {
    const x  = Math.min(this._origin.x, pt.x);
    const y  = Math.min(this._origin.y, pt.y);
    const w  = Math.abs(pt.x - this._origin.x);
    const h  = Math.abs(pt.y - this._origin.y);
    this.marqueeBox = makeBox(x, y, w, h);
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
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ResizeInfo {
  shapeIds:    ShapeId[];
  handle:      ResizeHandle;
  origin:      Vec2;
  /** Per-shape snapshot: { x, y, w, h } before resize begins */
  initialGeom: Map<ShapeId, { x: number; y: number; w: number; h: number }>;
}

class DraggingResize extends StateNode {
  static override readonly id = 'draggingResize';

  private _info!: ResizeInfo;

  override onEnter(info: ResizeInfo): void {
    this._info = info;
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this.editor.history.batch('Resize Preview', () => {
      this._applyResize(e.point, (e as any).shiftKey ?? false);
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    this.editor.history.batch('Resize Shapes', () => {
      this._applyResize(e.point, (e as any).shiftKey ?? false);
    });
    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      // Restore all shapes to their initial geometry
      this.editor.history.batch('Cancel Resize', () => {
        for (const [id, g] of this._info.initialGeom) {
          const existing = this.editor.getShape(id);
          this.editor.updateShape(id, {
            x: g.x, y: g.y,
            props: { ...(existing?.props as any), w: g.w, h: g.h },
          });
        }
      }, { history: 'ignore' });
      this.parent!.transition('idle');
    }
  }

  private _applyResize(cursor: Vec2, constrainAspect: boolean): void {
    const { handle, origin, initialGeom } = this._info;
    const dx = cursor.x - origin.x;
    const dy = cursor.y - origin.y;

    for (const [id, g] of initialGeom) {
      let { x, y, w, h } = g;

      // Apply delta per handle type
      switch (handle) {
        case 'se': w += dx; h += dy; break;
        case 'sw': x += dx; w -= dx; h += dy; break;
        case 'ne': w += dx; y += dy; h -= dy; break;
        case 'nw': x += dx; w -= dx; y += dy; h -= dy; break;
        case 'e':  w += dx; break;
        case 'w':  x += dx; w -= dx; break;
        case 's':  h += dy; break;
        case 'n':  y += dy; h -= dy; break;
      }

      // Enforce minimum size
      if (w < 4) { if (handle.includes('w')) x = g.x + g.w - 4; w = 4; }
      if (h < 4) { if (handle.includes('n')) y = g.y + g.h - 4; h = 4; }

      // Shift: constrain to original aspect ratio
      if (constrainAspect && g.w > 0 && g.h > 0) {
        const aspect = g.w / g.h;
        if (Math.abs(dx) >= Math.abs(dy)) {
          h = w / aspect;
        } else {
          w = h * aspect;
        }
      }

      const existing = this.editor.getShape(id);
      this.editor.updateShape(id, {
        x, y,
        props: { ...(existing?.props as any), w, h },
      });
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
  /** Angle from center to cursor at drag start (radians). */
  startAngle:      number;
}

const SNAP_ANGLE = Math.PI / 12; // 15°

class DraggingRotation extends StateNode {
  static override readonly id = 'draggingRotation';

  private _info!: RotationInfo;

  override onEnter(info: RotationInfo): void {
    this._info = info;
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this.editor.history.batch('Rotate Preview', () => {
      this._applyRotation(e.point, (e as any).shiftKey ?? false);
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    this.editor.history.batch('Rotate Shapes', () => {
      this._applyRotation(e.point, (e as any).shiftKey ?? false);
    });
    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.history.batch('Cancel Rotate', () => {
        for (const [id, r] of this._info.initialRotation) {
          this.editor.updateShape(id, { rotation: r });
        }
      }, { history: 'ignore' });
      this.parent!.transition('idle');
    }
  }

  private _applyRotation(cursor: Vec2, snap: boolean): void {
    const { center, startAngle, initialRotation } = this._info;
    const currentAngle = Math.atan2(cursor.y - center.y, cursor.x - center.x);
    let delta = currentAngle - startAngle;

    // Shift: snap to 15° increments
    if (snap) {
      delta = Math.round(delta / SNAP_ANGLE) * SNAP_ANGLE;
    }

    for (const [id, initRot] of initialRotation) {
      this.editor.updateShape(id, { rotation: initRot + delta });
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
