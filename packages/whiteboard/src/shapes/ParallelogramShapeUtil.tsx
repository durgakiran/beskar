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
    Polygon2d,
    Vec,
    type IndexKey,
} from 'tldraw';

export type ParallelogramShape = TLBaseShape<
    'parallelogram',
    {
        w: number;
        h: number;
        color: string;
        fill: string;
        dash: string;
        size: string;
        /** Horizontal skew offset in px (positive = right-leaning) */
        skew: number;
    }
>;

/** Tldraw custom shape util for a parallelogram (data / I/O symbol). */
export class ParallelogramShapeUtil extends BaseBoxShapeUtil<ParallelogramShape> {
    static override type = 'parallelogram' as const;

    static override props: RecordProps<ParallelogramShape> = {
        w: T.positiveNumber,
        h: T.positiveNumber,
        color: DefaultColorStyle,
        fill: DefaultFillStyle,
        dash: DefaultDashStyle,
        size: DefaultSizeStyle,
        skew: T.number,
    };

    override getDefaultProps(): ParallelogramShape['props'] {
        return {
            w: 140,
            h: 80,
            color: 'black',
            fill: 'semi',
            dash: 'draw',
            size: 'm',
            skew: 20,
        };
    }

    override getGeometry(shape: ParallelogramShape) {
        const { w, h, skew } = shape.props;
        return new Polygon2d({
            points: [
                new Vec(skew, 0),
                new Vec(w, 0),
                new Vec(w - skew, h),
                new Vec(0, h),
            ],
            isFilled: true,
        });
    }

    override getHandles(shape: ParallelogramShape) {
        const { w, h, skew } = shape.props;
        return [
            { id: 'top', type: 'vertex' as const, x: (skew + w) / 2, y: 0, index: 'a1' as IndexKey },
            { id: 'bottom', type: 'vertex' as const, x: (w - skew) / 2, y: h, index: 'a2' as IndexKey },
            { id: 'left', type: 'vertex' as const, x: skew / 2, y: h / 2, index: 'a3' as IndexKey },
            { id: 'right', type: 'vertex' as const, x: (w + w - skew) / 2, y: h / 2, index: 'a4' as IndexKey },
        ];
    }

    override component(shape: ParallelogramShape) {
        const { w, h, skew } = shape.props;
        // Points: top-left, top-right, bottom-right, bottom-left (parallelogram skewed right)
        const points = `${skew},0 ${w},0 ${w - skew},${h} 0,${h}`;

        return (
            <HTMLContainer style={{ overflow: 'hidden', width: w, height: h }}>
                <svg
                    width={w}
                    height={h}
                    viewBox={`0 0 ${w} ${h}`}
                    style={{ display: 'block' }}
                >
                    <polygon
                        points={points}
                        fill="var(--tl-shape-fill, #e8eaf6)"
                        stroke="var(--tl-shape-stroke, #3f51b5)"
                        strokeWidth={1.5}
                        strokeLinejoin="round"
                    />
                </svg>
            </HTMLContainer>
        );
    }

    override indicator(shape: ParallelogramShape) {
        const { w, h, skew } = shape.props;
        const points = `${skew},0 ${w},0 ${w - skew},${h} 0,${h}`;
        return <polygon points={points} />;
    }
}
