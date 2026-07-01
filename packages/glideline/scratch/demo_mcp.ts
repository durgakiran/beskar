import { createEditor } from "../src/editor";
import { BoxUtil } from "../src/shapes/BoxUtil";
import { ArrowPlugin } from "../src/shapes/ArrowUtil";
import { BoxTool } from "../src/tools/BoxTool";
import { SelectTool } from "../src/tools/SelectTool";
import { createCanvasToolServer } from "../src/mcp";

// 1. Create a shape plugin for "box"
const BoxPlugin = { id: 'box', shapes: [BoxUtil as any] };

// 2. Initialize the editor with Box and Arrow plugins
const editor = createEditor({
  plugins: [BoxPlugin, ArrowPlugin],
  tools: [SelectTool, BoxTool],
});

// 3. Create the MCP Tool Server
const server = createCanvasToolServer(editor);

console.log("=== Initializing MCP Interface Verification Demo ===\n");

// A. List all available MCP tools
console.log("Generating tool manifest...");
const manifest = server.generateToolManifest();
console.log("Available tools in manifest:");
manifest.forEach(tool => {
  console.log(` - \x1b[32m${tool.name}\x1b[0m: ${tool.description}`);
});
console.log();

// B. Call create_shape to add a couple of boxes
console.log("Calling 'create_shape' to create Box 1...");
const result1 = server.callTool('create_shape', {
  type: 'box',
  x: 100,
  y: 100,
  props: { w: 120, h: 80, label: 'Box A' },
});
console.log("Result for Box 1:", result1);

console.log("\nCalling 'create_shape' to create Box 2...");
const result2 = server.callTool('create_shape', {
  type: 'box',
  x: 400,
  y: 100,
  props: { w: 120, h: 80, label: 'Box B' },
});
console.log("Result for Box 2:", result2);

if ('id' in result1 && 'id' in result2) {
  const boxAId = result1.id;
  const boxBId = result2.id;

  // C. Call create_connection to link the two boxes with a smart arrow
  console.log("\nCalling 'create_connection' to link Box A -> Box B...");
  const connectionResult = server.callTool('create_connection', {
    fromId: boxAId,
    toId: boxBId,
    routeStyle: 'smart',
  });
  console.log("Result for Connection:", connectionResult);

  // D. Call update_shape to move Box A
  console.log("\nCalling 'update_shape' to move Box A to x: 150, y: 150...");
  const updateResult = server.callTool('update_shape', {
    id: boxAId,
    x: 150,
    y: 150,
  });
  console.log("Result for Update:", updateResult);
}

// E. Retrieve final canvas state
console.log("\nCalling 'get_canvas_state' to retrieve the current AI-friendly canvas state...");
const canvasState = server.callTool('get_canvas_state', {});
console.log("Canvas State (AI Snapshot):");
console.log(JSON.stringify(canvasState, null, 2));

console.log("\n=== MCP Verification Completed Successfully! ===");
