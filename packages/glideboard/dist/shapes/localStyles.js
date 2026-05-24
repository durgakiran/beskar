import { FONT_FAMILIES, FONT_SIZES, resolveColor, } from '@durgakiran/glideline';
export const StyleValidators = {
    fillStyle: {
        validate(value) {
            if (!['none', 'semi', 'solid', 'pattern'].includes(value)) {
                throw new Error(`fillStyle must be none|semi|solid|pattern, got "${value}"`);
            }
            return value;
        },
    },
    strokeStyle: {
        validate(value) {
            if (!['solid', 'dashed', 'dotted'].includes(value)) {
                throw new Error(`strokeStyle must be solid|dashed|dotted, got "${value}"`);
            }
            return value;
        },
    },
    strokeWidth: {
        validate(value) {
            if (!['thin', 'medium', 'thick', 'xl'].includes(value)) {
                throw new Error(`strokeWidth must be thin|medium|thick|xl, got "${value}"`);
            }
            return value;
        },
    },
    fontSize: {
        validate(value) {
            if (!['sm', 'md', 'lg', 'xl'].includes(value)) {
                throw new Error(`fontSize must be sm|md|lg|xl, got "${value}"`);
            }
            return value;
        },
    },
    textAlign: {
        validate(value) {
            if (!['left', 'center', 'right'].includes(value)) {
                throw new Error(`textAlign must be left|center|right, got "${value}"`);
            }
            return value;
        },
    },
    font: {
        validate(value) {
            if (!['draw', 'sans', 'serif', 'mono'].includes(value)) {
                throw new Error(`font must be draw|sans|serif|mono, got "${value}"`);
            }
            return value;
        },
    },
};
export function createTextForeignObject(opts) {
    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('x', String(opts.x));
    fo.setAttribute('y', String(opts.y));
    fo.setAttribute('width', String(opts.w));
    fo.setAttribute('height', String(opts.h));
    fo.setAttribute('pointer-events', 'none');
    const div = document.createElement('div');
    div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    div.style.width = '100%';
    div.style.height = '100%';
    div.style.display = 'flex';
    div.style.alignItems = opts.verticalAlign === 'top' ? 'flex-start' : 'center';
    div.style.justifyContent =
        opts.textAlign === 'left'
            ? 'flex-start'
            : opts.textAlign === 'right'
                ? 'flex-end'
                : 'center';
    div.style.fontSize =
        typeof opts.fontSize === 'number'
            ? `${opts.fontSize}px`
            : `${FONT_SIZES[opts.fontSize]}px`;
    div.style.fontFamily = FONT_FAMILIES[opts.font] || String(opts.font);
    div.style.color = resolveColor(opts.color) ?? opts.color;
    div.style.textAlign = String(opts.textAlign);
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordBreak = 'break-word';
    div.style.lineHeight = 'normal';
    div.style.margin = '0';
    div.style.padding = opts.padding ? `${opts.padding}px` : '0';
    div.style.boxSizing = 'border-box';
    div.textContent = opts.text;
    fo.appendChild(div);
    return fo;
}
//# sourceMappingURL=localStyles.js.map