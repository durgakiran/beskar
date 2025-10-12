# Troubleshooting Guide

## Common Issues

### ❌ Invalid Hook Call Error

**Error:**
```
Invalid hook call. Hooks can only be called inside of the body of a function component.
Cannot read properties of null (reading 'useRef')
```

**Cause:** Multiple copies of React in node_modules

**Solution:**
This is already fixed in `vite.config.ts` with React deduplication. If you still see this:

```bash
# Clear cache and reinstall
rm -rf node_modules/.vite
rm -rf node_modules
npm install
npm run dev
```

### ❌ Syntax Error: Unexpected token '??='

**Error:**
```
SyntaxError: Unexpected token '??='
```

**Cause:** Using Node.js version older than 16

**Solution:**
Make sure you're using Node.js 22 LTS:

```bash
nvm use 22
node --version  # Should show v22.x.x
```

### ❌ Module not found: @beskar/editor

**Error:**
```
Cannot find module '@beskar/editor'
```

**Solution:**
Reinstall the editor package:

```bash
npm install
# Or if that doesn't work:
cd ../editor && npm run build && cd ../editor-demo && npm install
```

### ❌ Styles not loading

**Symptoms:** Editor appears but has no styling

**Solution:**
Make sure the CSS import is in your component:

```tsx
import '@beskar/editor/styles.css';
```

### ❌ TypeScript errors

**Error:**
```
Cannot find type definitions for '@beskar/editor'
```

**Solution:**
Rebuild the editor package to generate type definitions:

```bash
cd ../editor
npm run build
```

### ❌ Hot reload not working

**Symptom:** Changes to editor source don't reflect in demo

**Solution:**
Run the editor in watch mode:

**Terminal 1:**
```bash
cd packages/editor
npm run dev  # Watch mode
```

**Terminal 2:**
```bash
cd packages/editor-demo
npm run dev
```

## Development Tips

### Debugging

1. **Check React version:**
```bash
npm list react
# Should only show one version
```

2. **Clear all caches:**
```bash
rm -rf node_modules/.vite
rm -rf ../editor/dist
rm -rf node_modules
npm install
cd ../editor && npm run build && cd ../editor-demo
npm run dev
```

3. **Verify editor build:**
```bash
cd ../editor
npm run build
ls -la dist/  # Should see index.js, index.mjs, styles.css, etc.
```

### Performance

If the dev server is slow:

1. **Vite optimization** is already configured in `vite.config.ts`
2. **Clear cache:** `rm -rf node_modules/.vite`
3. **Restart:** Stop and start `npm run dev`

### Port Already in Use

**Error:**
```
Port 5173 is already in use
```

**Solution:**
```bash
# Kill the process
lsof -ti:5173 | xargs kill -9
# Or use a different port
npm run dev -- --port 5174
```

## Editor Package Issues

### Rebuilding from Scratch

If nothing works, rebuild everything:

```bash
# From editor-demo directory
cd ../editor
rm -rf node_modules dist
npm install
npm run build

cd ../editor-demo
rm -rf node_modules
npm install
npm run dev
```

### Checking Build Output

The editor dist should contain:
- `index.js` (CJS)
- `index.mjs` (ESM)
- `index.d.ts` (TypeScript declarations)
- `styles.css` (Styles)

```bash
cd ../editor
npm run build
ls -la dist/
```

## Still Having Issues?

1. Check Node.js version: `node --version` (should be 22.x)
2. Check npm version: `npm --version` (should be 10.x)
3. Make sure you're in the correct directory
4. Check the terminal for any build errors
5. Try clearing all caches and rebuilding everything

## Useful Commands

```bash
# Check what's using port 5173
lsof -i :5173

# Force kill a port
lsof -ti:5173 | xargs kill -9

# Check React versions
npm list react react-dom

# Clear all caches
rm -rf node_modules/.vite node_modules/.cache

# Full reset
rm -rf node_modules package-lock.json && npm install
```

