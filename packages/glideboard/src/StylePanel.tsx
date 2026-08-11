import React, { useMemo } from 'react';
import { FiLock, FiUnlock, FiRotateCcw } from 'react-icons/fi';
import {
  TLDRAW_COLORS,
  type GlideShape,
  type ShapeId,
} from '@durgakiran/glideline';
import { useSelectedShapes } from './hooks/useSelectedShapes';
import { useGlideboardController } from './GlideboardContext';
import type {
  ArrowRouteStyle,
  ArrowheadStyle,
} from './GlideboardController';
import { wbTheme } from './theme';
import { useSignalValue } from './useSignalValue';

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 12,
  width: 240,
  background: wbTheme.surface,
  borderRadius: 10,
  border: `1px solid ${wbTheme.border}`,
  boxShadow: wbTheme.shadow,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  color: wbTheme.text,
  fontFamily: 'inherit',
  zIndex: 100,
  userSelect: 'none',
  pointerEvents: 'auto',
  maxHeight: 'calc(100% - 48px)',
  overflowY: 'auto',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: wbTheme.textSoft,
  marginBottom: 8,
  fontWeight: 600,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
};

const buttonStyleSmall: React.CSSProperties = {
  minWidth: 0,
  height: 28,
  borderRadius: 4,
  border: `1px solid ${wbTheme.border}`,
  background: wbTheme.surfaceInset,
  color: wbTheme.textMuted,
  cursor: 'pointer',
  fontSize: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function IconButton({ active, onClick, style, children }: { active: boolean; onClick: () => void; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        height: 28,
        borderRadius: 4,
        border: `1px solid ${active ? wbTheme.accent : wbTheme.border}`,
        background: active ? wbTheme.accentSurface : 'transparent',
        color: active ? wbTheme.accentText : wbTheme.textMuted,
        cursor: 'pointer',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function NumericField({ label, value, onCommit, disabled = false }: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = React.useState(String(Math.round(value * 100) / 100));
  React.useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(String(Math.round(value * 100) / 100));
  };
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '18px 1fr', alignItems: 'center', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: wbTheme.textSoft }}>{label}</span>
      <input
        aria-label={label}
        type="number"
        value={draft}
        disabled={disabled}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        style={{ width: '100%', minWidth: 0, height: 26, boxSizing: 'border-box', borderRadius: 4,
          border: `1px solid ${wbTheme.border}`, background: wbTheme.surfaceInset, color: wbTheme.text,
          padding: '0 6px', fontSize: 11 }}
      />
    </label>
  );
}

export function StylePanel() {
  const controller = useGlideboardController();
  const { editor } = controller;
  const selectedShapes = useSelectedShapes();
  const editingSession = useSignalValue(editor.textEditing.session);
  const editingShape = useSignalValue(
    editingSession ? editor.getShapeSignal(editingSession.shapeId) : undefined,
  ) as GlideShape | null | undefined;
  const textStyleTargetId = useSignalValue(controller.textStyleTargetIdSignal);
  const shapes = editingShape ? [editingShape] : selectedShapes;
  const activeStyles = useSignalValue(editor.activeStyles);
  const snapSettings = useSignalValue(editor.snapping.settings)!;
  const textOnly = Boolean(editingShape)
    || (shapes.length > 0 && shapes.every(shape => shape.type === 'text'))
    || (
      selectedShapes.length === 1
      && selectedShapes[0]!.id === textStyleTargetId
    );
  const [lockAspect, setLockAspect] = React.useState(true);
  const selected = selectedShapes.length === 1 ? selectedShapes[0]! : null;
  const selectedWorld = selected ? editor.getShapeVisualWorldBounds(selected) : null;
  const selectedLocal = selected ? editor.getShapeLocalBounds(selected.id as ShapeId) : null;
  const canResizePrecisely = Boolean(selected && selected.type !== 'group' && selected.type !== 'arrow');
  const canMatchSizes = selectedShapes.length >= 2
    && selectedShapes.every(shape => shape.type !== 'group' && shape.type !== 'arrow');

  const supportedKeys = useMemo(() => {
    const keys = new Set<string>();
    shapes.forEach(shape => {
      Object.keys(shape.props).forEach(key => keys.add(key));
    });
    return keys;
  }, [shapes]);

  const getCommonValue = (key: string) => {
    if (shapes.length === 0) {
      return activeStyles ? activeStyles[key] : undefined;
    }
    let value: unknown = undefined;
    let first = true;
    for (const shape of shapes) {
      if (key in shape.props) {
        if (first) {
          value = shape.props[key];
          first = false;
        } else if (value !== shape.props[key]) {
          return undefined;
        }
      }
    }
    return value;
  };

  const updateProp = (key: string, value: unknown) => {
    editor.activeStyles.value = {
      ...editor.activeStyles.value,
      [key]: value,
    };
    if (shapes.length > 0) {
      editor.batch('Style change', () => {
        for (const shape of shapes) {
          if (key in shape.props) {
            editor.updateShape(shape.id as ShapeId, {
              props: { [key]: value },
            });
          }
        }
      });
    }
  };

  const color = getCommonValue('color');
  const fillStyle = getCommonValue('fillStyle');
  const strokeStyle = getCommonValue('strokeStyle');
  const strokeWidth = getCommonValue('strokeWidth');
  const font = getCommonValue('font');
  const fontSize = getCommonValue('fontSize');
  const textAlign = getCommonValue('textAlign');
  const labelColor = getCommonValue('labelColor');
  const routeStyle = getCommonValue('routeStyle');
  const arrowheadStart = getCommonValue('arrowheadStart');
  const arrowheadEnd = getCommonValue('arrowheadEnd');
  const clipContent = getCommonValue('clipContent');

  const getCommonTextColor = () => {
    let value: unknown = undefined;
    let first = true;
    for (const shape of shapes) {
      const key = 'labelColor' in shape.props ? 'labelColor' : 'color';
      if (!(key in shape.props)) continue;
      if (first) {
        value = shape.props[key];
        first = false;
      } else if (value !== shape.props[key]) {
        return undefined;
      }
    }
    return shapes.length === 0
      ? activeStyles?.['labelColor'] ?? activeStyles?.['color']
      : value;
  };
  const textColor = getCommonTextColor();
  const supportsTextColor = shapes.length === 0 || shapes.some(shape => (
    'labelColor' in shape.props || 'color' in shape.props
  ));

  const updateTextColor = (value: unknown) => {
    editor.activeStyles.value = {
      ...editor.activeStyles.value,
      color: value,
      labelColor: value,
    };
    if (shapes.length === 0) return;
    editor.batch('Text color change', () => {
      for (const shape of shapes) {
        const key = 'labelColor' in shape.props ? 'labelColor' : 'color';
        if (key in shape.props) {
          editor.updateShape(shape.id as ShapeId, { props: { [key]: value } });
        }
      }
    });
  };

  const updateArrowRoute = (value: ArrowRouteStyle) => {
    controller.setArrowRouteStyle(value);
    updateProp('routeStyle', value);
  };

  const updateArrowhead = (terminal: 'start' | 'end', value: ArrowheadStyle) => {
    if (terminal === 'start') controller.setArrowheadStart(value);
    else controller.setArrowheadEnd(value);
    updateProp(terminal === 'start' ? 'arrowheadStart' : 'arrowheadEnd', value);
  };

  return (
    <div style={panelStyle} onPointerDown={event => event.stopPropagation()}>
      {selected && selectedWorld && selectedLocal && !editingShape ? (
        <div>
          <div style={sectionTitleStyle}>Position and Size</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <NumericField label="X" value={selectedWorld.minX}
              onCommit={x => editor.setShapePrecision(selected.id as ShapeId, { x })} />
            <NumericField label="Y" value={selectedWorld.minY}
              onCommit={y => editor.setShapePrecision(selected.id as ShapeId, { y })} />
            <NumericField label="W" value={selectedLocal.w} disabled={!canResizePrecisely}
              onCommit={w => editor.setShapePrecision(selected.id as ShapeId, { w, lockAspect })} />
            <NumericField label="H" value={selectedLocal.h} disabled={!canResizePrecisely}
              onCommit={h => editor.setShapePrecision(selected.id as ShapeId, { h, lockAspect })} />
            <NumericField label="°" value={selected.rotation * 180 / Math.PI} disabled={selected.type === 'arrow'}
              onCommit={degrees => editor.setShapePrecision(selected.id as ShapeId, { rotation: degrees * Math.PI / 180 })} />
            <div style={{ display: 'flex', gap: 4 }}>
              <button title={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'} aria-label="Aspect ratio"
                onClick={() => setLockAspect(value => !value)} style={{ ...buttonStyleSmall, flex: 1 }}>
                {lockAspect ? <FiLock size={13} /> : <FiUnlock size={13} />}
              </button>
              <button title="Reset rotation" aria-label="Reset rotation"
                onClick={() => editor.setShapePrecision(selected.id as ShapeId, { rotation: 0 })}
                style={{ ...buttonStyleSmall, flex: 1 }}><FiRotateCcw size={13} /></button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedShapes.length >= 2 && !editingShape ? (
        <div>
          <div style={sectionTitleStyle}>Arrange</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            <button title="Align left" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedShapes.map(s => s.id as ShapeId), 'left')}>Left</button>
            <button title="Align horizontal centers" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedShapes.map(s => s.id as ShapeId), 'center-x')}>H Mid</button>
            <button title="Align right" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedShapes.map(s => s.id as ShapeId), 'right')}>Right</button>
            <button title="Align top" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedShapes.map(s => s.id as ShapeId), 'top')}>Top</button>
            <button title="Align vertical centers" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedShapes.map(s => s.id as ShapeId), 'center-y')}>V Mid</button>
            <button title="Align bottom" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedShapes.map(s => s.id as ShapeId), 'bottom')}>Bottom</button>
            <button title="Distribute horizontal gaps" disabled={selectedShapes.length < 3} style={buttonStyleSmall}
              onClick={() => editor.distributeShapes(selectedShapes.map(s => s.id as ShapeId), 'horizontal')}>H Gap</button>
            <button title="Distribute vertical gaps" disabled={selectedShapes.length < 3} style={buttonStyleSmall}
              onClick={() => editor.distributeShapes(selectedShapes.map(s => s.id as ShapeId), 'vertical')}>V Gap</button>
            <button title="Tidy into a row" style={buttonStyleSmall}
              onClick={() => editor.tidyShapes(selectedShapes.map(s => s.id as ShapeId), 'row')}>Tidy</button>
            <button title="Match width" disabled={!canMatchSizes} style={buttonStyleSmall}
              onClick={() => editor.matchShapeSizes(selectedShapes.map(s => s.id as ShapeId), 'width')}>Width</button>
            <button title="Match height" disabled={!canMatchSizes} style={buttonStyleSmall}
              onClick={() => editor.matchShapeSizes(selectedShapes.map(s => s.id as ShapeId), 'height')}>Height</button>
            <button title="Match size" disabled={!canMatchSizes} style={buttonStyleSmall}
              onClick={() => editor.matchShapeSizes(selectedShapes.map(s => s.id as ShapeId), 'both')}>Size</button>
          </div>
        </div>
      ) : null}

      {!textOnly && (shapes.length === 0 || supportedKeys.has('color')) ? (
        <div>
          <div style={sectionTitleStyle}>Stroke / Fill Color</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {Object.entries(TLDRAW_COLORS).map(([name, hex]) => {
              const active = color === name || color === hex;
              return (
                <button
                  key={name}
                  onClick={() => updateProp('color', name)}
                  title={name}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: `2px solid ${active ? wbTheme.accent : 'transparent'}`,
                    background: hex,
                    cursor: 'pointer',
                    boxShadow: active ? `0 0 0 1px ${wbTheme.surface} inset` : 'none',
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {((textOnly && supportsTextColor) || (!textOnly && (shapes.length === 0 || supportedKeys.has('labelColor')))) ? (
        <div>
          <div style={sectionTitleStyle}>Text Color</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {Object.entries(TLDRAW_COLORS).map(([name, hex]) => {
              const currentTextColor = textOnly ? textColor : labelColor;
              const active = currentTextColor === name || currentTextColor === hex;
              return (
                <button
                  key={name}
                  onClick={() => textOnly ? updateTextColor(name) : updateProp('labelColor', name)}
                  title={name}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: `2px solid ${active ? wbTheme.accent : 'transparent'}`,
                    background: hex,
                    cursor: 'pointer',
                    boxShadow: active ? `0 0 0 1px ${wbTheme.surface} inset` : 'none',
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {!textOnly && (shapes.length === 0 || supportedKeys.has('fillStyle')) ? (
        <div>
          <div style={sectionTitleStyle}>Fill</div>
          <div style={rowStyle}>
            <IconButton active={fillStyle === 'none'} onClick={() => updateProp('fillStyle', 'none')}>None</IconButton>
            <IconButton active={fillStyle === 'semi'} onClick={() => updateProp('fillStyle', 'semi')}>Semi</IconButton>
            <IconButton active={fillStyle === 'solid'} onClick={() => updateProp('fillStyle', 'solid')}>Solid</IconButton>
            <IconButton active={fillStyle === 'pattern'} onClick={() => updateProp('fillStyle', 'pattern')}>Pattern</IconButton>
            <IconButton active={fillStyle === 'lined'} onClick={() => updateProp('fillStyle', 'lined')}>Lined</IconButton>
          </div>
        </div>
      ) : null}

      {!textOnly && (shapes.length === 0 || supportedKeys.has('strokeWidth')) ? (
        <div>
          <div style={sectionTitleStyle}>Stroke Width</div>
          <div style={rowStyle}>
            <IconButton active={strokeWidth === 'thin'} onClick={() => updateProp('strokeWidth', 'thin')}>S</IconButton>
            <IconButton active={strokeWidth === 'medium'} onClick={() => updateProp('strokeWidth', 'medium')}>M</IconButton>
            <IconButton active={strokeWidth === 'thick'} onClick={() => updateProp('strokeWidth', 'thick')}>L</IconButton>
            <IconButton active={strokeWidth === 'xl'} onClick={() => updateProp('strokeWidth', 'xl')}>XL</IconButton>
          </div>
        </div>
      ) : null}

      {!textOnly && (shapes.length === 0 || supportedKeys.has('strokeStyle')) ? (
        <div>
          <div style={sectionTitleStyle}>Stroke Style</div>
          <div style={rowStyle}>
            <IconButton active={strokeStyle === 'solid'} onClick={() => updateProp('strokeStyle', 'solid')}>Solid</IconButton>
            <IconButton active={strokeStyle === 'dashed'} onClick={() => updateProp('strokeStyle', 'dashed')}>Dash</IconButton>
            <IconButton active={strokeStyle === 'dotted'} onClick={() => updateProp('strokeStyle', 'dotted')}>Dot</IconButton>
          </div>
        </div>
      ) : null}

      {!textOnly && supportedKeys.has('routeStyle') ? (
        <div>
          <div style={sectionTitleStyle}>Arrow Route</div>
          <div style={rowStyle}>
            <IconButton active={routeStyle === 'curve'} onClick={() => updateArrowRoute('curve')}>Curve</IconButton>
            <IconButton active={routeStyle === 'ortho'} onClick={() => updateArrowRoute('ortho')}>Ortho</IconButton>
            <IconButton active={routeStyle === 'smart'} onClick={() => updateArrowRoute('smart')}>Smart</IconButton>
          </div>
        </div>
      ) : null}

      {!textOnly && supportedKeys.has('arrowheadStart') ? (
        <div>
          <div style={sectionTitleStyle}>Start Arrowhead</div>
          <div style={rowStyle}>
            <IconButton active={arrowheadStart === 'none'} onClick={() => updateArrowhead('start', 'none')}>None</IconButton>
            <IconButton active={arrowheadStart === 'arrow'} onClick={() => updateArrowhead('start', 'arrow')}>Arrow</IconButton>
          </div>
        </div>
      ) : null}

      {!textOnly && supportedKeys.has('arrowheadEnd') ? (
        <div>
          <div style={sectionTitleStyle}>End Arrowhead</div>
          <div style={rowStyle}>
            <IconButton active={arrowheadEnd === 'none'} onClick={() => updateArrowhead('end', 'none')}>None</IconButton>
            <IconButton active={arrowheadEnd === 'arrow'} onClick={() => updateArrowhead('end', 'arrow')}>Arrow</IconButton>
          </div>
        </div>
      ) : null}

      {supportedKeys.has('font') ? (
        <div>
          <div style={sectionTitleStyle}>Font Family</div>
          <div style={rowStyle}>
            <IconButton active={font === 'draw'} onClick={() => updateProp('font', 'draw')} style={{ fontFamily: '"Shantell Sans", cursive' }}>Draw</IconButton>
            <IconButton active={font === 'sans'} onClick={() => updateProp('font', 'sans')} style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>Sans</IconButton>
            <IconButton active={font === 'serif'} onClick={() => updateProp('font', 'serif')} style={{ fontFamily: 'Georgia, serif' }}>Serif</IconButton>
            <IconButton active={font === 'mono'} onClick={() => updateProp('font', 'mono')} style={{ fontFamily: '"Fira Code", monospace' }}>Mono</IconButton>
          </div>
        </div>
      ) : null}

      {supportedKeys.has('fontSize') ? (
        <div>
          <div style={sectionTitleStyle}>Font Size</div>
          <div style={rowStyle}>
            <IconButton active={fontSize === 'sm'} onClick={() => updateProp('fontSize', 'sm')}>S</IconButton>
            <IconButton active={fontSize === 'md'} onClick={() => updateProp('fontSize', 'md')}>M</IconButton>
            <IconButton active={fontSize === 'lg'} onClick={() => updateProp('fontSize', 'lg')}>L</IconButton>
            <IconButton active={fontSize === 'xl'} onClick={() => updateProp('fontSize', 'xl')}>XL</IconButton>
          </div>
        </div>
      ) : null}

      {supportedKeys.has('textAlign') ? (
        <div>
          <div style={sectionTitleStyle}>Text Align</div>
          <div style={rowStyle}>
            <IconButton active={textAlign === 'left'} onClick={() => updateProp('textAlign', 'left')}>Left</IconButton>
            <IconButton active={textAlign === 'center'} onClick={() => updateProp('textAlign', 'center')}>Center</IconButton>
            <IconButton active={textAlign === 'right'} onClick={() => updateProp('textAlign', 'right')}>Right</IconButton>
          </div>
        </div>
      ) : null}

      {supportedKeys.has('clipContent') ? (
        <div>
          <div style={sectionTitleStyle}>Frame Content</div>
          <div style={rowStyle}>
            <IconButton active={!clipContent} onClick={() => updateProp('clipContent', false)}>Overflow</IconButton>
            <IconButton active={clipContent === true} onClick={() => updateProp('clipContent', true)}>Clip</IconButton>
          </div>
        </div>
      ) : null}

      <div>
        <div style={sectionTitleStyle}>Grid and Snapping</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
          <label><input type="checkbox" checked={snapSettings.showGrid}
            onChange={event => editor.snapping.updateSettings({ showGrid: event.target.checked })} /> Grid</label>
          <label><input type="checkbox" checked={snapSettings.snapToGrid}
            onChange={event => editor.snapping.updateSettings({ snapToGrid: event.target.checked })} /> Snap grid</label>
          <label><input type="checkbox" checked={snapSettings.snapToObjects}
            onChange={event => editor.snapping.updateSettings({ snapToObjects: event.target.checked })} /> Objects</label>
          <NumericField label="Grid" value={snapSettings.gridSize}
            onCommit={gridSize => editor.snapping.updateSettings({ gridSize: Math.max(2, gridSize) })} />
        </div>
      </div>
    </div>
  );
}
