import { StateNode } from '../state-node.js';
import type { KeyDownEvent, PointerDownEvent, PointerMoveEvent, PointerUpEvent } from '../state-node.js';
import type { AnyRecord, GlideAsset, ShapeId, Vec2 } from '../types.js';

const DRAG_THRESHOLD = 4;
const DEFAULT_CLICK_SIZE = 240;

export interface RetainedAssetProvenance {
  readonly providerId: string;
  readonly itemId: string;
  readonly sourceLibraryId: string;
  readonly sourceVersion: string;
  readonly license: string;
}

export interface AssetPlacementSelection {
  readonly itemId: string;
  readonly mediaType: 'svg' | 'raster';
  readonly width: number;
  readonly height: number;
  readonly provenance: RetainedAssetProvenance;
}

export interface AssetMaterializationRequest {
  readonly itemId: string;
  readonly signal: AbortSignal;
  readonly provenance: RetainedAssetProvenance;
}

export interface AssetMaterialization {
  readonly asset: GlideAsset;
  readonly contentHash: string;
  /** Idempotently releases content acquired by this operation when placement does not commit. */
  rollback(reason: 'cancelled' | 'placement-failed'): void | Promise<void>;
}

export type AssetMaterializer = (request: AssetMaterializationRequest) => Promise<AssetMaterialization>;

export interface AssetPlacementCallbacks {
  onPlaced?(shapeId: ShapeId): void;
  onError?(error: unknown): void;
  onPendingChange?(pending: boolean): void;
}

interface PlacementBounds { x: number; y: number; w: number; h: number }

function reportPlacementError(callbacks: AssetPlacementCallbacks, error: unknown): void {
  try {
    callbacks.onError?.(error);
  } catch {
    // Host callbacks cannot change placement commit or compensation semantics.
  }
}

function runPostCommit(callbacks: AssetPlacementCallbacks, callback: () => void): void {
  try {
    callback();
  } catch (error) {
    reportPlacementError(callbacks, error);
  }
}

function mergeRetainedMetadata(
  record: AnyRecord,
  retained: Readonly<RetainedAssetProvenance & { contentHash: string }>,
): AnyRecord | null {
  const meta = record['meta'] && typeof record['meta'] === 'object'
    ? record['meta'] as AnyRecord
    : {};
  const existing = meta['assetLibrary'] && typeof meta['assetLibrary'] === 'object'
    ? meta['assetLibrary'] as AnyRecord
    : {};
  const merged: AnyRecord = { ...existing };
  let changed = false;
  for (const [key, value] of Object.entries(retained)) {
    if (typeof existing[key] === 'string' && existing[key] !== '') continue;
    merged[key] = value;
    changed = true;
  }
  if (!changed) return null;
  return { ...record, meta: { ...meta, assetLibrary: merged } };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clickBounds(point: Vec2, selection: AssetPlacementSelection): PlacementBounds {
  const scale = Math.min(1, DEFAULT_CLICK_SIZE / Math.max(selection.width, selection.height));
  const w = Math.max(1, selection.width * scale);
  const h = Math.max(1, selection.height * scale);
  return { x: point.x - w / 2, y: point.y - h / 2, w, h };
}

function dragBounds(origin: Vec2, point: Vec2, selection: AssetPlacementSelection): PlacementBounds {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const ratio = selection.width / selection.height;
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  if (w === 0) w = h * ratio;
  else if (h === 0) h = w / ratio;
  else if (w / h > ratio) w = h * ratio;
  else h = w / ratio;
  return {
    x: dx < 0 ? origin.x - w : origin.x,
    y: dy < 0 ? origin.y - h : origin.y,
    w: Math.max(1, w),
    h: Math.max(1, h),
  };
}

class Idle extends StateNode {
  static override readonly id = 'idle';
  override onPointerDown(event: PointerDownEvent): void {
    (this.parent as AssetPlacementTool).beginPointer(event.point);
    this.parent!.transition('pointing', event);
  }
  override onKeyDown(event: KeyDownEvent): void {
    if (event.key === 'Escape') {
      (this.parent as AssetPlacementTool).cancel();
      this.editor.setCurrentTool('select');
    }
  }
  override onExit(): void {
    (this.parent as AssetPlacementTool).abortPending();
  }
}

class Pointing extends StateNode {
  static override readonly id = 'pointing';
  private origin!: Vec2;
  private dragging = false;

  override onEnter(event: PointerDownEvent): void {
    this.origin = event.point;
    this.dragging = false;
  }

  override onPointerMove(event: PointerMoveEvent): void {
    if (distance(this.origin, event.point) > DRAG_THRESHOLD) this.dragging = true;
  }

  override onPointerUp(event: PointerUpEvent): void {
    const tool = this.parent as AssetPlacementTool;
    const bounds = this.dragging
      ? dragBounds(this.origin, event.point, tool.getSelection())
      : clickBounds(event.point, tool.getSelection());
    this.parent!.transition('idle');
    void tool.place(bounds);
  }

  override onKeyDown(event: KeyDownEvent): void {
    if (event.key !== 'Escape') return;
    (this.parent as AssetPlacementTool).cancel();
    this.editor.setCurrentTool('select');
  }
}

export class AssetPlacementTool extends StateNode {
  static override readonly id = 'asset';
  static override children = () => [Idle, Pointing];

  private selection?: AssetPlacementSelection;
  private materializer?: AssetMaterializer;
  private callbacks: AssetPlacementCallbacks = {};
  private operation?: AbortController;

  configure(
    selection: AssetPlacementSelection,
    materializer: AssetMaterializer,
    callbacks: AssetPlacementCallbacks = {},
  ): this {
    if (!(selection.width > 0) || !(selection.height > 0)) {
      throw new Error('Asset placement dimensions must be positive');
    }
    this.cancel();
    this.selection = selection;
    this.materializer = materializer;
    this.callbacks = callbacks;
    return this;
  }

  getSelection(): AssetPlacementSelection {
    if (!this.selection || !this.materializer) throw new Error('AssetPlacementTool is not configured');
    return this.selection;
  }

  beginPointer(_point: Vec2): void {
    this.getSelection();
    this.abortPending();
  }

  cancel(): void {
    this.abortPending();
    this.selection = undefined;
    this.materializer = undefined;
    this.callbacks = {};
  }

  abortPending(): void {
    this.operation?.abort();
  }

  override onExit(): void {
    this.cancel();
  }

  async place(bounds: PlacementBounds): Promise<ShapeId | null> {
    const selection = this.getSelection();
    const materializer = this.materializer!;
    const operation = new AbortController();
    this.operation?.abort();
    this.operation = operation;
    const callbacks = this.callbacks;
    runPostCommit(callbacks, () => callbacks.onPendingChange?.(true));
    let materialized: AssetMaterialization | undefined;
    let committed = false;
    let shapeId: ShapeId | undefined;
    try {
      materialized = await materializer({
        itemId: selection.itemId,
        signal: operation.signal,
        provenance: selection.provenance,
      });
      if (operation.signal.aborted) {
        await materialized.rollback('cancelled');
        return null;
      }

      const asset = materialized.asset;
      const expectedType = selection.mediaType === 'svg' ? 'sanitized-svg' : 'raster-image';
      if (asset.kind !== 'asset' || asset.type !== expectedType) {
        throw new Error(`Materialized asset type must be "${expectedType}"`);
      }
      const props = asset.props as AnyRecord;
      if (props['hash'] !== materialized.contentHash) {
        throw new Error('Materialized asset content hash does not match its immutable record');
      }

      shapeId = this.editor.createShapeId(expectedType);
      const retained = Object.freeze({ ...selection.provenance, contentHash: materialized.contentHash });
      const assetRecord = {
        ...asset,
        meta: { ...asset.meta, assetLibrary: retained },
      } as unknown as AnyRecord;
      const shapeRecord: AnyRecord = {
        id: shapeId,
        kind: 'shape',
        type: expectedType,
        x: bounds.x,
        y: bounds.y,
        index: this.editor.generateIndexAbove(this.editor.getActivePageId()),
        rotation: 0,
        parentId: this.editor.getActivePageId(),
        isLocked: false,
        isHidden: false,
        props: { w: bounds.w, h: bounds.h, assetId: asset.id },
        meta: { assetLibrary: retained },
      };

      this.editor.executeCommand({
        id: 'asset.place',
        label: 'Place Asset',
        affectedIds: [String(asset.id), String(shapeId)],
        execute: tx => {
          const existing = tx.get(String(asset.id));
          if (existing) {
            const existingHash = (existing['props'] as AnyRecord)?.['hash'];
            if (existingHash !== materialized!.contentHash) {
              throw new Error(`Asset id collision for "${String(asset.id)}"`);
            }
            const merged = mergeRetainedMetadata(existing, retained);
            if (merged) tx.update(String(asset.id), () => merged);
          } else {
            tx.insert(assetRecord);
          }
          tx.insert(shapeRecord);
        },
      });
      committed = true;
    } catch (error) {
      if (materialized && !committed) {
        await materialized.rollback(operation.signal.aborted ? 'cancelled' : 'placement-failed');
      }
      if (!operation.signal.aborted) reportPlacementError(callbacks, error);
      return null;
    } finally {
      if (this.operation === operation) {
        this.operation = undefined;
        runPostCommit(callbacks, () => callbacks.onPendingChange?.(false));
      }
    }

    runPostCommit(callbacks, () => this.editor.setCurrentTool('select'));
    runPostCommit(callbacks, () => this.editor.setSelectedShapeIds([shapeId!]));
    runPostCommit(callbacks, () => callbacks.onPlaced?.(shapeId!));
    return shapeId!;
  }
}

export const AssetPlacementPlugin = {
  id: 'glideline-asset-placement',
  tools: [AssetPlacementTool],
};
