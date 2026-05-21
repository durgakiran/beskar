/**
 * whiteboard/Toolbar.tsx
 *
 * Left-side floating toolbar with:
 *  - Tool buttons (select, hand, box, ellipse, text, sticky, draw, eraser, arrow)
 *  - Keyboard shortcut labels
 *  - Active tool highlight
 *  - Undo / Redo buttons
 */

import { wbEditor } from './editor';
import { useSignalValue } from '../useSignalValue';

interface ToolDef {
  id:        string;
  label:     string;
  shortcut:  string;
  icon:      string; // emoji / unicode
}

const TOOLS: ToolDef[] = [
  { id: 'select',      label: 'Select',    shortcut: 'V', icon: '↖' },
  { id: 'hand',        label: 'Hand',      shortcut: 'H', icon: '✋' },
  { id: 'box',         label: 'Rectangle', shortcut: 'R', icon: '▭' },
  { id: 'ellipse',     label: 'Ellipse',   shortcut: 'E', icon: '○' },
  { id: 'text',        label: 'Text',      shortcut: 'T', icon: 'A' },
  { id: 'sticky-note',label: 'Sticky',   shortcut: 'S', icon: '🗒' },
  { id: 'draw',       label: 'Draw',      shortcut: 'D', icon: '✏' },
  { id: 'eraser',     label: 'Eraser',    shortcut: 'X', icon: '⌫' },
  { id: 'arrow',      label: 'Arrow',     shortcut: 'A', icon: '→' },
];

function ToolButton({ tool, active }: { tool: ToolDef; active: boolean }) {
  return (
    <button
      id={`wb-tool-${tool.id}`}
      title={`${tool.label} (${tool.shortcut})`}
      onClick={() => wbEditor.setCurrentTool(tool.id)}
      style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        width:           44,
        height:          44,
        borderRadius:    10,
        border:          active ? '1.5px solid #89b4fa' : '1.5px solid transparent',
        background:      active ? '#89b4fa22' : 'transparent',
        color:           active ? '#89b4fa' : '#6c7086',
        cursor:          'pointer',
        fontSize:        18,
        lineHeight:      1,
        transition:      'all 0.12s',
        position:        'relative',
      }}
    >
      <span style={{ fontSize: 18 }}>{tool.icon}</span>
      <span style={{ fontSize: 8, marginTop: 2, opacity: 0.7, fontFamily: 'monospace' }}>{tool.shortcut}</span>
    </button>
  );
}

export function Toolbar() {
  // Subscribe directly to the engine's currentToolId signal — updates instantly on every setCurrentTool() call
  const activeTool = useSignalValue(wbEditor.currentToolId) ?? 'select';

  return (
    <div
      id="wb-toolbar"
      style={{
        position:       'absolute',
        left:            12,
        top:             '50%',
        transform:       'translateY(-50%)',
        zIndex:          50,
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        gap:             4,
        background:      '#1e1e2e',
        border:          '1px solid #313244',
        borderRadius:    14,
        padding:         '10px 6px',
        boxShadow:       '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      {TOOLS.map(tool => (
        <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} />
      ))}

      {/* Divider */}
      <div style={{ width: 32, height: 1, background: '#313244', margin: '4px 0' }} />

      {/* Undo */}
      <button
        id="wb-undo"
        title="Undo (⌘Z)"
        onClick={() => wbEditor.history.undo()}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 44, height: 36, borderRadius: 8,
          border: '1.5px solid transparent',
          background: 'transparent', color: '#6c7086',
          cursor: 'pointer', fontSize: 16,
          transition: 'all 0.12s',
        }}
      >↩</button>

      {/* Redo */}
      <button
        id="wb-redo"
        title="Redo (⇧⌘Z)"
        onClick={() => wbEditor.history.redo()}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 44, height: 36, borderRadius: 8,
          border: '1.5px solid transparent',
          background: 'transparent', color: '#6c7086',
          cursor: 'pointer', fontSize: 16,
          transition: 'all 0.12s',
        }}
      >↪</button>
    </div>
  );
}
