# Beskar Editor - Quick Start Guide

## 🚀 Get Started in 3 Steps

### 1. Install Dependencies (Already Done!)

The editor package is already built and ready to use.

### 2. Run the Demo

```bash
cd packages/editor-demo
npm run dev
```

The demo will open at `http://localhost:5173`

### 3. Test Features

Try these in the demo:

**Text Formatting:**
- **Bold**: `Cmd/Ctrl + B`
- *Italic*: `Cmd/Ctrl + I`
- <u>Underline</u>: `Cmd/Ctrl + U`
- ~~Strike~~: `Cmd/Ctrl + Shift + X`

**Quick Shortcuts:**
- Type `# ` for heading 1
- Type `## ` for heading 2
- Type `- ` or `* ` for bullet list
- Type `1. ` for ordered list
- Type `[ ] ` for task list
- Type `>` for blockquote
- Type ` ``` ` for code block

**Tables:**
- Type `/table` (when slash command is implemented)
- Or insert via menu

**Edit/View Mode:**
- Click the toggle button to switch between editing and viewing

## 📦 Using in Your Project

### Option 1: Link Local Package

In your project's package.json:
```json
{
  "dependencies": {
    "@beskar/editor": "file:../packages/editor"
  }
}
```

Then:
```bash
npm install
```

### Option 2: Build and Copy

```bash
# Build the editor
cd packages/editor
npm run build

# Copy dist folder to your project
# Then import from the copied location
```

## 💡 Basic Implementation

```tsx
import { Editor } from '@beskar/editor';
import '@beskar/editor/styles.css';

function MyEditor() {
  return (
    <Editor
      initialContent={{
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello World!' }]
          }
        ]
      }}
      editable={true}
      placeholder="Start typing..."
      onUpdate={(content) => {
        console.log('Content updated:', content);
      }}
    />
  );
}
```

## 🔄 Development Workflow

### Making Changes to the Editor

1. Edit files in `packages/editor/src/`
2. Rebuild: `cd packages/editor && npm run build`
3. Restart demo: The demo will automatically pick up changes

### Watch Mode (Recommended)

Terminal 1 - Editor Watch Mode:
```bash
cd packages/editor
npm run dev  # Watches and rebuilds on changes
```

Terminal 2 - Demo Dev Server:
```bash
cd packages/editor-demo
npm run dev  # Serves the demo
```

## 📚 More Information

- Full README: `packages/editor/README.md`
- Implementation Details: `packages/editor/IMPLEMENTATION_SUMMARY.md`
- Examples: `packages/editor/examples/`

## 🆘 Troubleshooting

**Demo won't start?**
```bash
cd packages/editor-demo
rm -rf node_modules package-lock.json
npm install
npm run dev
```

**Editor not updating?**
```bash
cd packages/editor
npm run build
```

**Type errors?**
Make sure you're using:
- Node.js 22+ LTS
- TypeScript 5.3+
- React 19+

## ✅ What's Working

- ✅ Text formatting (bold, italic, underline, strike)
- ✅ Headings (H1-H6)
- ✅ Lists (bullet, ordered, task)
- ✅ Tables with resizing
- ✅ Blockquotes
- ✅ Code blocks
- ✅ Horizontal rules
- ✅ Text alignment
- ✅ Text colors
- ✅ Collaboration support (Y.js + Hocuspocus)
- ✅ Auto-save with debouncing
- ✅ Read-only mode
- ✅ TypeScript support

## 🔮 Coming Soon

- Bubble menu for text selection
- Slash command menu
- Toolbar components
- Image upload
- Mermaid diagrams
- More...

Enjoy building with Beskar Editor! 🎉

