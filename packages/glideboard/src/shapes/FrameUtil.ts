import {
  ShapeUtil,
  T,
  defineMigrations,
  type GlideShape,
} from '@durgakiran/glideline';
import { RectangleGeometry } from './localGeometry';

export interface FrameProps {
  [key: string]: unknown;
  w: number;
  h: number;
  label: string;
  color: string;
}

export type FrameShape = GlideShape<FrameProps>;

export class FrameUtil extends ShapeUtil<FrameShape> {
  static override readonly type = 'frame';

  static override readonly props = {
    w: T.number,
    h: T.number,
    label: T.string,
    color: T.string,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 1,
    migrators: {
      1: {
        up: record => ({ ...record, props: { label: 'Frame', color: '#313244', ...(record['props'] as object) } }),
        down: record => record,
      },
    },
  });

  getDefaultProps(): FrameProps {
    return { w: 400, h: 300, label: 'Frame', color: '#313244' };
  }

  getGeometry(shape: FrameShape) {
    return new RectangleGeometry(0, 0, shape.props.w, shape.props.h);
  }

  override canContain(): boolean {
    return true;
  }

  toSvg(shape: FrameShape): SVGElement {
    const { props } = shape;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(props.w));
    rect.setAttribute('height', String(props.h));
    rect.setAttribute('fill', `${props.color}22`);
    rect.setAttribute('stroke', props.color);
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('stroke-dasharray', '8 4');
    rect.setAttribute('rx', '4');
    g.appendChild(rect);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', '8');
    label.setAttribute('y', '-6');
    label.setAttribute('font-size', '13');
    label.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    label.setAttribute('fill', props.color);
    label.textContent = props.label;
    g.appendChild(label);

    return g;
  }
}
