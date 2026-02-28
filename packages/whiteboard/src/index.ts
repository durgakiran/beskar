// Main component
export { Whiteboard } from './components/Whiteboard';
export type { WhiteboardProps } from './types';

// Custom shape utils (exported so consumers can extend or inspect)
export { CylinderShapeUtil, ParallelogramShapeUtil, customShapeUtils } from './shapes';
export type { CylinderShape, ParallelogramShape } from './shapes';

// Collaboration stub (yjs wiring — future)
export type { CollaborationConfig } from './collaboration';

// WebRTC Collaboration Store
export { useYjsStore } from './hooks/useYjsStore';
