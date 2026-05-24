import React, { useMemo } from 'react';
import { useSelectedShapes } from './hooks/useSelectedShapes';
import { setArrowRouteStyle, setArrowheadEnd, setArrowheadStart, wbEditor } from './editor';
import { TLDRAW_COLORS } from '../../../glideline/src/styles';
import type { ShapeId } from '../../../glideline/src/types';
import type { ArrowheadStyle, ArrowRouteStyle } from '../../../glideline/src/shapes/ArrowUtil';

const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 12,
  width: 240,
  background: '#1e1e2e',
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  color: '#cdd6f4',
  fontFamily: 'sans-serif',
  zIndex: 100,
  userSelect: 'none',
  pointerEvents: 'auto',
};

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#6c7086',
  marginBottom: 8,
  fontWeight: 600,
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 4,
};

function IconButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        height: 28,
        borderRadius: 4,
        border: '1px solid ' + (active ? '#89b4fa' : '#313244'),
        background: active ? '#89b4fa22' : 'transparent',
        color: active ? '#89b4fa' : '#bac2de',
        cursor: 'pointer',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

export function StylePanel() {
  const shapes = useSelectedShapes();

  const supportedKeys = useMemo(() => {
    const keys = new Set<string>();
    shapes.forEach(s => {
      Object.keys(s.props).forEach(k => keys.add(k));
    });
    return keys;
  }, [shapes]);

  if (shapes.length === 0) return null;

  // Compute common values
  const getCommonValue = (key: string) => {
    let val: any = undefined;
    let first = true;
    for (const s of shapes) {
      if (key in s.props) {
        if (first) {
          val = s.props[key];
          first = false;
        } else if (val !== s.props[key]) {
          return undefined; // Mixed
        }
      }
    }
    return val;
  };

  const updateProp = (key: string, value: any) => {
    wbEditor.history.batch('Style change', () => {
      for (const s of shapes) {
        if (key in s.props) {
          wbEditor.updateShape(s.id as ShapeId, {
            props: { ...s.props, [key]: value }
          });
        }
      }
    });
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

  const updateArrowRouteStyle = (value: ArrowRouteStyle) => {
    setArrowRouteStyle(value);
    updateProp('routeStyle', value);
  };

  const updateArrowhead = (terminal: 'start' | 'end', value: ArrowheadStyle) => {
    if (terminal === 'start') setArrowheadStart(value);
    else setArrowheadEnd(value);
    updateProp(terminal === 'start' ? 'arrowheadStart' : 'arrowheadEnd', value);
  };

  return (
    <div style={PANEL_STYLE} onPointerDown={e => e.stopPropagation()}>
      {/* COLOR */}
      {supportedKeys.has('color') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>Stroke / Fill Color</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {Object.entries(TLDRAW_COLORS).map(([name, hex]) => {
              const active = color === name || color === hex;
              return (
                <button
                  key={name}
                  onClick={() => updateProp('color', name)}
                  title={name}
                  style={{
                    width: 24, height: 24, borderRadius: 4,
                    border: '2px solid ' + (active ? '#cba6f7' : 'transparent'),
                    background: hex as any,
                    cursor: 'pointer',
                    boxShadow: active ? '0 0 0 1px #1e1e2e inset' : 'none',
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* LABEL COLOR */}
      {supportedKeys.has('labelColor') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>Text Color</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {Object.entries(TLDRAW_COLORS).map(([name, hex]) => {
              const active = labelColor === name || labelColor === hex;
              return (
                <button
                  key={name}
                  onClick={() => updateProp('labelColor', name)}
                  title={name}
                  style={{
                    width: 24, height: 24, borderRadius: 4,
                    border: '2px solid ' + (active ? '#cba6f7' : 'transparent'),
                    background: hex as any,
                    cursor: 'pointer',
                    boxShadow: active ? '0 0 0 1px #1e1e2e inset' : 'none',
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* FILL */}
      {supportedKeys.has('fillStyle') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>Fill</div>
          <div style={ROW_STYLE}>
            <IconButton active={fillStyle === 'none'} onClick={() => updateProp('fillStyle', 'none')}>None</IconButton>
            <IconButton active={fillStyle === 'semi'} onClick={() => updateProp('fillStyle', 'semi')}>Semi</IconButton>
            <IconButton active={fillStyle === 'solid'} onClick={() => updateProp('fillStyle', 'solid')}>Solid</IconButton>
          </div>
        </div>
      )}

      {/* STROKE WIDTH */}
      {supportedKeys.has('strokeWidth') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>Stroke Width</div>
          <div style={ROW_STYLE}>
            <IconButton active={strokeWidth === 'thin'} onClick={() => updateProp('strokeWidth', 'thin')}>S</IconButton>
            <IconButton active={strokeWidth === 'medium'} onClick={() => updateProp('strokeWidth', 'medium')}>M</IconButton>
            <IconButton active={strokeWidth === 'thick'} onClick={() => updateProp('strokeWidth', 'thick')}>L</IconButton>
            <IconButton active={strokeWidth === 'xl'} onClick={() => updateProp('strokeWidth', 'xl')}>XL</IconButton>
          </div>
        </div>
      )}

      {/* STROKE STYLE */}
      {supportedKeys.has('strokeStyle') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>Stroke Style</div>
          <div style={ROW_STYLE}>
            <IconButton active={strokeStyle === 'solid'} onClick={() => updateProp('strokeStyle', 'solid')}>Solid</IconButton>
            <IconButton active={strokeStyle === 'dashed'} onClick={() => updateProp('strokeStyle', 'dashed')}>Dash</IconButton>
            <IconButton active={strokeStyle === 'dotted'} onClick={() => updateProp('strokeStyle', 'dotted')}>Dot</IconButton>
          </div>
        </div>
      )}

      {supportedKeys.has('routeStyle') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>Arrow Route</div>
          <div style={ROW_STYLE}>
            <IconButton active={routeStyle === 'curve'} onClick={() => updateArrowRouteStyle('curve')}>Curve</IconButton>
            <IconButton active={routeStyle === 'ortho'} onClick={() => updateArrowRouteStyle('ortho')}>Ortho</IconButton>
            <IconButton active={routeStyle === 'smart'} onClick={() => updateArrowRouteStyle('smart')}>Smart</IconButton>
          </div>
        </div>
      )}

      {supportedKeys.has('arrowheadStart') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>Start Arrowhead</div>
          <div style={ROW_STYLE}>
            <IconButton active={arrowheadStart === 'none'} onClick={() => updateArrowhead('start', 'none')}>None</IconButton>
            <IconButton active={arrowheadStart === 'arrow'} onClick={() => updateArrowhead('start', 'arrow')}>Arrow</IconButton>
          </div>
        </div>
      )}

      {supportedKeys.has('arrowheadEnd') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>End Arrowhead</div>
          <div style={ROW_STYLE}>
            <IconButton active={arrowheadEnd === 'none'} onClick={() => updateArrowhead('end', 'none')}>None</IconButton>
            <IconButton active={arrowheadEnd === 'arrow'} onClick={() => updateArrowhead('end', 'arrow')}>Arrow</IconButton>
          </div>
        </div>
      )}

      {/* FONT */}
      {supportedKeys.has('font') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>Font Family</div>
          <div style={ROW_STYLE}>
            <IconButton active={font === 'draw'} onClick={() => updateProp('font', 'draw')}>Draw</IconButton>
            <IconButton active={font === 'sans'} onClick={() => updateProp('font', 'sans')}>Sans</IconButton>
            <IconButton active={font === 'serif'} onClick={() => updateProp('font', 'serif')}>Serif</IconButton>
            <IconButton active={font === 'mono'} onClick={() => updateProp('font', 'mono')}>Mono</IconButton>
          </div>
        </div>
      )}

      {/* FONT SIZE */}
      {supportedKeys.has('fontSize') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>Font Size</div>
          <div style={ROW_STYLE}>
            <IconButton active={fontSize === 'sm'} onClick={() => updateProp('fontSize', 'sm')}>S</IconButton>
            <IconButton active={fontSize === 'md'} onClick={() => updateProp('fontSize', 'md')}>M</IconButton>
            <IconButton active={fontSize === 'lg'} onClick={() => updateProp('fontSize', 'lg')}>L</IconButton>
            <IconButton active={fontSize === 'xl'} onClick={() => updateProp('fontSize', 'xl')}>XL</IconButton>
          </div>
        </div>
      )}

      {/* TEXT ALIGN */}
      {supportedKeys.has('textAlign') && (
        <div>
          <div style={SECTION_TITLE_STYLE}>Text Align</div>
          <div style={ROW_STYLE}>
            <IconButton active={textAlign === 'left'} onClick={() => updateProp('textAlign', 'left')}>Left</IconButton>
            <IconButton active={textAlign === 'center'} onClick={() => updateProp('textAlign', 'center')}>Center</IconButton>
            <IconButton active={textAlign === 'right'} onClick={() => updateProp('textAlign', 'right')}>Right</IconButton>
          </div>
        </div>
      )}
    </div>
  );
}
