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

export const createShapeInputSchema = z.object({
  type: z.string().min(1),
  x: finiteNumber,
  y: finiteNumber,
  props: recordSchema.optional(),
}).strict();

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

export type CanvasToolName =
  | 'create_shape'
  | 'update_shape'
  | 'delete_shapes'
  | 'create_connection'
  | 'get_canvas_state';

export type CanvasToolResult =
  | { id: string }
  | { ok: true }
  | { deleted: number }
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

type AnyZodSchema = z.ZodType<unknown, unknown, unknown>;

interface CanvasToolDefinition<Name extends CanvasToolName, Schema extends AnyZodSchema> {
  name: Name;
  description: string;
  schema: Schema;
  handler: (editor: GlideEditor, input: z.infer<Schema>) => CanvasToolResult;
}

const TOOL_DEFINITIONS = [
  {
    name: 'create_shape',
    description: 'Create a shape on the canvas and return its id.',
    schema: createShapeInputSchema,
    handler: (editor, input) => {
      if (!editor.schema.hasUtil(input.type)) {
        return { error: `Unknown shape type "${input.type}"` };
      }

      const id = createCanvasShapeId(input.type);
      editor.run(() => {
        editor.createShape({
          id,
          type: input.type,
          x: input.x,
          y: input.y,
          index: createTopIndex(),
          rotation: 0,
          meta: {},
          props: input.props ?? {},
        });
      }, { history: 'ignore' });

      return { id };
    },
  },
  {
    name: 'update_shape',
    description: 'Update a shape position, rotation, or props.',
    schema: updateShapeInputSchema,
    handler: (editor, input) => {
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

      editor.run(() => {
        editor.updateShape(id, partial as Partial<Omit<typeof existing, 'id' | 'type'>>);
      }, { history: 'ignore' });

      return { ok: true };
    },
  },
  {
    name: 'delete_shapes',
    description: 'Delete one or more shapes from the canvas.',
    schema: deleteShapesInputSchema,
    handler: (editor, input) => {
      const ids = input.ids.map(id => id as ShapeId);
      const existingIds = ids.filter(id => Boolean(editor.getShape(id)));

      if (existingIds.length > 0) {
        editor.run(() => {
          editor.deleteShapes(existingIds);
        }, { history: 'ignore' });
      }

      return { deleted: existingIds.length };
    },
  },
  {
    name: 'create_connection',
    description: 'Create an arrow connection between two shapes.',
    schema: createConnectionInputSchema,
    handler: (editor, input) => {
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

      editor.run(() => {
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
      }, { history: 'ignore' });

      return { id };
    },
  },
  {
    name: 'get_canvas_state',
    description: 'Return the current AI-friendly canvas state.',
    schema: getCanvasStateInputSchema,
    handler: editor => editor.getAIContext(),
  },
] as const satisfies readonly CanvasToolDefinition<CanvasToolName, AnyZodSchema>[];

export function createCanvasToolServer(editor: GlideEditor) {
  const tools = new Map<CanvasToolName, CanvasToolDefinition<CanvasToolName, AnyZodSchema>>(
    TOOL_DEFINITIONS.map(tool => [tool.name, tool]),
  );

  return {
    callTool(name: CanvasToolName, input: unknown): CanvasToolResult {
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
        return tool.handler(editor, parsed.data);
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
