# Beskar Editor Demo

A lightweight standalone demo application for testing the @beskar/editor package.

## Features

This demo showcases:

- ✅ Basic editor functionality
- ✅ Text formatting (bold, italic, underline, strike)
- ✅ Lists (bullet, ordered, task lists)
- ✅ Tables with advanced operations
- ✅ Read-only/editable mode toggle
- ✅ Content JSON viewer
- ✅ Auto-save with debouncing

## Running the Demo

```bash
# Install dependencies (if not already installed)
npm install

# Start the development server
npm run dev

# The demo will be available at http://localhost:5173
```

## Building for Production

```bash
npm run build
npm run preview
```

## Testing Features

1. **Text Formatting**: Select text and use keyboard shortcuts:
   - Bold: Cmd/Ctrl + B
   - Italic: Cmd/Ctrl + I
   - Underline: Cmd/Ctrl + U
   - Strike: Cmd/Ctrl + Shift + X

2. **Lists**: Type `-` or `*` followed by a space for bullet lists, `1.` for ordered lists

3. **Headings**: Type `#` followed by a space for H1, `##` for H2, etc.

4. **Tables**: Use the table menu to insert and manipulate tables

5. **Task Lists**: Type `[ ]` followed by a space for a task list item

## Architecture

- Built with Vite + React 19 + TypeScript
- Uses the local @beskar/editor package
- Minimal dependencies for fast development

## Notes

- This is a standalone demo and is not meant for production use
- It uses the file protocol to link to the editor package
- Changes to the editor package require rebuilding it (`cd ../editor && npm run build`)
