import { ShapeUtil } from './ShapeUtil.js';
import { StateNode } from '../state-node.js';
import type {
  PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent,
} from '../state-node.js';
import type { GlideShape, ShapeId, Vec2 } from '../types.js';
import { T } from '../validators.js';
import { defineMigrations } from '../migrations.js';
import {
  StyleValidators, STROKE_WIDTHS, STROKE_DASH_ARRAYS,
  svgFill, resolveColor, inlinePatternDefs, createTextForeignObjectForExport,
  FONT_FAMILIES, FONT_SIZES,
  type FillStyle, type StrokeStyle, type SizeStyle, type FontSize,
  type TextAlign, type Font, type LabelProps,
} from '../styles.js';
import { Geometry2d, Rectangle2d } from '../geometry/index.js';
import type { GlidePlugin } from '../editor.js';

interface CustomPathProps {
  [key: string]: unknown;
  w: number;
  h: number;
  color: string;
  opacity: number;
  fillStyle: FillStyle;
  strokeStyle: StrokeStyle;
  strokeWidth: SizeStyle;
  label: string;
  labelColor: string;
  font: Font;
  fontSize: FontSize;
  textAlign: TextAlign;
}

type CustomPathShape = GlideShape<CustomPathProps>;

export interface CreateSvgPathShapeDef {
  type: string;
  defaultSize?: { w: number; h: number };
  getPathD: (w: number, h: number) => string;
  defaultColor?: string;
  defaultFillStyle?: FillStyle;
}

export function createSvgPathShape(def: CreateSvgPathShapeDef): {
  util: typeof ShapeUtil;
  tool: typeof StateNode;
  plugin: GlidePlugin;
} {
  const {
    type,
    defaultSize = { w: 120, h: 80 },
    getPathD,
    defaultColor = 'black',
    defaultFillStyle = 'none',
  } = def;

  class CustomUtil extends ShapeUtil<CustomPathShape> {
    static override readonly type = type;
    static override readonly props = {
      w: T.number,
      h: T.number,
      color: T.string,
      opacity: T.number,
      fillStyle: StyleValidators.fillStyle,
      strokeStyle: StyleValidators.strokeStyle,
      strokeWidth: StyleValidators.strokeWidth,
      label: T.string,
      labelColor: T.string,
      font: StyleValidators.font,
      fontSize: StyleValidators.fontSize,
      textAlign: StyleValidators.textAlign,
    };
    static override readonly migrations = defineMigrations({
      currentVersion: 1,
      migrators: {
        1: {
          up: r => ({
            ...r,
            props: {
              w: defaultSize.w, h: defaultSize.h,
              color: defaultColor, opacity: 1,
              fillStyle: defaultFillStyle, strokeStyle: 'solid', strokeWidth: 'medium',
              label: '', labelColor: 'black',
              font: 'sans', fontSize: 'md', textAlign: 'center',
              ...(r['props'] as object),
            },
          }),
          down: r => r,
        },
      },
    });

    getDefaultProps(): CustomPathProps {
      return {
        w: defaultSize.w, h: defaultSize.h,
        color: defaultColor, opacity: 1,
        fillStyle: defaultFillStyle, strokeStyle: 'solid', strokeWidth: 'medium',
        label: '', labelColor: 'black',
        font: 'sans', fontSize: 'md', textAlign: 'center',
      };
    }

    getGeometry(shape: CustomPathShape): Geometry2d {
      return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
    }

    toSvg(shape: CustomPathShape): SVGElement {
      const { props } = shape;
      const strokeW = STROKE_WIDTHS[props.strokeWidth];
      const fillColor = svgFill(props.fillStyle, resolveColor(props.color), shape.id);
      const strokeColor = resolveColor(props.color);
      const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));
      const defs = inlinePatternDefs(props.fillStyle, props.color, shape.id);
      if (defs) g.appendChild(defs);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', getPathD(props.w, props.h));
      path.setAttribute('fill', fillColor);
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', String(strokeW));
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('stroke-linecap', 'round');
      if (dashArray !== 'none') path.setAttribute('stroke-dasharray', dashArray);
      g.appendChild(path);
      return g;
    }

    override getLabelProps(shape: CustomPathShape): LabelProps | null {
      const { props } = shape;
      return {
        text: props.label || '',
        fontFamily: FONT_FAMILIES[props.font] ?? FONT_FAMILIES.sans,
        fontSize: FONT_SIZES[props.fontSize] ?? FONT_SIZES.md,
        color: resolveColor(props.labelColor),
        textAlign: props.textAlign,
        verticalAlign: 'center',
        padding: 8,
      };
    }

    override toSvgExport(shape: CustomPathShape): SVGElement {
      const g = this.toSvg(shape) as SVGGElement;
      const { props } = shape;
      if (props.label) {
        g.appendChild(createTextForeignObjectForExport({
          x: 0, y: 0, w: props.w, h: props.h,
          text: props.label, font: props.font, fontSize: props.fontSize,
          textAlign: props.textAlign, color: props.labelColor, verticalAlign: 'center',
        }));
      }
      return g;
    }
  }

  const DRAG_THRESHOLD = 4;
  const distPt = (a: Vec2, b: Vec2) => Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);

  class Idle extends StateNode {
    static override readonly id = 'idle';
    override onPointerDown(e: PointerDownEvent): void {
      this.parent!.transition('pointing', e);
    }
  }

  class Pointing extends StateNode {
    static override readonly id = 'pointing';
    private _origin!: Vec2;
    override onEnter(info: PointerDownEvent): void { this._origin = info.point; }
    override onPointerMove(e: PointerMoveEvent): void {
      if (distPt(this._origin, e.point) > DRAG_THRESHOLD) {
        this.parent!.transition('drawing', { origin: this._origin, current: e.point });
      }
    }
    override onPointerUp(): void { this.parent!.transition('idle'); }
  }

  // The in-progress shape is staged under its real, final shape id via
  // beginHistoryPreview()/recordHistoryPreview() — the same InteractionManager
  // preview lifecycle SelectTool uses for drag/resize/rotate — so there's no
  // delete-then-recreate step between the live preview and the committed
  // shape. pointerCancel (a browser/OS-initiated abort, e.g. trackpad
  // gesture disambiguation on a fast short drag) commits the shape exactly
  // as it was last staged rather than losing it; Escape still discards it.
  class Drawing extends StateNode {
    static override readonly id = 'drawing';
    private _origin!: Vec2;
    private _id!: ShapeId;

    override onEnter(info: { origin: Vec2; current: Vec2 }): void {
      this._origin = info.origin;
      this._id = this.editor.createShapeId(type);
      const w = info.current.x - info.origin.x;
      const h = info.current.y - info.origin.y;

      this.editor.beginHistoryPreview();
      this.editor.batch('Custom Shape Preview', () => {
        this.editor.createShape({
          id: this._id, type,
          x: Math.min(info.origin.x, info.origin.x + w),
          y: Math.min(info.origin.y, info.origin.y + h),
          rotation: 0, meta: {},
          props: { ...(new CustomUtil()).getDefaultProps(), w: Math.max(1, Math.abs(w)), h: Math.max(1, Math.abs(h)) },
        });
      }, { history: 'ignore' });
    }

    override onPointerMove(e: PointerMoveEvent): void {
      this._updateShape(e.point);
    }

    override onPointerUp(e: PointerUpEvent): void {
      this._updateShape(e.point);
      this._commit();
    }

    override onPointerCancel(): void {
      // No reliable point on a browser/OS-initiated cancel — commit the
      // shape exactly as it was last staged rather than losing it.
      this._commit();
    }

    override onKeyDown(e: KeyDownEvent): void {
      if (e.key === 'Escape') {
        this.editor.cancelHistoryPreview();
        this.parent!.transition('idle');
      }
    }

    override onExit(): void {
      // Safety net: if the tool is switched away mid-drag without a
      // pointerUp/pointerCancel/Escape, make sure no staged preview lingers.
      this.editor.cancelHistoryPreview();
    }

    private _updateShape(point: Vec2): void {
      const w = point.x - this._origin.x;
      const h = point.y - this._origin.y;
      this.editor.batch('Custom Shape Preview Update', () => {
        this.editor.updateShape(this._id, {
          x: Math.min(this._origin.x, this._origin.x + w),
          y: Math.min(this._origin.y, this._origin.y + h),
          props: { w: Math.max(1, Math.abs(w)), h: Math.max(1, Math.abs(h)) },
        });
      }, { history: 'ignore' });
    }

    private _commit(): void {
      // Promote the staged record into the real store as a single atomic,
      // history-recorded transaction under its original id.
      this.editor.recordHistoryPreview(`Create ${type}`, new Map([[this._id, null]]));
      this.editor.setCurrentTool('select');
      this.editor.setSelectedShapeIds([this._id]);
      this.parent!.transition('idle');
    }
  }

  class CustomTool extends StateNode {
    static override readonly id = type;
    static override children = () => [Idle, Pointing, Drawing];
  }

  const plugin: GlidePlugin = {
    id: `custom-shape-${type}`,
    shapes: [CustomUtil as any],
    tools: [CustomTool],
  };

  return { util: CustomUtil as any, tool: CustomTool as any, plugin };
}
