import { ShapeUtil, type GlideShape, type ResizeInfo } from '@durgakiran/glideline';
import { RectangleGeometry } from './localGeometry';
export interface TextProps {
    [key: string]: unknown;
    text: string;
    fontSize: number;
    color: string;
}
export type TextShape = GlideShape<TextProps>;
export declare class TextUtil extends ShapeUtil<TextShape> {
    static readonly type = "text";
    static readonly props: {
        text: import("@durgakiran/glideline").Validator<string>;
        fontSize: import("@durgakiran/glideline").Validator<number>;
        color: import("@durgakiran/glideline").Validator<string>;
    };
    static readonly migrations: import("@durgakiran/glideline").GlideMigrations;
    getDefaultProps(): TextProps;
    getGeometry(shape: TextShape): RectangleGeometry;
    onResize(shape: TextShape, info: ResizeInfo<TextShape>): Partial<TextShape>;
    toSvg(shape: TextShape): SVGElement;
}
