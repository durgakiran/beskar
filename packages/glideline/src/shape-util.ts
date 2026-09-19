import type { BaseRecord } from "./types.js";
import { Box } from "./math.js";

interface LegacyShapeUtil<T extends BaseRecord> {
    getBounds(shape: T): Box;
    render(shape: T): string;
}

export interface BoxRecord extends BaseRecord {
    type: 'box';
    x: number;
    y: number;
    w: number;
    h: number;
    props: {
        fill: string;
        stroke: string;
    }
}

export class BoxShapeUtil implements LegacyShapeUtil<BoxRecord> {
    static type = 'box' as const;
    type = 'box' as const;

    getBounds(shape: BoxRecord): Box {
        return new Box(shape.x, shape.y, shape.w, shape.h);
    }

    render(shape: BoxRecord): string {
        return `<rect 
            x="${shape.x}" 
            y="${shape.y}" 
            width="${shape.w}" 
            height="${shape.h}" 
            fill="${shape.props.fill}" 
            stroke="${shape.props.stroke}" 
        />`;
    }
}

export interface EllipseRecord extends BaseRecord {
    type: 'ellipse';
    x: number;
    y: number;
    w: number;
    h: number;
    props: {
        fill: string;
        stroke: string;
    }
}

export class EllipseShapeUtil implements LegacyShapeUtil<EllipseRecord> {
    static type = 'ellipse' as const;
    type = 'ellipse' as const;

    getBounds(shape: EllipseRecord): Box {
        return new Box(shape.x, shape.y, shape.w, shape.h);
    }

    render(shape: EllipseRecord): string {
        const rx = shape.w / 2;
        const ry = shape.h / 2;
        const cx = shape.x + rx;
        const cy = shape.y + ry;
        return `<ellipse 
            cx="${cx}" 
            cy="${cy}" 
            rx="${rx}" 
            ry="${ry}" 
            fill="${shape.props.fill}" 
            stroke="${shape.props.stroke}" 
        />`;
    }
}
