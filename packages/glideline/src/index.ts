/**
 * Glideline — Public API surface (Phase 1–5 + Phase A)
 */

// Types
export type {
  ShapeId, BindingId, PageId,
  GlideShape, GlideBinding, BaseRecord, AnyRecord,
  Box2d, Vec2, EdgeName,
  GlideDocument,
  Validator, GlideProps,
  GlideMigrations, GlideMigrator,
} from './types';
export { sid, bid, pid, makeBox, isGlideBinding } from './types';

// Validators
export { T } from './validators';

// Migrations
export { defineMigrations, migrateRecord, migrateRecordDown } from './migrations';

// Schema
export { GlideSchema, CURRENT_STORE_VERSION } from './schema';

// Store
export { GlideStore } from './store';

// Shapes (base)
export { ShapeUtil, BindingUtil } from './shapes/ShapeUtil';

// Phase 3 — State machine + history + tools
export { StateNode } from './state-node';
export type { GlideEvent, PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent, DoubleClickEvent } from './state-node';
export { HistoryManager } from './history';
export type { HistoryEntry, BatchOptions } from './history';
export { SelectTool } from './tools/SelectTool';
export { BoxTool } from './tools/BoxTool';

// Editor
export { GlideEditor, createEditor } from './editor';
export type { GlidePlugin, CreateEditorOptions } from './editor';

// Phase 4 — Bindings & Arrow Routing
export { computeArcPath, parseArcControlPoint } from './arc-router';
export { computeElbowPath, parseElbowPoints, countElbowSegments } from './elbow-router';
export {
  buildArrowShapeRecord,
  buildArrowBindingRecord,
  resolveConnectionTerminal,
  createCanvasShapeId,
  createTopIndex,
} from './arrow-records';
export { resolveArrowRoute, getArrowBendHandlePoint, pointsToPath, sampleCurvePoints } from './arrow-routing';
export {
  ArrowUtil, ArrowBindingUtil, ArrowPlugin,
  anchorToEdge, anchorToPoint,
} from './shapes/ArrowUtil';
export type { ArrowProps, ArrowShape, ArrowTerminal, ArrowBindingProps, ArrowBinding, ArrowRouteStyle } from './shapes/ArrowUtil';
export { ArrowTool, ArrowIdle } from './tools/ArrowTool';
export {
  SmartRouterCache,
  getWorldBounds,
  getArrowBindingEdge,
  getFallbackElbowPoints,
  computeFallbackLocalElbowPoints,
  offsetOrthogonalPolyline,
  routeSignature,
  simplifyCollinear,
} from './smart-router';
export type { SmartRoutingSnapshot, SmartRouteResolution } from './smart-router';

// Phase 6 / Infinity — AI + MCP
export { buildAIContext } from './ai-context';
export type { AIShapeContext, AIConnectionContext, AIContextSnapshot } from './ai-context';
export {
  createCanvasToolServer,
  createShapeInputSchema,
  updateShapeInputSchema,
  deleteShapesInputSchema,
  createConnectionInputSchema,
  getCanvasStateInputSchema,
} from './mcp';
export type { CanvasToolName, CanvasToolResult, CanvasToolError, CanvasToolManifestEntry } from './mcp';

// Phase A — Style system
export {
  TLDRAW_COLORS, resolveColor, hexWithOpacity, svgFill,
  STROKE_WIDTHS, FONT_SIZES, FONT_FAMILIES,
  STROKE_DASH_ARRAYS, FILL_OPACITIES,
} from './styles';
export type {
  TldrawColor,
  FillStyle, StrokeStyle, SizeStyle, FontSize, TextAlign, Font,
  ShapeStyleProps,
} from './styles';

// Phase A — Ellipse shape
export { EllipseUtil, EllipsePlugin } from './shapes/EllipseUtil';
export type { EllipseProps, EllipseShape } from './shapes/EllipseUtil';

// Phase A — Sticky note shape
export {
  StickyNoteUtil, StickyNotePlugin,
  STICKY_COLORS, wrapText,
} from './shapes/StickyNoteUtil';
export type { StickyNoteProps, StickyNoteShape } from './shapes/StickyNoteUtil';

// Phase A — Freehand shape
export {
  FreehandUtil, FreehandPlugin,
  catmullRomPath,
} from './shapes/FreehandUtil';
export type { FreehandProps, FreehandShape, FreehandPoint } from './shapes/FreehandUtil';

// Phase B — New tools
export { HandTool } from './tools/HandTool';
export { EllipseTool } from './tools/EllipseTool';
export { TextTool } from './tools/TextTool';
export { StickyNoteTool } from './tools/StickyNoteTool';
export { DrawTool } from './tools/DrawTool';
export { EraserTool } from './tools/EraserTool';
export { TriangleTool, DiamondTool, HexagonTool, StarTool } from './tools/GeoShapeTools';

// Phase C — Additional geo shapes
export {
  TriangleUtil, DiamondUtil, HexagonUtil, StarUtil, GeoShapePlugin,
} from './shapes/GeoShapeUtil';
export type {
  GeoShapeProps, TriangleShape, DiamondShape, HexagonShape, StarShape,
} from './shapes/GeoShapeUtil';

// Phase B — SelectTool extensions (resize + rotation types)
export type { ResizeHandle, ResizeInfo, RotationInfo } from './tools/SelectTool';
