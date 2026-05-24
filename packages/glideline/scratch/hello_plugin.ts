import { createEditor, type GlidePlugin } from "../src/editor";
import { ShapeUtil } from "../src/shapes/ShapeUtil";
import { Ellipse2d } from "../src/geometry";
import { T } from "../src/validators";
import { sid } from "../src/types";
import type { GlideShape } from "../src/types";

interface CircleProps {
    [key: string]: unknown;
    radius: number;
    fill: string;
    stroke: string;
}

type CircleShape = GlideShape<CircleProps>;

export class CircleUtil extends ShapeUtil<CircleShape> {
    static override readonly type = "circle";
    static override readonly props = {
        radius: T.number,
        fill: T.string,
        stroke: T.string,
    };

    getDefaultProps(): CircleProps {
        return {
            radius: 40,
            fill: "#60a5fa",
            stroke: "#1d4ed8",
        };
    }

    getGeometry(shape: CircleShape) {
        const { radius } = shape.props;
        return new Ellipse2d(radius, radius, radius, radius);
    }

    toSvg(shape: CircleShape): SVGElement {
        const { radius, fill, stroke } = shape.props;
        const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el.setAttribute("cx", String(radius));
        el.setAttribute("cy", String(radius));
        el.setAttribute("r", String(radius));
        el.setAttribute("fill", fill);
        el.setAttribute("stroke", stroke);
        return el;
    }
}

export const CirclePlugin: GlidePlugin = {
    id: "hello/circle",
    shapes: [CircleUtil as any],
};

export function makeCircle(id: string, x: number, y: number, props: Partial<CircleProps> = {}): CircleShape {
    const defaults = new CircleUtil().getDefaultProps();
    return {
        id: sid(id),
        type: "circle",
        x,
        y,
        index: "a1",
        rotation: 0,
        props: { ...defaults, ...props },
        meta: {},
    };
}

const editor = createEditor({ plugins: [CirclePlugin] });
const circle = makeCircle("shape:hello-circle", 120, 80);
const bounds = editor.getShapeUtil(circle).getGeometry(circle).getBounds();

console.log("Registered plugin:", CirclePlugin.id);
console.log("Resolved util:", editor.getShapeUtil("circle").constructor.name);
console.log("Sample circle bounds:", bounds);
