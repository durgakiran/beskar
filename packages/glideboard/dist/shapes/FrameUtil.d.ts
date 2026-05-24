import { ShapeUtil, type GlideShape } from '@durgakiran/glideline';
import { RectangleGeometry } from './localGeometry';
export interface FrameProps {
    [key: string]: unknown;
    w: number;
    h: number;
    label: string;
    color: string;
}
export type FrameShape = GlideShape<FrameProps>;
export declare class FrameUtil extends ShapeUtil<FrameShape> {
    static readonly type = "frame";
    static readonly props: {
        w: import("@durgakiran/glideline").Validator<number>;
        h: import("@durgakiran/glideline").Validator<number>;
        label: import("@durgakiran/glideline").Validator<string>;
        color: import("@durgakiran/glideline").Validator<string>;
    };
    static readonly migrations: import("@durgakiran/glideline").GlideMigrations;
    getDefaultProps(): FrameProps;
    getGeometry(shape: FrameShape): RectangleGeometry;
    canContain(): boolean;
    toSvg(shape: FrameShape): SVGElement;
}
