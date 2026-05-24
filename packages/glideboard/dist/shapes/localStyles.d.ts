import { type FillStyle, type Font, type FontSize, type StrokeStyle, type TextAlign, type SizeStyle } from '@durgakiran/glideline';
export declare const StyleValidators: {
    fillStyle: {
        validate(value: unknown): FillStyle;
    };
    strokeStyle: {
        validate(value: unknown): StrokeStyle;
    };
    strokeWidth: {
        validate(value: unknown): SizeStyle;
    };
    fontSize: {
        validate(value: unknown): FontSize;
    };
    textAlign: {
        validate(value: unknown): TextAlign;
    };
    font: {
        validate(value: unknown): Font;
    };
};
export declare function createTextForeignObject(opts: {
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    font: Font | string;
    fontSize: FontSize | number;
    textAlign: TextAlign | string;
    color: string;
    verticalAlign?: 'top' | 'center';
    padding?: number;
}): SVGForeignObjectElement;
