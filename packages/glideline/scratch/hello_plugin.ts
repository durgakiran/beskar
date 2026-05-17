
import { ShapeUtil, GlideRecord } from "../src/types";

// Hello World Plugin: Circle Shape
export interface CircleRecord extends GlideRecord {
    type: 'circle';
    x: number;
    y: number;
    radius: number;
}

export const CircleUtil: ShapeUtil<CircleRecord> = {
    type: 'circle',
    getBounds(shape) {
        return {
            x: shape.x - shape.radius,
            y: shape.y - shape.radius,
            w: shape.radius * 2,
            h: shape.radius * 2
        };
    },
    render(shape) {
        return `<circle cx="${shape.x}" cy="${shape.y}" r="${shape.radius}" />`;
    }
};

console.log("Plugin defined in 18 lines.");
