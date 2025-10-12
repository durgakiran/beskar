# @beskar/editor

A rich text editor built on TipTap v3 with Radix UI components for better accessibility and modern design patterns.

## Features

- 🎨 Built on TipTap v3 (latest) with full ProseMirror power
- ♿ Accessible UI components using Radix UI
- 🤝 Real-time collaboration support with Y.js and Hocuspocus
- 📝 Rich text formatting (bold, italic, underline, strike, code)
- 📋 Lists (bullet, ordered, task lists)
- 📊 Tables with advanced operations
- 🎯 Text alignment and text styling
- 🎨 Color picker
- 💾 Auto-save with debouncing
- ⚡ TypeScript support
- 🔧 Extensible architecture

## Installation

```bash
npm install @beskar/editor
```

## Usage

### Basic Editor

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
            content: [{ type: 'text', text: 'Hello World!' }],
          },
        ],
      }}
      editable={true}
      placeholder="Start writing..."
      onUpdate={(content) => {
        console.log('Content updated:', content);
      }}
      onReady={(editor) => {
        console.log('Editor ready:', editor);
      }}
    />
  );
}
```

### Collaborative Editor

```tsx
import { Editor } from '@beskar/editor';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import '@beskar/editor/styles.css';

function CollaborativeEditor() {
  const doc = new Y.Doc();
  
  const provider = new HocuspocusProvider({
    url: 'ws://localhost:1234',
    name: 'document-name',
    document: doc,
  });

  return (
    <Editor
      editable={true}
      placeholder="Start collaborating..."
      collaboration={{
        provider,
        user: {
          id: 'user-123',
          name: 'John Doe',
          color: '#3b82f6',
        },
      }}
      onUpdate={(content) => {
        console.log('Content updated:', content);
      }}
    />
  );
}
```

## API Reference

### Editor Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `initialContent` | `JSONContent` | `undefined` | Initial content for the editor |
| `editable` | `boolean` | `true` | Whether the editor is editable |
| `placeholder` | `string` | `'Write something....'` | Placeholder text |
| `collaboration` | `CollaborationConfig` | `undefined` | Collaboration configuration |
| `onUpdate` | `(content: any) => void` | `undefined` | Callback when content updates (debounced) |
| `onReady` | `(editor: Editor) => void` | `undefined` | Callback when editor is ready |
| `extensions` | `Extensions` | `[]` | Additional TipTap extensions |
| `className` | `string` | `''` | Additional CSS classes |
| `autoFocus` | `boolean \| 'start' \| 'end' \| number` | `false` | Auto-focus configuration |

### CollaborationConfig

```typescript
interface CollaborationConfig {
  provider: HocuspocusProvider;
  user: {
    id: string;
    name: string;
    email?: string;
    username?: string;
    color?: string;
  };
  field?: string; // Default: 'default'
}
```

## Custom Extensions

You can add custom TipTap extensions:

```tsx
import { Editor } from '@beskar/editor';
import { Link } from '@tiptap/extension-link';

function MyEditor() {
  return (
    <Editor
      initialContent={content}
      extensions={[
        Link.configure({
          openOnClick: false,
        }),
      ]}
    />
  );
}
```

## Styling

The editor comes with default styles that you need to import:

```tsx
import '@beskar/editor/styles.css';
```

The editor uses CSS classes prefixed with `beskar-editor` for easy customization.

## Requirements

- React 19+
- Node.js 22+
- TypeScript 5.3+ (for type support)

## Development

```bash
# Install dependencies
npm install

# Build the package
npm run build

# Watch mode
npm run dev

# Type check
npm run type-check
```

## License

MIT

## Contributing

Contributions are welcome! Please read the contributing guidelines first.

