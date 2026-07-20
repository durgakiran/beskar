import {
  ArrowPlugin,
  BoxTool,
  DrawTool,
  EllipseTool,
  EllipseUtil,
  EraserTool,
  FreehandUtil,
  GeoShapePlugin,
  P1ShapesPlugin,
  HandTool,
  SelectTool,
  StickyNoteTool,
  StickyNoteUtil,
  TextTool,
  TriangleTool,
  DiamondTool,
  HexagonTool,
  StarTool,
  RoundedRectTool,
  ParallelogramTool,
  ChevronTool,
  DocumentTool,
  CylinderTool,
  NoteTool,
  CalloutTool,
  ArrowTool,
  createEditor,
  BoxUtil,
  FrameUtil,
  TextUtil,
  type MutationCapability,
  type MutationPolicy,
} from '@durgakiran/glideline';

const CoreShapesPlugin = {
  id: 'glideboard-core-shapes',
  shapes: [
    BoxUtil as any,
    TextUtil as any,
    FrameUtil as any,
    EllipseUtil as any,
    StickyNoteUtil as any,
    FreehandUtil as any,
  ],
};

export function createGlideboardEditorInstance(
  extraPlugins: import('@durgakiran/glideline').GlidePlugin[] = [],
  mutationPolicy?: MutationPolicy,
  remoteMutationCapability?: MutationCapability,
) {
  return createEditor({
    plugins: [CoreShapesPlugin, GeoShapePlugin, ArrowPlugin, P1ShapesPlugin, ...extraPlugins],
    tools: [
      SelectTool,
      BoxTool,
      TriangleTool,
      DiamondTool,
      HexagonTool,
      StarTool,
      ArrowTool,
      HandTool,
      EllipseTool,
      TextTool,
      StickyNoteTool,
      DrawTool,
      EraserTool,
      RoundedRectTool,
      ParallelogramTool,
      ChevronTool,
      DocumentTool,
      CylinderTool,
      NoteTool,
      CalloutTool,
    ],
    ...(mutationPolicy ? { mutationPolicy } : {}),
    ...(remoteMutationCapability
      ? {
          trustedMutationCapabilities: [{
            capability: remoteMutationCapability,
            origins: ['remote'] as const,
          }],
        }
      : {}),
  });
}
