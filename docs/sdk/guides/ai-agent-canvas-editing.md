# Guide: Let an AI agent read and edit the canvas

**Use case:** an LLM-backed feature ("ask AI to organize this board", "generate a flowchart from this description", an agentic coding-style assistant that can see and manipulate a live canvas) needs structured read access to the document and a safe, validated way to make changes.

**Reference:** [glideline: AI / MCP integration](../glideline/content-ingress-mutation-and-ai.md#ai--mcp-integration).

## Giving the model context

```ts
import { buildAIContext } from '@durgakiran/glideline';

const snapshot = buildAIContext(editor, { viewport: true });   // or editor.getAIContext({ viewport: true })
// snapshot: AIContextSnapshot — flat shape + connection list, LLM-friendly
```

Pass `snapshot` (typically `JSON.stringify`'d) into your prompt or as part of a tool-call response. `viewport: true` scopes it to what's currently visible — use this for "what am I looking at" style prompts; omit it for whole-document context ("summarize this board").

## Letting the model act

```ts
import { createCanvasToolServer } from '@durgakiran/glideline';

const server = createCanvasToolServer(editor);
const manifest = server.generateToolManifest();   // register these with your MCP client / tool-calling API
```

`manifest` is `{ name, description, inputSchema }[]` with JSON Schema inputs — hand it directly to an MCP client, or to any tool-calling LLM API's tool-definition list. The tools available: `create_shape`, `update_shape`, `delete_shapes`, `create_connection`, `get_canvas_state`, `create_diagram`, `layout_shapes`, `arrange_shapes`, `set_shape_geometry`, `reparent_shapes`, `get_canvas_image`.

When the model calls a tool, route it through the server rather than calling `editor` methods yourself from parsed model output:

```ts
async function handleToolCall(name: string, input: unknown) {
  const result = await server.callTool(name, input);
  if ('error' in result) {
    // Structured failure — bad input (Zod validation) or a denied mutation — return this to the model, don't throw.
    return result;
  }
  return result;
}
```

This matters for two reasons:

1. **Input validation is built in.** Every tool's input is checked against a `zod` schema before it touches the editor — a malformed or hallucinated tool call (wrong field name, out-of-range number) comes back as `{ error, issues: [{ path, message }] }` that you can feed straight back to the model for self-correction, instead of throwing and killing the interaction.
2. **`create_diagram`/`layout_shapes`/`arrange_shapes` run real graph-layout algorithms** (via `dagre`) — this is meaningfully more useful for "lay out this flowchart" prompts than asking the model to compute x/y coordinates itself, and it's already wired for you.

## Restricting what the model is allowed to do

If you don't want an AI agent to have the same authority as the local user (e.g. it should be able to create/update shapes but never delete the whole board, or its writes should be revertible/attributable separately), combine the tool server with a [mutation policy](../glideline/content-ingress-mutation-and-ai.md#mutation-policy):

```ts
const aiCapability = createMutationCapability();

const editor = createEditor({
  plugins: [...],
  mutationPolicy: {
    authorize: (req) => (req.origin === 'local-api' && req.command === 'deleteShapes') ? 'deny' : 'allow',
  },
  trustedMutationCapabilities: [{ capability: aiCapability, origins: ['local-api'] }],
});
```

A denied mutation surfaces through `server.callTool()`'s result as `{ error, code: 'MUTATION_PERMISSION_DENIED' }` — the same structured-failure path as a schema validation error, so your model-facing error handling doesn't need a separate branch for "not allowed" vs. "malformed."

## Practical notes

- `get_canvas_image` returns a `dataUrl` — useful for a vision-capable model to actually "see" the board rather than reason purely over the structured `AIContextSnapshot`. Combine both: structured context for precise references (shape ids), image for spatial/visual judgment.
- Each `server.callTool()` invocation is its own history entry — a multi-step AI turn ("create three shapes and connect them") produces several undo steps, not one. If you want "everything the AI did this turn" to undo as a single action, that's a gap to close deliberately (e.g. a batching option on `createCanvasToolServer`, or wrapping tool dispatch yourself at a lower level than the current `callTool` API exposes) rather than something achievable by wrapping the async call sequence in `editor.batch` from the outside.
