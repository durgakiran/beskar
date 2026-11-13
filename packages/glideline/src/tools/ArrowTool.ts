import { StateNode } from '../state-node.js';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node.js';
import type { AnyRecord, ShapeId, Vec2 } from '../types.js';
import type { ArrowShape, ArrowTerminal } from '../shapes/ArrowUtil.js';
import type { BindingPreviewCandidate } from '../editor.js';
import { buildArrowBindingRecord, buildArrowShapeRecord } from '../arrow-records.js';
import { resolveBindingCandidate } from '../binding-candidate.js';

const CENTER = { x: 0.5, y: 0.5 };
const ORIGIN = { x: 0, y: 0 };

function terminalAt(point: Vec2, candidate: BindingPreviewCandidate | null): ArrowTerminal {
  return {
    point,
    boundShapeId: candidate?.targetId ?? null,
    normalizedAnchor: candidate?.normalizedAnchor ?? CENTER,
  };
}

export class ArrowIdle extends StateNode {
  static override readonly id = 'idle';

  get hoverShapeId(): ShapeId | null {
    return this.editor.bindingPreview.peek()?.targetId ?? null;
  }

  override onPointerMove(e: PointerMoveEvent): void {
    const source = resolveBindingCandidate(this.editor, e.point);
    this.editor.setBindingPreview(source ? { ...source, terminal: 'start', sourceCandidate: null } : null);
  }

  override onPointerDown(e: PointerDownEvent): void {
    const source = resolveBindingCandidate(this.editor, e.point);
    this.parent!.transition('drawing', { origin: e.point, source });
  }

  override onExit(): void {
    this.editor.clearBindingPreview();
  }
}

class Drawing extends StateNode {
  static override readonly id = 'drawing';

  private _id!: ShapeId;
  private _origin!: Vec2;
  private _source: BindingPreviewCandidate | null = null;
  private _lastPointer!: Vec2;
  private _lastDestination: BindingPreviewCandidate | null = null;

  override onEnter(info: { origin: Vec2; source: BindingPreviewCandidate | null }): void {
    this._origin = info.source?.point ?? info.origin;
    this._source = info.source;
    this._lastPointer = this._origin;
    this._lastDestination = null;
    this._id = this.editor.createShapeId('arrow');
    this._showPreview(null);

    const { arrowRouteStyle, arrowheadStart, arrowheadEnd } = this.editor;
    const arrow = buildArrowShapeRecord({
      id: this._id,
      startWorld: this._origin,
      endWorld: this._origin,
      parentId: this.editor.getActivePageId(),
      routeStyle: arrowRouteStyle,
      arrowheadStart,
      arrowheadEnd,
    });
    arrow.props.start = terminalAt(ORIGIN, this._source);

    this.editor.beginHistoryPreview();
    this.editor.batch('Arrow Preview', () => {
      this.editor.createShape(arrow as unknown as AnyRecord);
    }, { history: 'ignore' });
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this._refreshSource();
    this._lastPointer = e.point;
    this._lastDestination = this._destinationAt(e.point);
    this._showPreview(this._lastDestination);
    this.editor.batch('Arrow Preview Update', () => {
      this._updateArrow(e.point, this._lastDestination);
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    this._refreshSource();
    this._finalizeArrow(e.point, this._destinationAt(e.point));
  }

  override onPointerCancel(): void {
    // Browser cancellation has no reliable drop point. Keep the last staged endpoint.
    this._refreshSource();
    this._finalizeArrow(this._lastPointer, this._lastDestination);
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') this.parent!.transition('idle');
  }

  override onExit(): void {
    this.editor.clearBindingPreview();
    this.editor.cancelHistoryPreview();
  }

  private _destinationAt(point: Vec2): BindingPreviewCandidate | null {
    return resolveBindingCandidate(this.editor, point, [this._source?.targetId ?? null]);
  }

  private _refreshSource(): void {
    const source = this._source;
    if (!source) return;
    if (!this.editor.getShape(source.targetId)) {
      this._source = null;
      return;
    }
    const point = this.editor.transforms.resolveConnectionAnchor(source.targetId, source.normalizedAnchor, source.anchorMode);
    if (point.x !== source.point.x || point.y !== source.point.y) {
      this._source = {
        ...source,
        point,
        candidateAnchors: this.editor.transforms.getConnectionAnchors(source.targetId),
      };
    }
  }

  private _showPreview(destination: BindingPreviewCandidate | null): void {
    const active = destination ?? this._source;
    this.editor.setBindingPreview(active ? {
      ...active,
      terminal: destination ? 'end' : 'start',
      sourceCandidate: destination ? this._source : null,
    } : null);
  }

  private _updateArrow(pointer: Vec2, destination: BindingPreviewCandidate | null): void {
    const arrow = this.editor.getShape<ArrowShape>(this._id);
    if (!arrow) return;
    const point = destination?.point ?? pointer;
    const start = this._source?.point ?? this._origin;
    this.editor.updateShape<ArrowShape>(this._id, {
      x: start.x,
      y: start.y,
      props: {
        ...arrow.props,
        start: terminalAt(ORIGIN, this._source),
        end: terminalAt({ x: point.x - start.x, y: point.y - start.y }, destination),
      },
    });
  }

  private _finalizeArrow(pointer: Vec2, destination: BindingPreviewCandidate | null): void {
    if (!this.editor.getShape(this._id)) {
      this.parent!.transition('idle');
      return;
    }
    if (destination && !this.editor.getShape(destination.targetId)) destination = null;
    this.editor.batch('Arrow Preview Update', () => {
      this._updateArrow(pointer, destination);
      for (const [terminal, candidate] of [['start', this._source], ['end', destination]] as const) {
        if (!candidate || !this.editor.getShape(candidate.targetId)) continue;
        this.editor.createBinding(buildArrowBindingRecord({
          id: this.editor.createBindingId('arrow'),
          fromId: this._id,
          toId: candidate.targetId,
          terminal,
          normalizedAnchor: candidate.normalizedAnchor,
          anchorMode: candidate.anchorMode,
          fromEdge: this.editor.transforms.getAnchorPageEdge(candidate.targetId, candidate.normalizedAnchor, candidate.anchorMode),
        }));
      }
    }, { history: 'ignore' });

    this.editor.recordHistoryPreview('Create Arrow', new Map([[this._id, null]]));
    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([this._id]);
  }
}

export class ArrowTool extends StateNode {
  static override readonly id = 'arrow';
  static override children = () => [ArrowIdle, Drawing];
}
