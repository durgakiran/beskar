import { ShapeUtil, type FillStyle, type StrokeStyle, type SizeStyle, type FontSize, type TextAlign, type Font, type GlideShape } from '@durgakiran/glideline';
import { RectangleGeometry } from './localGeometry';
export interface BoxProps {
    [key: string]: unknown;
    w: number;
    h: number;
    cornerRadius: number;
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
export type BoxShape = GlideShape<BoxProps>;
export declare class BoxUtil extends ShapeUtil<BoxShape> {
    static readonly type = "box";
    static readonly props: {
        w: import("@durgakiran/glideline").Validator<number>;
        h: import("@durgakiran/glideline").Validator<number>;
        cornerRadius: import("@durgakiran/glideline").Validator<number>;
        color: import("@durgakiran/glideline").Validator<string>;
        opacity: import("@durgakiran/glideline").Validator<number>;
        fillStyle: {
            validate(value: unknown): FillStyle;
        };
        strokeStyle: {
            validate(value: unknown): StrokeStyle;
        };
        strokeWidth: {
            validate(value: unknown): SizeStyle;
        };
        label: import("@durgakiran/glideline").Validator<string>;
        labelColor: import("@durgakiran/glideline").Validator<string>;
        font: {
            validate(value: unknown): Font;
        };
        fontSize: {
            validate(value: unknown): FontSize;
        };
        textAlign: {
            validate(value: unknown): TextAlign;
        };
    };
    static readonly migrations: import("@durgakiran/glideline").GlideMigrations;
    getDefaultProps(): BoxProps;
    getGeometry(shape: BoxShape): RectangleGeometry;
    toSvg(shape: BoxShape): SVGElement;
}
