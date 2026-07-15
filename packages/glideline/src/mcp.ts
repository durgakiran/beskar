import dagre from 'dagre';
import { z } from 'zod';
import type { GlideEditor } from './editor';
import type { AIContextSnapshot } from './ai-context';
import {
  buildArrowBindingRecord,
  buildArrowShapeRecord,
  createCanvasShapeId,
  createTopIndex,
  resolveConnectionTerminal,
} from './arrow-records';
import type { ArrowRouteStyle } from './shapes/ArrowUtil';
import type { AnyRecord, ShapeId } from './types';

const recordSchema = z.record(z.string(), z.unknown());
const finiteNumber = z.number().finite();

// ── Style enums (sourced from styles.ts) ───────────────────────
const fillStyleSchema   = z.enum(['none', 'semi', 'solid', 'pattern', 'lined']);
const strokeStyleSchema = z.enum(['solid', 'dashed', 'dotted']);
const sizeStyleSchema   = z.enum(['thin', 'medium', 'thick', 'xl']);
const fontSchema        = z.enum(['draw', 'sans', 'serif', 'mono']);
const fontSizeSchema    = z.enum(['sm', 'md', 'lg', 'xl']);
const textAlignSchema   = z.enum(['left', 'center', 'right']);
const routeStyleSchema  = z.enum(['curve', 'ortho', 'smart']);

// ── Common labelled shape props (box, ellipse, geo shapes) ─────
const labelledShapeProps = {
  w:           finiteNumber.optional(),  // default: 120
  h:           finiteNumber.optional(),  // default: 80
  color:       z.string().optional(),    // any CSS colour or tldraw colour key e.g. 'black','blue','red'
  opacity:     z.number().min(0).max(1).optional(),
  fillStyle:   fillStyleSchema.optional(),
  strokeStyle: strokeStyleSchema.optional(),
  strokeWidth: sizeStyleSchema.optional(),
  label:       z.string().optional(),
  labelColor:  z.string().optional(),
  font:        fontSchema.optional(),
  fontSize:    fontSizeSchema.optional(),
  textAlign:   textAlignSchema.optional(),
};

// ── Per-shape discriminated union branches ─────────────────────
const boxShapeSchema = z.object({ type: z.literal('box'),      ...labelledShapeProps, cornerRadius: finiteNumber.optional() });
const ellipseShapeSchema     = z.object({ type: z.literal('ellipse'),   ...labelledShapeProps });
const triangleShapeSchema    = z.object({ type: z.literal('triangle'),  ...labelledShapeProps });
const diamondShapeSchema     = z.object({ type: z.literal('diamond'),   ...labelledShapeProps });
const hexagonShapeSchema     = z.object({ type: z.literal('hexagon'),   ...labelledShapeProps });
const starShapeSchema        = z.object({ type: z.literal('star'),      ...labelledShapeProps });

const textShapeSchema = z.object({
  type:      z.literal('text'),
  text:      z.string().optional(),
  color:     z.string().optional(),
  font:      fontSchema.optional(),
  fontSize:  fontSizeSchema.optional(),
});

const stickyNoteShapeSchema = z.object({
  type:      z.literal('sticky-note'),
  w:         finiteNumber.optional(),  // default: 200
  h:         finiteNumber.optional(),  // default: 200
  color:     z.enum(['yellow','orange','pink','blue','teal','green','purple','white']).optional(),
  text:      z.string().optional(),
  font:      fontSchema.optional(),
  fontSize:  fontSizeSchema.optional(),
  textAlign: textAlignSchema.optional(),
  textColor: z.string().optional(),
});

const frameShapeSchema = z.object({
  type:  z.literal('frame'),
  w:     finiteNumber.optional(),  // default: 300
  h:     finiteNumber.optional(),  // default: 200
  name:  z.string().optional(),
  color: z.string().optional(),
});

const freehandShapeSchema = z.object({
  type:        z.literal('freehand'),
  color:       z.string().optional(),
  opacity:     z.number().min(0).max(1).optional(),
  strokeWidth: sizeStyleSchema.optional(),
  strokeStyle: strokeStyleSchema.optional(),
});

// ── Rich discriminated union (replaces generic props: record) ──
const richShapePropsSchema = z.discriminatedUnion('type', [
  boxShapeSchema,
  ellipseShapeSchema,
  triangleShapeSchema,
  diamondShapeSchema,
  hexagonShapeSchema,
  starShapeSchema,
  textShapeSchema,
  stickyNoteShapeSchema,
  frameShapeSchema,
  freehandShapeSchema,
]);

export const createShapeInputSchema = z.intersection(
  z.object({ x: finiteNumber, y: finiteNumber }),
  richShapePropsSchema,
);

export const updateShapeInputSchema = z.object({
  id: z.string().min(1),
  x: finiteNumber.optional(),
  y: finiteNumber.optional(),
  rotation: finiteNumber.optional(),
  props: recordSchema.optional(),
}).strict();

export const deleteShapesInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
}).strict();

export const createConnectionInputSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  routeStyle: z.enum(['curve', 'ortho', 'smart']).optional(),
  props: recordSchema.optional(),
}).strict();

export const getCanvasStateInputSchema = z.object({}).strict();

export const createDiagramInputSchema = z.object({
  direction: z.enum(['TB', 'LR', 'BT', 'RL']).default('TB'),
  startX: finiteNumber.default(0),
  startY: finiteNumber.default(0),
  nodeSep: finiteNumber.default(50),   // horizontal gap between nodes in the same rank
  rankSep: finiteNumber.default(80),   // vertical gap between ranks
  nodes: z.array(
    z.intersection(
      z.object({ id: z.string().min(1) }),
      richShapePropsSchema,
    )
  ).min(1),
  edges: z.array(z.object({
    fromId: z.string().min(1),
    toId:   z.string().min(1),
    label:       z.string().optional(),
    routeStyle:  routeStyleSchema.optional(),
    color:       z.string().optional(),
    strokeStyle: strokeStyleSchema.optional(),
    strokeWidth: sizeStyleSchema.optional(),
    arrowheadStart: z.enum(['none', 'arrow']).optional(),
    arrowheadEnd:   z.enum(['none', 'arrow']).optional(),
  })).default([]),
});

export const layoutShapesInputSchema = z.object({
  shapeIds:  z.array(z.string().min(1)).min(2),
  direction: z.enum(['TB', 'LR', 'BT', 'RL']).default('TB'),
  nodeSep:   finiteNumber.default(50),
  rankSep:   finiteNumber.default(80),
});

export const getCanvasImageInputSchema = z.object({
  viewport: z.boolean().default(false),
}).strict();

export type CanvasToolName =
  | 'create_shape'
  | 'update_shape'
  | 'delete_shapes'
  | 'create_connection'
  | 'get_canvas_state'
  | 'create_diagram'
  | 'layout_shapes'
  | 'get_canvas_image';

export type CanvasToolResult =
  | { id: string }
  | { ok: true }
  | { deleted: number }
  | { nodeIds: Record<string, string> }
  | { dataUrl: string }
  | { ok: true, repositioned: number }
  | AIContextSnapshot
  | CanvasToolError;

export interface CanvasToolError {
  error: string;
  issues?: Array<{ path: string; message: string }>;
}

export interface CanvasToolManifestEntry {
  name: CanvasToolName;
  description: string;
  inputSchema: unknown;
}

type AnyZodSchema = z.ZodTypeAny;

interface CanvasToolDefinition<Name extends CanvasToolName, Schema extends AnyZodSchema> {
  name: Name;
  description: string;
  schema: Schema;
  handler: (editor: GlideEditor, input: any) => CanvasToolResult | Promise<CanvasToolResult>;
}

// Map shape type → estimated default dimensions used by dagre for layout math.
const SHAPE_DEFAULT_DIMS: Record<string, { w: number; h: number }> = {
  'box':        { w: 120, h: 80  },
  'ellipse':    { w: 120, h: 80  },
  'triangle':   { w: 120, h: 100 },
  'diamond':    { w: 120, h: 100 },
  'hexagon':    { w: 120, h: 100 },
  'star':       { w: 120, h: 100 },
  'text':       { w: 120, h: 40  },
  'sticky-note':{ w: 200, h: 200 },
  'frame':      { w: 300, h: 200 },
  'freehand':   { w: 100, h: 100 },
};

function estimateNodeDims(node: { type: string; w?: number; h?: number }): { w: number; h: number } {
  const defaults = SHAPE_DEFAULT_DIMS[node.type] ?? { w: 120, h: 80 };
  return {
    w: node.w ?? defaults.w,
    h: node.h ?? defaults.h,
  };
}

const TOOL_DEFINITIONS = [
  {
    name: 'create_shape',
    description: 'Create a shape on the canvas and return its id.',
    schema: createShapeInputSchema,
    handler: (editor, input: any) => {
      const { x, y, type, ...props } = input;
      if (!editor.schema.hasUtil(type)) {
        return { error: `Unknown shape type "${type}"` };
      }

      const id = createCanvasShapeId(type);
      editor.batch('AI: Create Shape', () => {
        editor.createShape({
          id,
          type,
          x,
          y,
          index: createTopIndex(),
          rotation: 0,
          meta: {},
          props,
        });
      });

      return { id };
    },
  },
  {
    name: 'update_shape',
    description: 'Update a shape position, rotation, or props.',
    schema: updateShapeInputSchema,
    handler: (editor, input: z.infer<typeof updateShapeInputSchema>) => {
      const id = input.id as ShapeId;
      const existing = editor.getShape(id);
      if (!existing) {
        return { error: `Shape "${input.id}" not found` };
      }

      const partial: Record<string, unknown> = {};
      if (input.x !== undefined) partial.x = input.x;
      if (input.y !== undefined) partial.y = input.y;
      if (input.rotation !== undefined) partial.rotation = input.rotation;
      if (input.props !== undefined) partial.props = input.props;

      editor.batch('AI: Update Shape', () => {
        editor.updateShape(id, partial as Partial<Omit<typeof existing, 'id' | 'type'>>);
      });

      return { ok: true };
    },
  },
  {
    name: 'delete_shapes',
    description: 'Delete one or more shapes from the canvas.',
    schema: deleteShapesInputSchema,
    handler: (editor, input: z.infer<typeof deleteShapesInputSchema>) => {
      const ids = input.ids.map((id: string) => id as ShapeId);
      const existingIds = ids.filter((id: ShapeId) => Boolean(editor.getShape(id)));

      if (existingIds.length > 0) {
        editor.batch('AI: Delete Shapes', () => {
          editor.deleteShapes(existingIds);
        });
      }

      return { deleted: existingIds.length };
    },
  },
  {
    name: 'create_connection',
    description: 'Create an arrow connection between two shapes.',
    schema: createConnectionInputSchema,
    handler: (editor, input: z.infer<typeof createConnectionInputSchema>) => {
      const fromId = input.fromId as ShapeId;
      const toId = input.toId as ShapeId;
      const fromShape = editor.getShape(fromId);
      const toShape = editor.getShape(toId);

      if (!fromShape || !toShape) {
        return { error: 'Both fromId and toId must reference existing shapes' };
      }

      const fromBounds = editor.getShapeWorldBounds(fromShape);
      const toBounds = editor.getShapeWorldBounds(toShape);
      const fromCenter = {
        x: fromBounds.minX + fromBounds.w / 2,
        y: fromBounds.minY + fromBounds.h / 2,
      };
      const toCenter = {
        x: toBounds.minX + toBounds.w / 2,
        y: toBounds.minY + toBounds.h / 2,
      };

      const start = resolveConnectionTerminal(editor, fromId, toCenter);
      const end = resolveConnectionTerminal(editor, toId, fromCenter);
      if (!start || !end) {
        return { error: 'Unable to resolve connection anchors' };
      }

      const id = createCanvasShapeId('arrow');
      const routeStyle = input.routeStyle ?? editor.arrowRouteStyle;
      const arrow = buildArrowShapeRecord({
        id,
        startWorld: start.point,
        endWorld: end.point,
        routeStyle,
        index: createTopIndex(),
      });
      arrow.props = {
        ...arrow.props,
        ...(input.props ?? {}),
        routeStyle: (input.props?.routeStyle as ArrowRouteStyle | undefined) ?? routeStyle,
        start: {
          boundShapeId: fromId,
          normalizedAnchor: start.normalizedAnchor,
          point: { x: 0, y: 0 },
        },
        end: {
          boundShapeId: toId,
          normalizedAnchor: end.normalizedAnchor,
          point: {
            x: end.point.x - start.point.x,
            y: end.point.y - start.point.y,
          },
        },
      };

      editor.batch('AI: Create Connection', () => {
        editor.createShape(arrow as unknown as AnyRecord);
        editor.createBinding(buildArrowBindingRecord({
          fromId: id,
          toId: fromId,
          terminal: 'start',
          normalizedAnchor: start.normalizedAnchor,
        }));
        editor.createBinding(buildArrowBindingRecord({
          fromId: id,
          toId: toId,
          terminal: 'end',
          normalizedAnchor: end.normalizedAnchor,
        }));
        editor.updateShape(fromId, { x: fromShape.x });
        editor.updateShape(toId, { x: toShape.x });
      });

      return { id };
    },
  },
  {
    name: 'get_canvas_state',
    description: 'Return the current AI-friendly canvas state.',
    schema: getCanvasStateInputSchema,
    handler: (editor) => editor.getAIContext(),
  },
  {
    name: 'create_diagram',
    description: 'Create a full diagram with auto-layout using dagre. Pass nodes (shapes) and edges (connections). Coordinates are computed automatically — do not provide x/y.',
    schema: createDiagramInputSchema,
    handler: (editor, input: z.infer<typeof createDiagramInputSchema>) => {
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: input.direction, nodesep: input.nodeSep, ranksep: input.rankSep });
      g.setDefaultEdgeLabel(() => ({}));

      const idMap = new Map<string, ShapeId>();

      for (const node of input.nodes) {
        const dims = estimateNodeDims(node as any);
        g.setNode(node.id, { width: dims.w, height: dims.h });
      }

      for (const edge of input.edges) {
        g.setEdge(edge.fromId, edge.toId);
      }

      dagre.layout(g);

      editor.batch('AI: Create Diagram', () => {
        for (const node of input.nodes) {
          const dagreNode = g.node(node.id);
          const canvasId = createCanvasShapeId(node.type);
          idMap.set(node.id, canvasId);

          const { id: _userNodeId, type, ...props } = node as any;
          editor.createShape({
            id: canvasId,
            type,
            x: input.startX + dagreNode.x - dagreNode.width / 2,
            y: input.startY + dagreNode.y - dagreNode.height / 2,
            index: createTopIndex(),
            rotation: 0,
            meta: {},
            props,
          });
        }

        for (const edge of input.edges) {
          const fromCanvasId = idMap.get(edge.fromId);
          const toCanvasId   = idMap.get(edge.toId);
          if (!fromCanvasId || !toCanvasId) continue;

          const fromShape = editor.getShape(fromCanvasId);
          const toShape   = editor.getShape(toCanvasId);
          if (!fromShape || !toShape) continue;

          const fromBounds = editor.getShapeWorldBounds(fromShape);
          const toBounds   = editor.getShapeWorldBounds(toShape);
          const fromCenter = { x: fromBounds.minX + fromBounds.w / 2, y: fromBounds.minY + fromBounds.h / 2 };
          const toCenter   = { x: toBounds.minX   + toBounds.w   / 2, y: toBounds.minY   + toBounds.h   / 2 };

          const start = resolveConnectionTerminal(editor, fromCanvasId, toCenter);
          const end   = resolveConnectionTerminal(editor, toCanvasId,   fromCenter);
          if (!start || !end) continue;

          const arrowId    = createCanvasShapeId('arrow');
          const routeStyle = (edge.routeStyle ?? editor.arrowRouteStyle) as ArrowRouteStyle;
          const arrow      = buildArrowShapeRecord({ id: arrowId, startWorld: start.point, endWorld: end.point, routeStyle, index: createTopIndex() });

          arrow.props = {
            ...arrow.props,
            routeStyle,
            ...(edge.label ? { label: edge.label } : {}),
            ...(edge.color ? { color: edge.color } : {}),
            ...(edge.strokeStyle ? { strokeStyle: edge.strokeStyle } : {}),
            ...(edge.strokeWidth ? { strokeWidth: edge.strokeWidth } : {}),
            ...(edge.arrowheadStart ? { arrowheadStart: edge.arrowheadStart } : {}),
            ...(edge.arrowheadEnd ? { arrowheadEnd: edge.arrowheadEnd } : {}),
            start: { boundShapeId: fromCanvasId, normalizedAnchor: start.normalizedAnchor, point: { x: 0, y: 0 } },
            end:   { boundShapeId: toCanvasId,   normalizedAnchor: end.normalizedAnchor,   point: { x: end.point.x - start.point.x, y: end.point.y - start.point.y } },
          };

          editor.createShape(arrow as unknown as AnyRecord);
          editor.createBinding(buildArrowBindingRecord({ fromId: arrowId, toId: fromCanvasId, terminal: 'start', normalizedAnchor: start.normalizedAnchor }));
          editor.createBinding(buildArrowBindingRecord({ fromId: arrowId, toId: toCanvasId,   terminal: 'end',   normalizedAnchor: end.normalizedAnchor }));
          editor.updateShape(fromCanvasId, { x: fromShape.x });
          editor.updateShape(toCanvasId,   { x: toShape.x });
        }
      });

      return {
        nodeIds: Object.fromEntries(idMap.entries()),
      } as any;
    },
  },
  {
    name: 'layout_shapes',
    description: 'Re-run auto-layout (dagre) on an existing set of shapes by their canvas IDs. Useful after adding new shapes to an existing diagram to restore clean spacing.',
    schema: layoutShapesInputSchema,
    handler: (editor, input: z.infer<typeof layoutShapesInputSchema>) => {
      const ids = input.shapeIds.map((id: string) => id as ShapeId);

      for (const id of ids) {
        if (!editor.getShape(id)) return { error: `Shape "${id}" not found` };
      }

      const idSet = new Set(ids);

      const arrows = editor.getShapes().filter(s => {
        if (s.type !== 'arrow') return false;
        const bindings = editor.getBindingsFromShape(s.id as ShapeId);
        const startBinding = bindings.find(b => (b as any).props.terminal === 'start');
        const endBinding   = bindings.find(b => (b as any).props.terminal === 'end');
        return startBinding && endBinding
          && idSet.has(startBinding.toId as ShapeId)
          && idSet.has(endBinding.toId as ShapeId);
      });

      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: input.direction, nodesep: input.nodeSep, ranksep: input.rankSep });
      g.setDefaultEdgeLabel(() => ({}));

      for (const id of ids) {
        const shape  = editor.getShape(id)!;
        const bounds = editor.getShapeWorldBounds(id);
        g.setNode(id, { width: bounds.w, height: bounds.h, shape });
      }

      for (const arrow of arrows) {
        const bindings    = editor.getBindingsFromShape(arrow.id as ShapeId);
        const startBinding = bindings.find(b => (b as any).props.terminal === 'start')!;
        const endBinding   = bindings.find(b => (b as any).props.terminal === 'end')!;
        g.setEdge(startBinding.toId as string, endBinding.toId as string);
      }

      dagre.layout(g);

      editor.batch('AI: Layout Shapes', () => {
        for (const id of ids) {
          const dagreNode = g.node(id);
          editor.updateShape(id, {
            x: dagreNode.x - dagreNode.width  / 2,
            y: dagreNode.y - dagreNode.height / 2,
          });
        }
      });

      return { ok: true, repositioned: ids.length } as any;
    },
  },
  {
    name: 'get_canvas_image',
    description: 'Take a PNG screenshot of the current canvas and return it as a base64 data URL. Use viewport:true to capture only what is currently visible, or viewport:false (default) to capture all shapes.',
    schema: getCanvasImageInputSchema,
    handler: async (editor, input: z.infer<typeof getCanvasImageInputSchema>) => {
      const box = input.viewport ? editor.getViewportBounds() : undefined;
      const dataUrl = await editor.takeScreenshot(box);
      return { dataUrl } as any;
    },
  },
] as const satisfies readonly CanvasToolDefinition<CanvasToolName, AnyZodSchema>[];

export function createCanvasToolServer(editor: GlideEditor) {
  const tools = new Map<CanvasToolName, CanvasToolDefinition<CanvasToolName, AnyZodSchema>>(
    TOOL_DEFINITIONS.map(tool => [tool.name, tool]),
  );

  return {
    async callTool(name: CanvasToolName, input: unknown): Promise<CanvasToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        return { error: `Unknown tool "${name}"` };
      }

      const parsed = tool.schema.safeParse(input);
      if (!parsed.success) {
        return {
          error: parsed.error.issues[0]?.message ?? 'Invalid tool input',
          issues: parsed.error.issues.map(issue => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        };
      }

      try {
        return await tool.handler(editor, parsed.data);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    generateToolManifest(): CanvasToolManifestEntry[] {
      return TOOL_DEFINITIONS.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: z.toJSONSchema(tool.schema),
      }));
    },
  };
}
