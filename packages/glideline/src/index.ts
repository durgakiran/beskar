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
} from './types.js';
export { sid, bid, pid, aid, makeBox, isGlideBinding, isGlideShape } from './types.js';
export { RecordIdService } from './id.js';
export type { IdTokenFactory } from './id.js';

// Canonical transforms and geometry
export {
  TransformService,
  IDENTITY_MATRIX,
  multiplyMatrices,
  translationMatrix,
  rotationMatrix,
  invertMatrix,
  applyMatrixToPoint,
  applyMatrixToVector,
  getMatrixRotation,
  matrixToSvg,
} from './transform.js';
export type { Matrix2d } from './transform.js';

// Validators
export { T } from './validators.js';

// Migrations
export { defineMigrations, migrateRecord, migrateRecordDown } from './migrations.js';

// Schema
export {
  GlideSchema,
  DocumentValidationError,
  CURRENT_STORE_VERSION,
  DEFAULT_DOCUMENT_LIMITS,
  DEFAULT_PAGE_ID,
  DEFAULT_PAGE_INDEX,
  createDefaultPageRecord,
} from './schema.js';
export type { DocumentLimits, LoadReport, LoadedDocument } from './schema.js';

// Canonical parent-scoped shape ordering
export {
  ROOT_ORDER_PARENT,
  OrderKeySpaceExhaustedError,
  isCanonicalOrderKey,
  generateOrderKeysBetween,
  generateRebalancedOrderKeys,
  getShapeOrderParentId,
  compareSiblingOrder,
  getCanonicalShapeIds,
  sortShapesByCanonicalOrder,
} from './ordering.js';

// Store
export {
  GlideStore, AsyncTransactionError, TransactionAbortedError, TransactionReentryError,
  StoreFatalIntegrityError,
} from './store.js';
export type {
  ChangeOrigin, JsonPointer, StoreRecord, RecordDelta, StoreChangeSet, TransactionScope,
  TransactionOptions, StoreTransaction, TransactionResult, StoreChangeListener,
  StoreCommitPreparation, StoreCommitParticipant,
  ReplaceDocumentOptions, ImportOptions, ImportReport,
  IntegrityIssue, IntegrityReport, ReadonlyGlideStore,
} from './store.js';

// Shapes (base)
export { ShapeUtil, BindingUtil } from './shapes/ShapeUtil.js';
export type { RichTextDescriptor, ResizeHandle, ResizeInfo } from './shapes/ShapeUtil.js';
export { BoxUtil } from './shapes/BoxUtil.js';
export { FrameUtil } from './shapes/FrameUtil.js';
export { GroupUtil } from './shapes/GroupUtil.js';
export type { GroupShape } from './shapes/GroupUtil.js';
export { TextUtil } from './shapes/TextUtil.js';
export type { CanvasRichTextSnapshot, TextProps, TextShape, TextSizeMode } from './shapes/TextUtil.js';

// Phase 3 — State machine + history + tools
export { StateNode } from './state-node.js';
export type { GlideEvent, PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent, DoubleClickEvent } from './state-node.js';
export { HistoryManager, HistoryConflictError, commandIdFromLabel } from './history.js';
export type {
  HistoryEntry, HistoryDelta, FieldPrecondition, HistoryConflict, HistoryResult,
  BatchOptions, InteractionPreviewAdapter, ReadonlyHistoryManager,
} from './history.js';
export { InteractionManager, InteractionConflictError } from './interaction.js';
export type { InteractionConflict, InteractionCommitOptions } from './interaction.js';
export { SelectTool } from './tools/SelectTool.js';
export { BoxTool } from './tools/BoxTool.js';
export { FrameTool } from './tools/FrameTool.js';
export { AssetPlacementTool, AssetPlacementPlugin } from './tools/AssetPlacementTool.js';
export type {
  AssetMaterialization,
  AssetMaterializationRequest,
  AssetMaterializer,
  AssetPlacementCallbacks,
  AssetPlacementSelection,
  RetainedAssetProvenance,
} from './tools/AssetPlacementTool.js';
export { SnapManager } from './snapping.js';
export type { SnapSettings, SnapGuide, SnapTranslationResult, SnapDimensionsResult } from './snapping.js';

// Editor
export {
  GlideEditor, createEditor, PortablePasteRollbackError,
  PORTABLE_BOARD_FRAGMENT_LIMITS, isCanonicalRasterAssetId,
  validatePortableBoardFragmentStructure,
} from './editor.js';
export type {
  GlidePlugin, CreateEditorOptions, ClipboardSchemaHeader, ClipboardPayload,
  EditorCommand, ExecuteCommandOptions, AssetResolver, AssetResolutionContext,
  PortableRasterExport, PortableRasterPayload, PortableBoardFragmentSchemaHeader,
  PortableBoardFragment, PortableAssetExportHook, PortableAssetMaterialization,
  PortableAssetMaterializer, CreatePortableBoardFragmentOptions,
  PastePortableBoardFragmentOptions, PortableSvgExportOptions,
  PortableBoardFragmentLimits, AlignOperation,
  DistributeAxis, DistributeMode, MatchSizeOperation, FlipAxis, TidyLayout,
  ShapePrecisionPatch,
} from './editor.js';

// Phase 4 — Bindings & Arrow Routing
export { computeArcPath, parseArcControlPoint } from './arc-router.js';
export { computeElbowPath, parseElbowPoints, countElbowSegments } from './elbow-router.js';
export {
  buildArrowShapeRecord,
  buildArrowBindingRecord,
  resolveConnectionTerminal,
  createCanvasShapeId,
  createTopIndex,
} from './arrow-records.js';
export { resolveArrowRoute, getArrowBendHandlePoint, pointsToPath, sampleCurvePoints } from './arrow-routing.js';
export {
  ArrowUtil, ArrowBindingUtil, ArrowPlugin,
  anchorToEdge, anchorToPoint,
} from './shapes/ArrowUtil.js';
export type { ArrowProps, ArrowShape, ArrowTerminal, ArrowBindingProps, ArrowBinding, ArrowRouteStyle } from './shapes/ArrowUtil.js';
export { ArrowTool, ArrowIdle } from './tools/ArrowTool.js';
export {
  SmartRouterCache,
  getWorldBounds,
  getArrowBindingEdge,
  getFallbackElbowPoints,
  computeFallbackLocalElbowPoints,
  offsetOrthogonalPolyline,
  routeSignature,
  simplifyCollinear,
} from './smart-router.js';
export type { SmartRoutingSnapshot, SmartRouteResolution } from './smart-router.js';

// Phase 6 / Infinity — AI + MCP
export { buildAIContext } from './ai-context.js';
export type { AIShapeContext, AIConnectionContext, AIContextSnapshot } from './ai-context.js';
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
} from './mcp.js';
export type { CanvasToolName, CanvasToolResult, CanvasToolError, CanvasToolManifestEntry } from './mcp.js';

// Phase A — Style system
export {
  TLDRAW_COLORS, resolveColor, hexWithOpacity, svgFill,
  STROKE_WIDTHS, FONT_SIZES, FONT_FAMILIES,
  STROKE_DASH_ARRAYS, FILL_OPACITIES,
  inlinePatternDefs, getPatternId, getShapePatternId,
  createTextForeignObjectForExport,
} from './styles.js';
export type {
  TldrawColor,
  FillStyle, StrokeStyle, SizeStyle, FontSize, TextAlign, Font,
  ShapeStyleProps, LabelProps,
} from './styles.js';
export { TextEditSessionController } from './text-edit.js';
export type {
  EditableTextField, EditableTextValue, TextEditSession, RecoverableTextEditDraft,
} from './text-edit.js';

// Phase A — Ellipse shape
export { EllipseUtil, EllipsePlugin } from './shapes/EllipseUtil.js';
export type { EllipseProps, EllipseShape } from './shapes/EllipseUtil.js';

// Phase A — Sticky note shape
export {
  StickyNoteUtil, StickyNotePlugin,
  STICKY_COLORS, wrapText,
} from './shapes/StickyNoteUtil.js';
export type { StickyNoteProps, StickyNoteShape } from './shapes/StickyNoteUtil.js';

// Phase A — Freehand shape
export {
  FreehandUtil, FreehandPlugin,
  catmullRomPath,
} from './shapes/FreehandUtil.js';
export type { FreehandProps, FreehandShape, FreehandPoint } from './shapes/FreehandUtil.js';

// Phase B — New tools
export { HandTool } from './tools/HandTool.js';
export { EllipseTool } from './tools/EllipseTool.js';
export { TextTool } from './tools/TextTool.js';
export { StickyNoteTool } from './tools/StickyNoteTool.js';
export { DrawTool } from './tools/DrawTool.js';
export { EraserTool } from './tools/EraserTool.js';
export {
  TriangleTool, DiamondTool, HexagonTool, StarTool,
  RoundedRectTool, ParallelogramTool, ChevronTool,
  DocumentTool, CylinderTool, NoteTool, CalloutTool,
} from './tools/GeoShapeTools.js';

// Phase C — Additional geo shapes
export {
  TriangleUtil, DiamondUtil, HexagonUtil, StarUtil, GeoShapePlugin,
  RoundedRectUtil, ParallelogramUtil, ChevronUtil,
  DocumentUtil, CylinderUtil, NoteUtil, CalloutUtil,
  P1ShapesPlugin,
} from './shapes/GeoShapeUtil.js';
export type {
  GeoShapeProps, TriangleShape, DiamondShape, HexagonShape, StarShape,
  RoundedRectShape, ParallelogramShape, ChevronShape,
  DocumentShape, CylinderShape, NoteShape, CalloutShape,
} from './shapes/GeoShapeUtil.js';

// Phase B — SelectTool extensions (resize + rotation types)
export type { RotationInfo } from './tools/SelectTool.js';

export { createSvgPathShape } from './shapes/createSvgPathShape.js';
export type { CreateSvgPathShapeDef } from './shapes/createSvgPathShape.js';
export { SanitizedSvgUtil, SanitizedAssetPlugin } from './shapes/SanitizedSvgUtil.js';
export type { SanitizedSvgShape, SanitizedSvgShapeProps } from './shapes/SanitizedSvgUtil.js';
export { RasterImageUtil } from './shapes/RasterImageUtil.js';
export type { RasterImageShape, RasterImageShapeProps } from './shapes/RasterImageUtil.js';
export {
  ContentIngressError,
  sanitizeSvg,
  createSanitizedSvgAsset,
  normalizeClipboardText,
  prepareRasterAsset,
  validateAssetRecord,
} from './content-ingress.js';
export type {
  SanitizedSvg,
  SanitizedSvgPath,
  SanitizedSvgAssetProps,
  PreparedSanitizedSvgAsset,
  RasterMetadata,
  PreparedRasterAsset,
  AssetProvenance,
} from './content-ingress.js';

export { MutationPermissionError, allowAllMutations, createMutationCapability } from './mutation-policy.js';
export type {
  MutationOrigin,
  MutationRequest,
  MutationPolicy,
  MutationCapability,
  MutationCapabilityGrant,
} from './mutation-policy.js';
