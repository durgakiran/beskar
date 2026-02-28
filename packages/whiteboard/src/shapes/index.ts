export { CylinderShapeUtil } from './CylinderShapeUtil';
export type { CylinderShape } from './CylinderShapeUtil';

export { ParallelogramShapeUtil } from './ParallelogramShapeUtil';
export type { ParallelogramShape } from './ParallelogramShapeUtil';

import { CylinderShapeUtil } from './CylinderShapeUtil';
import { ParallelogramShapeUtil } from './ParallelogramShapeUtil';

/** All custom shape utils — pass to `<Tldraw shapeUtils={customShapeUtils}>` */
export const customShapeUtils = [CylinderShapeUtil, ParallelogramShapeUtil] as const;
