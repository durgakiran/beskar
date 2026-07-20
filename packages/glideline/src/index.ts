/**
 * Glideline — Public API surface (Phase 1–5 + Phase A)
 */

// Types
export type {
  ShapeId, BindingId, PageId, AssetId,
  GlideShape, GlideBinding, GlidePage, GlideAsset, BaseRecord, AnyRecord, DeepReadonly,
  KnownRecordKind, RecordKind,
  RecordReferenceDescriptor,
  Box2d, Vec2, EdgeName,
  GlideDocument,
  Validator, GlideProps,
  GlideMigrations, GlideMigrator,
} from './types';
export { sid, bid, pid, aid, makeBox, isGlideBinding, isGlideShape } from './types';
export { RecordIdService } from './id';
export type { IdTokenFactory } from './id';

// Validators
export { T } from './validators';

// Migrations
export { defineMigrations, migrateRecord, migrateRecordDown } from './migrations';

// Schema
export {
  GlideSchema, DocumentValidationError, CURRENT_STORE_VERSION, DEFAULT_DOCUMENT_LIMITS,
} from './schema';
export type { DocumentLimits, LoadReport, LoadedDocument } from './schema';

// Store
export {
  GlideStore, AsyncTransactionError, TransactionAbortedError, TransactionReentryError,
  StoreFatalIntegrityError,
} from './store';
export type {
  ChangeOrigin, JsonPointer, StoreRecord, RecordDelta, StoreChangeSet, TransactionScope,
  TransactionOptions, StoreTransaction, TransactionResult, StoreChangeListener,
  StoreCommitPreparation, StoreCommitParticipant,
  ReplaceDocumentOptions, ImportOptions, ImportReport,
  IntegrityIssue, IntegrityReport, ReadonlyGlideStore,
} from './store';

// Shapes (base)
export { ShapeUtil, BindingUtil } from './shapes/ShapeUtil';
export { BoxUtil } from './shapes/BoxUtil';
export { FrameUtil } from './shapes/FrameUtil';
export { TextUtil } from './shapes/TextUtil';

// Phase 3 — State machine + history + tools
export { StateNode } from './state-node';
export type { GlideEvent, PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent, DoubleClickEvent } from './state-node';
export { HistoryManager, HistoryConflictError, commandIdFromLabel } from './history';
export type {
  HistoryEntry, HistoryDelta, FieldPrecondition, HistoryConflict, HistoryResult,
  BatchOptions, InteractionPreviewAdapter, ReadonlyHistoryManager,
} from './history';
export { InteractionManager, InteractionConflictError } from './interaction';
export type { InteractionConflict, InteractionCommitOptions } from './interaction';
export { SelectTool } from './tools/SelectTool';
export { BoxTool } from './tools/BoxTool';

// Editor
export { GlideEditor, createEditor } from './editor';
export type {
  GlidePlugin, CreateEditorOptions, ClipboardSchemaHeader, ClipboardPayload,
  EditorCommand, ExecuteCommandOptions,
} from './editor';

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
  createDiagramInputSchema,
  layoutShapesInputSchema,
  getCanvasImageInputSchema,
} from './mcp';
export type { CanvasToolName, CanvasToolResult, CanvasToolError, CanvasToolManifestEntry } from './mcp';

// Phase A — Style system
export {
  TLDRAW_COLORS, resolveColor, hexWithOpacity, svgFill,
  STROKE_WIDTHS, FONT_SIZES, FONT_FAMILIES,
  STROKE_DASH_ARRAYS, FILL_OPACITIES,
  inlinePatternDefs, getPatternId, getShapePatternId,
  createTextForeignObjectForExport,
} from './styles';
export type {
  TldrawColor,
  FillStyle, StrokeStyle, SizeStyle, FontSize, TextAlign, Font,
  ShapeStyleProps, LabelProps,
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
export {
  TriangleTool, DiamondTool, HexagonTool, StarTool,
  RoundedRectTool, ParallelogramTool, ChevronTool,
  DocumentTool, CylinderTool, NoteTool, CalloutTool,
} from './tools/GeoShapeTools';

// Phase C — Additional geo shapes
export {
  TriangleUtil, DiamondUtil, HexagonUtil, StarUtil, GeoShapePlugin,
  RoundedRectUtil, ParallelogramUtil, ChevronUtil,
  DocumentUtil, CylinderUtil, NoteUtil, CalloutUtil,
  P1ShapesPlugin,
} from './shapes/GeoShapeUtil';
export type {
  GeoShapeProps, TriangleShape, DiamondShape, HexagonShape, StarShape,
  RoundedRectShape, ParallelogramShape, ChevronShape,
  DocumentShape, CylinderShape, NoteShape, CalloutShape,
} from './shapes/GeoShapeUtil';

// Phase B — SelectTool extensions (resize + rotation types)
export type { ResizeHandle, ResizeInfo } from './shapes/ShapeUtil';
export type { RotationInfo } from './tools/SelectTool';

export { createSvgPathShape } from './shapes/createSvgPathShape';
export type { CreateSvgPathShapeDef } from './shapes/createSvgPathShape';

export { MutationPermissionError, allowAllMutations, createMutationCapability } from './mutation-policy';
export type {
  MutationOrigin,
  MutationRequest,
  MutationPolicy,
  MutationCapability,
  MutationCapabilityGrant,
} from './mutation-policy';
