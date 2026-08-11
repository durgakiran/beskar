import { signal, type Signal } from '@preact/signals';
import type { GlideEditor } from './editor';
import type { Box2d, ShapeId, Vec2 } from './types';

export interface SnapSettings {
  showGrid: boolean;
  snapToGrid: boolean;
  snapToObjects: boolean;
  snapToGaps: boolean;
  gridSize: number;
  tolerancePx: number;
}

export interface SnapGuide {
  id: string;
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
  kind: 'grid' | 'edge' | 'center' | 'gap';
}

export interface SnapTranslationResult {
  delta: Vec2;
  guides: readonly SnapGuide[];
}

export interface SnapDimensionsResult {
  width: number;
  height: number;
  guides: readonly SnapGuide[];
}

const DEFAULT_SETTINGS: SnapSettings = {
  showGrid: true,
  snapToGrid: false,
  snapToObjects: true,
  snapToGaps: true,
  gridSize: 16,
  tolerancePx: 8,
};

export class SnapManager {
  readonly settings: Signal<SnapSettings> = signal({ ...DEFAULT_SETTINGS });
  readonly guides: Signal<readonly SnapGuide[]> = signal([]);

  updateSettings(patch: Partial<SnapSettings>): void {
    this.settings.value = { ...this.settings.peek(), ...patch };
  }

  clearGuides(): void {
    if (this.guides.peek().length > 0) this.guides.value = [];
  }

  snapTranslation(
    editor: GlideEditor,
    movingIds: readonly ShapeId[],
    initialBounds: Box2d,
    delta: Vec2,
    disabled = false,
  ): SnapTranslationResult {
    const settings = this.settings.peek();
    if (disabled || (!settings.snapToGrid && !settings.snapToObjects)) {
      this.clearGuides();
      return { delta, guides: [] };
    }
    const tolerance = settings.tolerancePx / Math.max(editor.camera.signal.peek().z, Number.EPSILON);
    const moving = {
      minX: initialBounds.minX + delta.x,
      maxX: initialBounds.maxX + delta.x,
      minY: initialBounds.minY + delta.y,
      maxY: initialBounds.maxY + delta.y,
    };
    const movingX = [moving.minX, (moving.minX + moving.maxX) / 2, moving.maxX];
    const movingY = [moving.minY, (moving.minY + moving.maxY) / 2, moving.maxY];
    const excluded = new Set<string>();
    const excludeSubtree = (id: ShapeId) => {
      excluded.add(id);
      editor.getChildren(id).forEach(shape => excludeSubtree(shape.id as ShapeId));
    };
    movingIds.forEach(id => {
      excludeSubtree(id);
      editor.getAncestors(id).forEach(shape => excluded.add(shape.id));
    });
    const targets = editor.getShapes()
      .filter(shape => !excluded.has(shape.id) && !editor.isShapeEffectivelyHidden(shape.id as ShapeId))
      .map(shape => editor.getShapeVisualWorldBounds(shape));

    let bestX: { adjustment: number; guide: SnapGuide } | null = null;
    let bestY: { adjustment: number; guide: SnapGuide } | null = null;
    const considerX = (source: number, target: number, kind: SnapGuide['kind'], targetBox?: Box2d) => {
      const adjustment = target - source;
      if (Math.abs(adjustment) > tolerance || (bestX && Math.abs(bestX.adjustment) <= Math.abs(adjustment))) return;
      bestX = { adjustment, guide: { id: `x:${target}:${kind}`, axis: 'x', position: target,
        start: Math.min(moving.minY, targetBox?.minY ?? moving.minY) - 20,
        end: Math.max(moving.maxY, targetBox?.maxY ?? moving.maxY) + 20, kind } };
    };
    const considerY = (source: number, target: number, kind: SnapGuide['kind'], targetBox?: Box2d) => {
      const adjustment = target - source;
      if (Math.abs(adjustment) > tolerance || (bestY && Math.abs(bestY.adjustment) <= Math.abs(adjustment))) return;
      bestY = { adjustment, guide: { id: `y:${target}:${kind}`, axis: 'y', position: target,
        start: Math.min(moving.minX, targetBox?.minX ?? moving.minX) - 20,
        end: Math.max(moving.maxX, targetBox?.maxX ?? moving.maxX) + 20, kind } };
    };

    if (settings.snapToObjects) {
      for (const target of targets) {
        const targetX = [target.minX, (target.minX + target.maxX) / 2, target.maxX];
        const targetY = [target.minY, (target.minY + target.maxY) / 2, target.maxY];
        movingX.forEach((source, sourceIndex) => targetX.forEach((value, targetIndex) =>
          considerX(source, value, sourceIndex === 1 && targetIndex === 1 ? 'center' : 'edge', target)));
        movingY.forEach((source, sourceIndex) => targetY.forEach((value, targetIndex) =>
          considerY(source, value, sourceIndex === 1 && targetIndex === 1 ? 'center' : 'edge', target)));
      }
    }
    if (settings.snapToObjects && settings.snapToGaps && targets.length >= 2) {
      for (const left of targets) {
        for (const right of targets) {
          if (left === right) continue;
          if (left.maxX <= moving.minX && moving.maxX <= right.minX) {
            const targetCenter = (left.maxX + right.minX) / 2;
            considerX((moving.minX + moving.maxX) / 2, targetCenter, 'gap');
          }
          if (left.maxY <= moving.minY && moving.maxY <= right.minY) {
            const targetCenter = (left.maxY + right.minY) / 2;
            considerY((moving.minY + moving.maxY) / 2, targetCenter, 'gap');
          }
        }
      }
    }
    if (settings.snapToGrid && settings.gridSize > 0) {
      const gridX = Math.round(moving.minX / settings.gridSize) * settings.gridSize;
      const gridY = Math.round(moving.minY / settings.gridSize) * settings.gridSize;
      considerX(moving.minX, gridX, 'grid');
      considerY(moving.minY, gridY, 'grid');
    }
    const guides = [bestX?.guide, bestY?.guide].filter((guide): guide is SnapGuide => Boolean(guide));
    this.guides.value = guides;
    return {
      delta: { x: delta.x + (bestX?.adjustment ?? 0), y: delta.y + (bestY?.adjustment ?? 0) },
      guides,
    };
  }

  snapDimensions(
    editor: GlideEditor,
    movingId: ShapeId,
    width: number,
    height: number,
    axes: { width: boolean; height: boolean },
    disabled = false,
  ): SnapDimensionsResult {
    const settings = this.settings.peek();
    if (disabled || !settings.snapToObjects) return { width, height, guides: [] };
    const tolerance = settings.tolerancePx / Math.max(editor.camera.signal.peek().z, Number.EPSILON);
    let nextWidth = width;
    let nextHeight = height;
    let widthDiff = Number.POSITIVE_INFINITY;
    let heightDiff = Number.POSITIVE_INFINITY;
    let widthTarget: Box2d | null = null;
    let heightTarget: Box2d | null = null;
    for (const shape of editor.getShapes()) {
      if (shape.id === movingId || editor.isShapeEffectivelyHidden(shape.id as ShapeId)) continue;
      const local = editor.getShapeLocalBounds(shape.id as ShapeId);
      const world = editor.getShapeVisualWorldBounds(shape);
      if (axes.width && Math.abs(local.w - width) <= tolerance && Math.abs(local.w - width) < widthDiff) {
        nextWidth = local.w;
        widthDiff = Math.abs(local.w - width);
        widthTarget = world;
      }
      if (axes.height && Math.abs(local.h - height) <= tolerance && Math.abs(local.h - height) < heightDiff) {
        nextHeight = local.h;
        heightDiff = Math.abs(local.h - height);
        heightTarget = world;
      }
    }
    const guides: SnapGuide[] = [];
    if (widthTarget) guides.push({ id: `match-width:${widthTarget.w}`, axis: 'x', position: widthTarget.maxX,
      start: widthTarget.minY - 20, end: widthTarget.maxY + 20, kind: 'edge' });
    if (heightTarget) guides.push({ id: `match-height:${heightTarget.h}`, axis: 'y', position: heightTarget.maxY,
      start: heightTarget.minX - 20, end: heightTarget.maxX + 20, kind: 'edge' });
    this.guides.value = guides;
    return { width: nextWidth, height: nextHeight, guides };
  }
}
