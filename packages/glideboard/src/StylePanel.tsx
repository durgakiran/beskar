import React, { useMemo } from 'react';
import {
  TLDRAW_COLORS,
  type ShapeId,
} from '@durgakiran/glideline';
import { useSelectedShapes } from './hooks/useSelectedShapes';
import {
  setArrowRouteStyle,
  setArrowheadEnd,
  setArrowheadStart,
  wbEditor,
  type ArrowRouteStyle,
  type ArrowheadStyle,
} from './editor';
import { wbTheme } from './theme';

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

function IconButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
    shapes.forEach(shape => {
      Object.keys(shape.props).forEach(key => keys.add(key));
    });
    return keys;
  }, [shapes]);

  if (shapes.length === 0) return null;

  const getCommonValue = (key: string) => {
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
    wbEditor.history.batch('Style change', () => {
      for (const shape of shapes) {
        if (key in shape.props) {
          wbEditor.updateShape(shape.id as ShapeId, {
            props: { ...shape.props, [key]: value },
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

  const updateArrowRoute = (value: ArrowRouteStyle) => {
    setArrowRouteStyle(value);
    updateProp('routeStyle', value);
  };

  const updateArrowhead = (terminal: 'start' | 'end', value: ArrowheadStyle) => {
    if (terminal === 'start') setArrowheadStart(value);
    else setArrowheadEnd(value);
    updateProp(terminal === 'start' ? 'arrowheadStart' : 'arrowheadEnd', value);
  };

  return (
    <div style={panelStyle} onPointerDown={event => event.stopPropagation()}>
      {supportedKeys.has('color') ? (
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

      {supportedKeys.has('labelColor') ? (
        <div>
          <div style={sectionTitleStyle}>Text Color</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {Object.entries(TLDRAW_COLORS).map(([name, hex]) => {
              const active = labelColor === name || labelColor === hex;
              return (
                <button
                  key={name}
                  onClick={() => updateProp('labelColor', name)}
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

      {supportedKeys.has('fillStyle') ? (
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

      {supportedKeys.has('strokeWidth') ? (
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

      {supportedKeys.has('strokeStyle') ? (
        <div>
          <div style={sectionTitleStyle}>Stroke Style</div>
          <div style={rowStyle}>
            <IconButton active={strokeStyle === 'solid'} onClick={() => updateProp('strokeStyle', 'solid')}>Solid</IconButton>
            <IconButton active={strokeStyle === 'dashed'} onClick={() => updateProp('strokeStyle', 'dashed')}>Dash</IconButton>
            <IconButton active={strokeStyle === 'dotted'} onClick={() => updateProp('strokeStyle', 'dotted')}>Dot</IconButton>
          </div>
        </div>
      ) : null}

      {supportedKeys.has('routeStyle') ? (
        <div>
          <div style={sectionTitleStyle}>Arrow Route</div>
          <div style={rowStyle}>
            <IconButton active={routeStyle === 'curve'} onClick={() => updateArrowRoute('curve')}>Curve</IconButton>
            <IconButton active={routeStyle === 'ortho'} onClick={() => updateArrowRoute('ortho')}>Ortho</IconButton>
            <IconButton active={routeStyle === 'smart'} onClick={() => updateArrowRoute('smart')}>Smart</IconButton>
          </div>
        </div>
      ) : null}

      {supportedKeys.has('arrowheadStart') ? (
        <div>
          <div style={sectionTitleStyle}>Start Arrowhead</div>
          <div style={rowStyle}>
            <IconButton active={arrowheadStart === 'none'} onClick={() => updateArrowhead('start', 'none')}>None</IconButton>
            <IconButton active={arrowheadStart === 'arrow'} onClick={() => updateArrowhead('start', 'arrow')}>Arrow</IconButton>
          </div>
        </div>
      ) : null}

      {supportedKeys.has('arrowheadEnd') ? (
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
            <IconButton active={font === 'draw'} onClick={() => updateProp('font', 'draw')}>Draw</IconButton>
            <IconButton active={font === 'sans'} onClick={() => updateProp('font', 'sans')}>Sans</IconButton>
            <IconButton active={font === 'serif'} onClick={() => updateProp('font', 'serif')}>Serif</IconButton>
            <IconButton active={font === 'mono'} onClick={() => updateProp('font', 'mono')}>Mono</IconButton>
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
    </div>
  );
}
