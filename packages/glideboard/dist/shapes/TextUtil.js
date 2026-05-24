import { ShapeUtil, T, defineMigrations, } from '@durgakiran/glideline';
import { RectangleGeometry } from './localGeometry';
import { createTextForeignObject } from './localStyles';
let measurementContext = null;
function getMeasurementContext() {
    if (typeof document === 'undefined')
        return null;
    if (!measurementContext) {
        const canvas = document.createElement('canvas');
        measurementContext = canvas.getContext('2d');
    }
    return measurementContext;
}
function estimateBounds(text, fontSize) {
    const lines = text.split('\n');
    const h = lines.length * fontSize * 1.4;
    const ctx = getMeasurementContext();
    if (!ctx) {
        const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
        return { w: Math.max(longestLine * fontSize * 0.6, fontSize * 0.6), h };
    }
    ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
    let maxW = fontSize * 0.6;
    for (const line of lines) {
        const metrics = ctx.measureText(line);
        if (metrics.width > maxW)
            maxW = metrics.width;
    }
    return { w: maxW, h };
}
export class TextUtil extends ShapeUtil {
    getDefaultProps() {
        return { text: '', fontSize: 16, color: '#cdd6f4' };
    }
    getGeometry(shape) {
        const { w, h } = estimateBounds(shape.props.text, shape.props.fontSize);
        return new RectangleGeometry(0, 0, shape.props.w ?? w, h);
    }
    onResize(shape, info) {
        const base = super.onResize(shape, info);
        if (base.props) {
            delete base.props.h;
        }
        return base;
    }
    toSvg(shape) {
        const bounds = this.getGeometry(shape).getBounds();
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.appendChild(createTextForeignObject({
            x: 0,
            y: 0,
            w: bounds.w,
            h: bounds.h,
            text: shape.props.text,
            font: 'Inter, system-ui, sans-serif',
            fontSize: shape.props.fontSize,
            textAlign: 'left',
            color: shape.props.color,
            verticalAlign: 'top',
        }));
        return g;
    }
}
TextUtil.type = 'text';
TextUtil.props = {
    text: T.string,
    fontSize: T.number,
    color: T.string,
};
TextUtil.migrations = defineMigrations({
    currentVersion: 1,
    migrators: {
        1: {
            up: record => ({ ...record, props: { fontSize: 16, color: '#cdd6f4', ...record['props'] } }),
            down: record => record,
        },
    },
});
//# sourceMappingURL=TextUtil.js.map