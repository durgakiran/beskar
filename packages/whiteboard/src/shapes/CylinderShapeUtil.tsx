import React from 'react';
import {
    BaseBoxShapeUtil,
    HTMLContainer,
    type TLBaseShape,
    type RecordProps,
    DefaultColorStyle,
    DefaultFillStyle,
    DefaultSizeStyle,
    DefaultDashStyle,
    T,
    Rectangle2d,
    type IndexKey,
} from 'tldraw';

export type CylinderShape = TLBaseShape<
    'cylinder',
    {
        w: number;
        h: number;
        color: string;
        fill: string;
        dash: string;
        size: string;
    }
>;

/** Tldraw custom shape util for a cylinder (database symbol). */
export class CylinderShapeUtil extends BaseBoxShapeUtil<CylinderShape> {
    static override type = 'cylinder' as const;

    static override props: RecordProps<CylinderShape> = {
        w: T.positiveNumber,
        h: T.positiveNumber,
        color: DefaultColorStyle,
        fill: DefaultFillStyle,
        dash: DefaultDashStyle,
        size: DefaultSizeStyle,
    };

    override getDefaultProps(): CylinderShape['props'] {
        return {
            w: 120,
            h: 160,
            color: 'black',
            fill: 'semi',
            dash: 'draw',
            size: 'm',
        };
    }

    override getGeometry(shape: CylinderShape) {
        const { w, h } = shape.props;
        return new Rectangle2d({
            width: w,
            height: h,
            isFilled: true,
        });
    }

    override getHandles(shape: CylinderShape) {
        const { w, h } = shape.props;
        return [
            { id: 'top', type: 'vertex' as const, x: w / 2, y: 0, index: 'a1' as IndexKey },
            { id: 'bottom', type: 'vertex' as const, x: w / 2, y: h, index: 'a2' as IndexKey },
            { id: 'left', type: 'vertex' as const, x: 0, y: h / 2, index: 'a3' as IndexKey },
            { id: 'right', type: 'vertex' as const, x: w, y: h / 2, index: 'a4' as IndexKey },
        ];
    }

    override component(shape: CylinderShape) {
        const { w, h } = shape.props;
        const rx = w / 2;
        const ry = Math.max(12, h * 0.12); // ellipse cap height

        return (
            <HTMLContainer style={{ overflow: 'hidden', width: w, height: h }}>
                <svg
                    width={w}
                    height={h}
                    viewBox={`0 0 ${w} ${h}`}
                    style={{ display: 'block' }}
                >
                    {/* Body rectangle */}
                    <rect
                        x={0}
                        y={ry}
                        width={w}
                        height={h - ry * 2}
                        fill="var(--tl-shape-fill, #e8eaf6)"
                        stroke="var(--tl-shape-stroke, #3f51b5)"
                        strokeWidth={1.5}
                    />
                    {/* Bottom cap (ellipse) */}
                    <ellipse
                        cx={rx}
                        cy={h - ry}
                        rx={rx}
                        ry={ry}
                        fill="var(--tl-shape-fill, #e8eaf6)"
                        stroke="var(--tl-shape-stroke, #3f51b5)"
                        strokeWidth={1.5}
                    />
                    {/* Top cap (ellipse) */}
                    <ellipse
                        cx={rx}
                        cy={ry}
                        rx={rx}
                        ry={ry}
                        fill="var(--tl-shape-fill-top, #c5cae9)"
                        stroke="var(--tl-shape-stroke, #3f51b5)"
                        strokeWidth={1.5}
                    />
                </svg>
            </HTMLContainer>
        );
    }

    override indicator(shape: CylinderShape) {
        const { w, h } = shape.props;
        return <rect width={w} height={h} />;
    }
}
