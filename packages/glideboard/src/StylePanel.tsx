import React from 'react';
import {
  FiAlignCenter,
  FiAlignLeft,
  FiAlignRight,
  FiDownload,
  FiLock,
  FiRefreshCw,
  FiRotateCcw,
  FiUnlock,
  FiX,
} from 'react-icons/fi';
import {
  TLDRAW_COLORS,
  STROKE_STYLES,
  FONT_FAMILIES,
  boardFontStyle,
  type StrokeStyle,
  type GlideShape,
  type ShapeId,
} from '@durgakiran/glideline';
import { useSelectedShapes } from './hooks/useSelectedShapes.js';
import { useGlideboardController } from './GlideboardContext.js';
import type {
  ArrowRouteStyle,
  ArrowheadStyle,
} from './GlideboardController.js';
import { boardObjectName, creationShapeType } from './Toolbar.js';
import { wbTheme } from './theme.js';
import { useSignalValue } from './useSignalValue.js';
import { GLIDEBOARD_ASSET_ACCEPT, readAssetImportRequest } from './AssetImportPanel.js';

function assetDownloadName(mimeType: string, supplied?: string): string {
  if (supplied) return supplied;
  const extension = mimeType === 'image/jpeg' ? 'jpg'
    : mimeType === 'image/svg+xml' ? 'svg'
      : mimeType.split('/')[1] || 'bin';
  return `glideboard-asset.${extension}`;
}

function AssetLifecycleCommands({ shapeId }: { shapeId: ShapeId }) {
  const controller = useGlideboardController();
  const readOnly = useSignalValue(controller.readOnlySignal) ?? false;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [state, setState] = React.useState<
    | { kind: 'idle' | 'busy' | 'success'; message: string }
    | { kind: 'error'; message: string; retry: { kind: 'replace'; file: File } | { kind: 'download' } }
  >({ kind: 'idle', message: '' });

  const replace = async (file: File) => {
    setState({ kind: 'busy', message: `Replacing with ${file.name}...` });
    try {
      const request = await readAssetImportRequest(file, { x: 0, y: 0 }, controller.assetLimits);
      await controller.replaceAsset(shapeId, request);
      setState({ kind: 'success', message: `Replaced with ${file.name}.` });
    } catch (error) {
      if ((error as { name?: unknown })?.name === 'AbortError') {
        setState({ kind: 'idle', message: '' });
        return;
      }
      const message = error instanceof Error ? error.message : 'Asset replacement failed.';
      setState({ kind: 'error', message: `Replace failed: ${message}`, retry: { kind: 'replace', file } });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const download = async () => {
    setState({ kind: 'busy', message: 'Preparing download...' });
    try {
      const result = await controller.downloadAsset(shapeId);
		const blob = new Blob([Uint8Array.from(result.bytes)], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = assetDownloadName(result.mimeType, result.fileName);
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setState({ kind: 'success', message: 'Download started.' });
    } catch (error) {
      if ((error as { name?: unknown })?.name === 'AbortError') {
        setState({ kind: 'idle', message: '' });
        return;
      }
      const message = error instanceof Error ? error.message : 'Asset download failed.';
      setState({ kind: 'error', message: `Download failed: ${message}`, retry: { kind: 'download' } });
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={GLIDEBOARD_ASSET_ACCEPT}
        aria-label="Choose replacement image"
        hidden
        disabled={readOnly || state.kind === 'busy'}
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          if (file) void replace(file);
        }}
      />
      <div role="group" aria-label="Asset commands" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button type="button" style={buttonStyleSmall} disabled={readOnly || state.kind === 'busy'}
          onClick={() => inputRef.current?.click()}>
          <FiRefreshCw aria-hidden size={13} style={{ marginRight: 5 }} /> Replace
        </button>
        <button type="button" style={buttonStyleSmall} disabled={state.kind === 'busy'} onClick={() => void download()}>
          <FiDownload aria-hidden size={13} style={{ marginRight: 5 }} /> Download
        </button>
      </div>
      {state.kind !== 'idle' ? (
        <div role={state.kind === 'error' ? 'alert' : 'status'} aria-live="polite" style={{ marginTop: 6, fontSize: 10,
          color: state.kind === 'error' ? wbTheme.dangerText : wbTheme.textSoft }}>
          <div>{state.message}</div>
          {state.kind === 'error' ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button type="button" style={buttonStyleSmall} onClick={() => {
                if (state.retry.kind === 'replace') void replace(state.retry.file);
                else void download();
              }}>
                <FiRefreshCw aria-hidden size={12} style={{ marginRight: 4 }} />
                Retry {state.retry.kind === 'replace' ? 'replace' : 'download'}
              </button>
              <button type="button" aria-label={`Dismiss ${state.retry.kind} error`} style={buttonStyleSmall}
                onClick={() => setState({ kind: 'idle', message: '' })}>
                <FiX aria-hidden size={13} />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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

// Five compact cells need 148px including grid padding.
const optionGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 28px)',
  gridAutoRows: '28px',
  padding: 4,
  overflow: 'hidden',
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  height: 26,
  boxSizing: 'border-box',
  borderRadius: 4,
  border: `1px solid ${wbTheme.border}`,
  background: wbTheme.surfaceInset,
  color: wbTheme.text,
  padding: '0 6px',
  fontSize: 11,
};

function IconButton({ active, onClick, style, children }: { active: boolean; onClick: () => void; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <button
      aria-pressed={active}
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

function VisualStyleButton({
  active,
  compact = false,
  label,
  onClick,
  children,
}: {
  active: boolean;
  compact?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="glideboard-style-option"
      data-isactive={active}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      style={{
        width: compact ? 24 : 28,
        height: compact ? 24 : 28,
        alignSelf: 'center',
        justifySelf: 'center',
        border: 0,
        borderRadius: 6,
        background: 'transparent',
        color: active ? wbTheme.accentText : wbTheme.textMuted,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

const ROUTE_OPTIONS = [
  { value: 'curve', label: 'Curve', path: 'M2 15C5 15 6 3 18 3' },
  { value: 'ortho', label: 'Ortho', path: 'M2 15H9V4H18' },
  { value: 'smart', label: 'Smart', path: 'M2 13H4V4H16V13H18' },
] as const;

const ARROWHEAD_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
] as const;

function ArrowheadPreview({ terminal, style }: { terminal: 'start' | 'end'; style: ArrowheadStyle }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 10H18" />
      {style === 'arrow' && <path d={terminal === 'start' ? 'M6 6L2 10L6 14' : 'M14 6L18 10L14 14'} />}
    </svg>
  );
}

function StyleOptionStyles() {
  return (
    <style>{`
      .glideboard-style-option {
        position: relative;
        outline: none;
      }
      .glideboard-style-option::after {
        content: '';
        position: absolute;
        inset: 2px;
        z-index: 0;
        border-radius: 5px;
        background: var(--gray-3, #f3f4f6);
        opacity: 0;
        pointer-events: none;
      }
      .glideboard-style-option > * {
        position: relative;
        z-index: 1;
      }
      .glideboard-style-option[data-isactive='true']::after {
        background: var(--accent-a3, rgba(37, 99, 235, 0.12));
        opacity: 1;
      }
      @media (hover: hover) {
        .glideboard-style-option:not(:disabled):hover::after {
          opacity: 1;
        }
      }
      .glideboard-style-option:focus-visible {
        border-radius: 6px;
        outline: 2px solid var(--accent-9, #2563eb);
        outline-offset: -4px;
      }
      .glideboard-opacity-slider {
        appearance: none;
        height: 18px;
        margin: 0;
        background: transparent;
        cursor: pointer;
      }
      .glideboard-opacity-slider::-webkit-slider-runnable-track {
        height: 3px;
        border-radius: 999px;
        background: linear-gradient(to right,
          var(--accent-9, #2563eb) 0 var(--glideboard-opacity-percent),
          var(--gray-6, #d1d5db) var(--glideboard-opacity-percent) 100%);
      }
      .glideboard-opacity-slider::-webkit-slider-thumb {
        appearance: none;
        width: 14px;
        height: 14px;
        margin-top: -5.5px;
        border: 2px solid var(--accent-9, #2563eb);
        border-radius: 50%;
        background: var(--accent-9, #2563eb);
      }
      .glideboard-opacity-slider::-moz-range-track {
        height: 3px;
        border-radius: 999px;
        background: var(--gray-6, #d1d5db);
      }
      .glideboard-opacity-slider::-moz-range-progress {
        height: 3px;
        border-radius: 999px;
        background: var(--accent-9, #2563eb);
      }
      .glideboard-opacity-slider::-moz-range-thumb {
        width: 10px;
        height: 10px;
        border: 2px solid var(--accent-9, #2563eb);
        border-radius: 50%;
        background: var(--accent-9, #2563eb);
      }
    `}</style>
  );
}

function ColorOptionButton({
  name,
  hex,
  active,
  onClick,
}: {
  name: string;
  hex: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="glideboard-style-option"
      data-isactive={active}
      type="button"
      aria-label={name}
      title={name}
      aria-pressed={active}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        padding: 0,
        borderRadius: 6,
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <span style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: hex,
        boxShadow: active
          ? `0 0 0 2px ${wbTheme.surface}, 0 0 0 3px ${wbTheme.accent}`
          : name === 'white' ? `0 0 0 1px ${wbTheme.border}` : 'none',
      }} />
    </button>
  );
}

function FillPreview({ kind }: { kind: string }) {
  const color = wbTheme.text;
  return (
    <svg
      data-fill-preview={kind}
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      {kind === 'solid' ? <rect x="1" y="1" width="14" height="14" rx="2.5" fill={color} /> : null}
      {kind === 'semi' ? <rect x="1" y="1" width="14" height="14" rx="2.5" fill={color} opacity="0.34" /> : null}
      {kind === 'pattern' ? [4, 8, 12].flatMap(y => [4, 8, 12].map(x => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill={color} />
      ))) : null}
      {kind === 'lined' ? (
        <g stroke={color} strokeWidth="1.25" strokeLinecap="round">
          <line x1="2" y1="6" x2="6" y2="2" />
          <line x1="2" y1="12" x2="12" y2="2" />
          <line x1="4" y1="14" x2="14" y2="4" />
          <line x1="10" y1="14" x2="14" y2="10" />
        </g>
      ) : null}
      <rect x="1" y="1" width="14" height="14" rx="2.5" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function StrokePreview({ style, width = 2 }: { style: StrokeStyle; width?: number }) {
  if (style === 'sketch') {
    return <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true">
      <path d="M1 5 C5 1 10 9 15 5" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" />
    </svg>;
  }
  return <span style={{ width: 16, borderTop: `${width}px ${style} currentColor` }} />;
}

function OpacityControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | typeof MIXED;
  onChange: (value: number) => void;
}) {
  const mixed = value === MIXED;
  const sliderValue = mixed ? 0.6 : value;
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '1fr 34px', alignItems: 'center', gap: 4, width: '100%' }}>
      <input
        className="glideboard-opacity-slider"
        aria-label={label}
        type="range"
        min={0.1}
        max={1}
        step={0.1}
        value={sliderValue}
        aria-valuetext={mixed ? 'Mixed' : Math.round(sliderValue * 100) + '%'}
        onChange={event => onChange(Number(event.target.value))}
        onPointerUp={mixed ? event => onChange(Number(event.currentTarget.value)) : undefined}
        style={{
          width: '100%',
          '--glideboard-opacity-percent': mixed ? '0%' : sliderValue * 100 + '%',
        } as React.CSSProperties}
      />
      <output style={{ fontSize: 10, color: wbTheme.textSoft, textAlign: 'right' }}>
        {mixed ? 'Mixed' : Math.round(sliderValue * 100) + '%'}
      </output>
    </label>
  );
}

const MIXED = Symbol('mixed style');

function commonValue(values: readonly unknown[]): unknown {
  const first = values[0];
  return values.every(value => Object.is(value, first)) ? first : MIXED;
}

function StyleGroup({ label, value, grid = false, children }: {
  label: string;
  value: unknown;
  grid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <div style={{ ...sectionTitleStyle, margin: '4px 4px 2px', display: 'flex', justifyContent: 'space-between', gap: 4 }}>
        <span aria-hidden>{label}</span>
        {value === MIXED && <span style={{ textTransform: 'none', letterSpacing: 0 }}>Mixed</span>}
      </div>
      <div style={grid ? optionGridStyle : { ...rowStyle, flexWrap: 'wrap', padding: '0 4px' }}>{children}</div>
    </div>
  );
}

function CoreStyleControls({
  colorLabel,
  color,
  opacity,
  fillStyle,
  strokeWidth,
  strokePresentation,
  font,
  fontSize,
  textAlign,
  showColor,
  showOpacity,
  showFill,
  showStrokeStyle,
  showSketch,
  showStrokeWidth,
  showPressure,
  showFont,
  showFontSize,
  showTextAlign,
  onColor,
  onOpacity,
  onFill,
  onStrokePresentation,
  onStrokeWidth,
  onFont,
  onFontSize,
  onTextAlign,
}: {
  colorLabel: string;
  color: unknown;
  opacity: number | typeof MIXED;
  fillStyle: unknown;
  strokeWidth: unknown;
  strokePresentation: unknown;
  font: unknown;
  fontSize: unknown;
  textAlign: unknown;
  showColor: boolean;
  showOpacity: boolean;
  showFill: boolean;
  showStrokeStyle: boolean;
  showSketch: boolean;
  showStrokeWidth: boolean;
  showPressure: boolean;
  showFont: boolean;
  showFontSize: boolean;
  showTextAlign: boolean;
  onColor: (value: string) => void;
  onOpacity: (value: number) => void;
  onFill: (value: string) => void;
  onStrokePresentation: (value: StrokeStyle | 'pressure') => void;
  onStrokeWidth: (value: string) => void;
  onFont: (value: string) => void;
  onFontSize: (value: string) => void;
  onTextAlign: (value: string) => void;
}) {
  const hasAppearance = showFill || showStrokeStyle || showStrokeWidth;
  return (
    <div data-glideboard-role="core-style-controls" style={{ display: 'contents' }}>
      {showColor ? (
        <StyleGroup label={colorLabel} value={color} grid>
          {Object.entries(TLDRAW_COLORS).map(([name, hex]) => (
            <ColorOptionButton key={name} name={name} hex={hex}
              active={color === name || color === hex} onClick={() => onColor(name)} />
          ))}
        </StyleGroup>
      ) : null}
      {showOpacity ? (
        <StyleGroup label="Opacity" value={undefined}>
          <OpacityControl label="Opacity"
            value={opacity} onChange={onOpacity} />
        </StyleGroup>
      ) : null}
      {showOpacity && hasAppearance ? (
        <div data-glideboard-role="style-options-divider" data-divider-section="color-appearance"
          style={{ height: 1, background: wbTheme.border, marginTop: 4 }} />
      ) : null}
      {showFill ? (
        <StyleGroup label="Fill" value={fillStyle} grid>
          {(['none', 'semi', 'solid', 'pattern', 'lined'] as const).map(kind => (
            <VisualStyleButton key={kind} label={`${kind[0]!.toUpperCase()}${kind.slice(1)} fill`}
              active={fillStyle === kind} onClick={() => onFill(kind)}>
              <FillPreview kind={kind} />
            </VisualStyleButton>
          ))}
        </StyleGroup>
      ) : null}
      {showStrokeStyle ? (
        <StyleGroup label="Stroke style" value={strokePresentation} grid>
          {STROKE_STYLES.filter(kind => kind !== 'sketch' || showSketch).map(kind => (
            <VisualStyleButton key={kind} label={`${kind[0]!.toUpperCase()}${kind.slice(1)} stroke`}
              active={strokePresentation === kind} onClick={() => onStrokePresentation(kind)}>
              <StrokePreview style={kind} />
            </VisualStyleButton>
          ))}
          {showPressure ? (
            <VisualStyleButton label="Pressure-sensitive stroke" active={strokePresentation === 'pressure'}
              onClick={() => onStrokePresentation('pressure')}>
              <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
                <path d="M1 11C6 10 9 2 14 3C17 4 14 8 11 8C7 8 5 12 1 11Z" fill="currentColor" />
              </svg>
            </VisualStyleButton>
          ) : null}
        </StyleGroup>
      ) : null}
      {showStrokeWidth ? (
        <StyleGroup label="Stroke width" value={strokeWidth} grid>
          {([['thin', 1.5], ['medium', 2.5], ['thick', 3.5], ['xl', 5]] as const).map(([kind, width]) => (
            <VisualStyleButton key={kind}
              label={`${kind === 'xl' ? 'Extra large' : `${kind[0]!.toUpperCase()}${kind.slice(1)}`} stroke width`}
              active={strokeWidth === kind} onClick={() => onStrokeWidth(kind)}>
              <StrokePreview style="solid" width={width} />
            </VisualStyleButton>
          ))}
        </StyleGroup>
      ) : null}
      {showFont ? (
        <StyleGroup label="Font family" value={font} grid>
          <VisualStyleButton label="Draw font" active={font === 'draw'} onClick={() => onFont('draw')}>
            <span style={{ ...boardFontStyle(FONT_FAMILIES.draw), fontSize: 10 }}>Aa</span>
          </VisualStyleButton>
          <VisualStyleButton label="Sans font" active={font === 'sans'} onClick={() => onFont('sans')}>
            <span style={{ ...boardFontStyle(FONT_FAMILIES.sans), fontSize: 10 }}>Aa</span>
          </VisualStyleButton>
          <VisualStyleButton label="Serif font" active={font === 'serif'} onClick={() => onFont('serif')}>
            <span style={{ ...boardFontStyle(FONT_FAMILIES.serif), fontSize: 10 }}>Aa</span>
          </VisualStyleButton>
          <VisualStyleButton label="Mono font" active={font === 'mono'} onClick={() => onFont('mono')}>
            <span style={{ ...boardFontStyle(FONT_FAMILIES.mono), fontSize: 10 }}>Aa</span>
          </VisualStyleButton>
        </StyleGroup>
      ) : null}
      {showFontSize ? (
        <StyleGroup label="Font size" value={fontSize} grid>
          <VisualStyleButton label="Small font" active={fontSize === 'sm'} onClick={() => onFontSize('sm')}><span style={{ fontSize: 9 }}>S</span></VisualStyleButton>
          <VisualStyleButton label="Medium font" active={fontSize === 'md'} onClick={() => onFontSize('md')}><span style={{ fontSize: 10 }}>M</span></VisualStyleButton>
          <VisualStyleButton label="Large font" active={fontSize === 'lg'} onClick={() => onFontSize('lg')}><span style={{ fontSize: 11 }}>L</span></VisualStyleButton>
          <VisualStyleButton label="Extra large font" active={fontSize === 'xl'} onClick={() => onFontSize('xl')}><span style={{ fontSize: 11 }}>XL</span></VisualStyleButton>
        </StyleGroup>
      ) : null}
      {showTextAlign ? (
        <StyleGroup label="Alignment" value={textAlign} grid>
          <VisualStyleButton label="Align labels left" active={textAlign === 'left'} onClick={() => onTextAlign('left')}><FiAlignLeft size={14} /></VisualStyleButton>
          <VisualStyleButton label="Center labels" active={textAlign === 'center'} onClick={() => onTextAlign('center')}><FiAlignCenter size={14} /></VisualStyleButton>
          <VisualStyleButton label="Align labels right" active={textAlign === 'right'} onClick={() => onTextAlign('right')}><FiAlignRight size={14} /></VisualStyleButton>
        </StyleGroup>
      ) : null}
    </div>
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
    <label style={{ display: 'grid', gridTemplateColumns: '12px 48px', alignItems: 'center', gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: wbTheme.textSoft }}>{label}</span>
      <input
        data-glideboard-ignore-shortcuts
        aria-label={label}
        type="number"
        value={draft}
        disabled={disabled}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        style={inputStyle}
      />
    </label>
  );
}

export function PositionSizeBar() {
  const controller = useGlideboardController();
  const { editor } = controller;
  const selectedShapes = useSelectedShapes();
  const editingSession = useSignalValue(editor.textEditing.session);
  const labelTarget = useSignalValue(controller.textStyleTargetIdSignal);
  const selected = selectedShapes.length === 1 && !editingSession ? selectedShapes[0]! : null;
  if (!selected || (selected.id === labelTarget && selected.type !== 'text')
    || editor.isShapeEffectivelyLocked(selected.id as ShapeId)
    || (selected.type === 'arrow' && editor.getBindingsFromShape(selected.id as ShapeId).length > 0)) return null;
  const util = editor.getShapeUtil(selected);
  const canRotate = !util.hideRotateHandle(selected);

  const selectedWorld = editor.getShapeVisualWorldBounds(selected);
  const selectedLocal = editor.getShapeLocalBounds(selected.id as ShapeId);
  const selectedAsset = selected.type === 'raster-image' || selected.type === 'sanitized-svg'
    ? selected
    : null;
  const lockAspect = selectedAsset
    ? selectedAsset.props['aspectLocked'] !== false
    : selected.meta['aspectLocked'] === true;
  const canResizePrecisely = canResizeFromInspector(editor, selected);
  const toggleAspectLock = () => {
    if (selectedAsset) {
      editor.updateShape(selectedAsset.id as ShapeId, {
        props: { aspectLocked: !lockAspect },
      });
      return;
    }
    editor.updateShape(selected.id as ShapeId, {
      meta: { ...selected.meta, aspectLocked: !lockAspect },
    });
  };

  return (
    <div
      data-glideboard-role="position-size-bar"
      onPointerDown={event => event.stopPropagation()}
      style={{
        position: 'absolute',
        top: 12,
        right: 168,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        border: `1px solid ${wbTheme.border}`,
        borderRadius: 8,
        background: wbTheme.surface,
        boxShadow: wbTheme.shadow,
        color: wbTheme.text,
        pointerEvents: 'auto',
      }}
    >
      <NumericField label="X" value={selectedWorld.minX}
        onCommit={x => editor.setShapePrecision(selected.id as ShapeId, { x })} />
      <NumericField label="Y" value={selectedWorld.minY}
        onCommit={y => editor.setShapePrecision(selected.id as ShapeId, { y })} />
      {canResizePrecisely && <>
        <NumericField label="W" value={selectedLocal.w}
          onCommit={w => editor.setShapePrecision(selected.id as ShapeId, { w, lockAspect })} />
        <NumericField label="H" value={selectedLocal.h}
          onCommit={h => editor.setShapePrecision(selected.id as ShapeId, { h, lockAspect })} />
        <button title={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'} aria-label="Aspect ratio"
          aria-pressed={lockAspect} onClick={toggleAspectLock}
          style={{ ...buttonStyleSmall, width: 28, flex: '0 0 28px' }}>
          {lockAspect ? <FiLock size={13} /> : <FiUnlock size={13} />}
        </button>
      </>}
      {canRotate && <>
        <NumericField label="°" value={selected.rotation * 180 / Math.PI}
          onCommit={degrees => editor.setShapePrecision(selected.id as ShapeId, { rotation: degrees * Math.PI / 180 })} />
        <button title="Reset rotation" aria-label="Reset rotation"
          onClick={() => editor.setShapePrecision(selected.id as ShapeId, { rotation: 0 })}
          style={{ ...buttonStyleSmall, width: 28, flex: '0 0 28px' }}><FiRotateCcw size={13} /></button>
      </>}
    </div>
  );
}

function AltTextField({ assetId, value, onCommit }: {
  assetId: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const previousAssetIdRef = React.useRef(assetId);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    const assetChanged = previousAssetIdRef.current !== assetId;
    previousAssetIdRef.current = assetId;
    if (assetChanged || inputRef.current?.ownerDocument.activeElement !== inputRef.current) setDraft(value);
  }, [assetId, value]);
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: wbTheme.textSoft }}>
      Alt text
      <input
        ref={inputRef}
        data-glideboard-ignore-shortcuts
        aria-label="Alt text"
        type="text"
        maxLength={2000}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft); }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        style={inputStyle}
      />
    </label>
  );
}

type CropDraft = { x: string; y: string; w: string; h: string };

function RasterCropControls({
  assetId,
  crop,
  onCommit,
}: {
  assetId: string;
  crop: { x: number; y: number; w: number; h: number };
  onCommit: (crop: { x: number; y: number; w: number; h: number }) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const previousAssetIdRef = React.useRef(assetId);
  const toDraft = React.useCallback((value: typeof crop): CropDraft => ({
    x: String(value.x), y: String(value.y), w: String(value.w), h: String(value.h),
  }), []);
  const [draft, setDraft] = React.useState<CropDraft>(() => toDraft(crop));
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    const assetChanged = previousAssetIdRef.current !== assetId;
    previousAssetIdRef.current = assetId;
    const activeElement = rootRef.current?.ownerDocument.activeElement;
    if (assetChanged || !activeElement || !rootRef.current?.contains(activeElement)) {
      setDraft(toDraft(crop));
      setError('');
    }
  }, [assetId, crop.x, crop.y, crop.w, crop.h, toDraft]);

  const apply = () => {
    const next = {
      x: Number(draft.x), y: Number(draft.y), w: Number(draft.w), h: Number(draft.h),
    };
    if (!Object.values(next).every(Number.isFinite)
      || next.x < 0 || next.y < 0 || next.w <= 0 || next.h <= 0
      || next.x + next.w > 1 || next.y + next.h > 1) {
      setError('Crop must be a non-empty region within 0 to 1.');
      return;
    }
    setError('');
    onCommit(next);
  };
  const reset = () => {
    const next = { x: 0, y: 0, w: 1, h: 1 };
    setDraft(toDraft(next));
    setError('');
    onCommit(next);
  };

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {(['x', 'y', 'w', 'h'] as const).map(key => (
          <label key={key} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: wbTheme.textSoft }}>{key.toUpperCase()}</span>
            <input
              data-glideboard-ignore-shortcuts
              aria-label={`Crop ${key.toUpperCase()}`}
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={draft[key]}
              onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}
              style={inputStyle}
            />
          </label>
        ))}
      </div>
      {error ? <div role="alert" style={{ fontSize: 10, color: '#b42318' }}>{error}</div> : null}
      <div style={rowStyle}>
        <button type="button" style={{ ...buttonStyleSmall, flex: 1 }} onClick={apply}>Apply crop</button>
        <button type="button" style={{ ...buttonStyleSmall, flex: 1 }} onClick={reset}>
          <FiRotateCcw size={12} style={{ marginRight: 4 }} /> Reset crop
        </button>
      </div>
    </div>
  );
}

function textColorKey(shape: GlideShape): string {
  if (shape.type === 'sticky-note') return 'textColor';
  if (shape.type === 'text') return 'color';
  return 'labelColor';
}

function canResizeFromInspector(editor: ReturnType<typeof useGlideboardController>['editor'], shape: GlideShape) {
  return shape.type !== 'group' && !editor.getShapeUtil(shape).hideResizeHandles(shape);
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
  const activeTool = useSignalValue(editor.currentToolId) ?? 'select';
  const toolRoute = useSignalValue(controller.arrowRouteStyleSignal);
  const toolArrowheadStart = useSignalValue(controller.arrowheadStartSignal);
  const toolArrowheadEnd = useSignalValue(controller.arrowheadEndSignal);
  const isDefault = shapes.length === 0;
  const creationType = isDefault ? creationShapeType(activeTool) : null;
  const creationUtil = creationType ? editor.getShapeUtil(creationType) : null;
  const creationDefaults = creationUtil?.getDefaultProps() ?? {};
  const standaloneText = creationType === 'text' || shapes.length > 0 && shapes.every(shape => shape.type === 'text');
  const labelTarget = !standaloneText && Boolean(editingShape || (
    shapes.length === 1 && shapes[0]!.id === textStyleTargetId
  ));
  const textOnly = standaloneText || labelTarget;
  const selected = shapes.length === 1 ? shapes[0]! : null;
  const selectedAsset = selected?.type === 'raster-image' || selected?.type === 'sanitized-svg'
    ? selected
    : null;
  const locked = shapes.some(shape => editor.isShapeEffectivelyLocked(shape.id as ShapeId));
  const selectedIds = selectedShapes.map(shape => shape.id as ShapeId);
  const selectedIdSet = new Set(selectedIds);
  const transformRoots = selectedShapes.filter(shape => !editor.getAncestors(shape.id as ShapeId)
    .some(parent => selectedIdSet.has(parent.id as ShapeId)));
  const canArrange = !locked && transformRoots.length >= 2;
  const canMatchSizes = canArrange && transformRoots.every(shape => canResizeFromInspector(editor, shape));

  // Defaults also describe capabilities for records saved before a style was added.
  const shapeStyles = shapes.map(shape => ({
    ...editor.getShapeUtil(shape).getDefaultProps(),
    ...shape.props,
  }));
  const supports = (key: string) => isDefault ? key in creationDefaults
    : shapeStyles.every(styles => key in styles);
  const getCommonValue = (key: string) => isDefault ? activeStyles?.[key] ?? creationDefaults[key]
    : commonValue(shapeStyles.map(styles => styles[key]));

  const updateProps = (props: Record<string, unknown>, label = 'Style change') => {
    if (shapes.length > 0) {
      editor.batch(label, () => {
        for (const shape of shapes) editor.updateShape(shape.id as ShapeId, { props });
      });
    }
    editor.activeStyles.value = { ...editor.activeStyles.peek(), ...props };
  };
  const updateProp = (key: string, value: unknown) => updateProps({ [key]: value });
  const supportsTextColor = isDefault ? supports('color') : shapeStyles.every(
    (styles, index) => textColorKey(shapes[index]!) in styles,
  );
  const textColor = isDefault ? getCommonValue('color') : commonValue(
    shapeStyles.map((styles, index) => styles[textColorKey(shapes[index]!)]),
  );
  const updateTextColor = (value: string) => updateProp(selected ? textColorKey(selected) : 'color', value);
  const targetType = selected?.type ?? creationType;
  const bodyColorDefault = targetType === 'sticky-note' ? 'stickyNoteColor'
    : targetType === 'frame' ? 'frameColor'
    : 'color';
  const bodyColor = isDefault
    ? activeStyles?.[bodyColorDefault] ?? creationDefaults['color']
    : getCommonValue('color');
  const updateBodyColor = (value: string) => {
    if (!isDefault || bodyColorDefault === 'color') updateProp('color', value);
    if (bodyColorDefault !== 'color') {
      editor.activeStyles.value = { ...editor.activeStyles.peek(), [bodyColorDefault]: value };
    }
  };
  const opacity = getCommonValue('opacity');
  const routeStyle = isDefault ? toolRoute : getCommonValue('routeStyle');
  const arrowheadStart = isDefault ? toolArrowheadStart : getCommonValue('arrowheadStart');
  const arrowheadEnd = isDefault ? toolArrowheadEnd : getCommonValue('arrowheadEnd');
  const clipContent = getCommonValue('clipContent');
  const supportsPressure = supports('pressureSensitive');
  const showSketch = isDefault
    ? Boolean(creationType === 'arrow' ? toolRoute === 'ortho' : creationUtil?.supportsSketchStroke({
      type: creationType,
      props: creationDefaults,
    } as GlideShape))
    : shapes.every(shape => editor.getShapeUtil(shape).supportsSketchStroke(shape));
  const strokePresentation = (styles: Record<string, unknown>, supportsSketch: boolean) => {
    if (styles['pressureSensitive'] === true) return 'pressure';
    if (styles['strokeStyle'] === 'sketch' && !supportsSketch) return 'solid';
    return styles['strokeStyle'];
  };
  const currentStroke = isDefault
    ? strokePresentation({
      strokeStyle: getCommonValue('strokeStyle'),
      pressureSensitive: supportsPressure && getCommonValue('pressureSensitive'),
    }, showSketch)
    : commonValue(shapeStyles.map((styles, index) => strokePresentation(
      styles, editor.getShapeUtil(shapes[index]!).supportsSketchStroke(shapes[index]!),
    )));

  const updateStrokePresentation = (value: StrokeStyle | 'pressure') => {
    const props: Record<string, unknown> = { strokeStyle: value === 'pressure' ? 'solid' : value };
    if (supportsPressure) props['pressureSensitive'] = value === 'pressure';
    // A shared stroke style must also take effect on pressure-enabled strokes.
    if (!supportsPressure && shapeStyles.some(styles => styles['pressureSensitive'] === true)) {
      editor.batch('Stroke style change', () => {
        shapes.forEach((shape, index) => editor.updateShape(shape.id as ShapeId, {
          props: 'pressureSensitive' in shapeStyles[index]! ? { ...props, pressureSensitive: false } : props,
        }));
      });
      editor.activeStyles.value = { ...editor.activeStyles.peek(), ...props };
      return;
    }
    updateProps(props);
  };

  const updateArrowRoute = (value: ArrowRouteStyle) => {
    controller.setArrowRouteStyle(value);
    if (!isDefault) updateProp('routeStyle', value);
  };

  const updateArrowhead = (terminal: 'start' | 'end', value: ArrowheadStyle) => {
    if (terminal === 'start') controller.setArrowheadStart(value);
    else controller.setArrowheadEnd(value);
    if (!isDefault) updateProp(terminal === 'start' ? 'arrowheadStart' : 'arrowheadEnd', value);
  };

  const updateAssetProp = (id: ShapeId, key: string, value: unknown) => {
    const asset = editor.getShape(id);
    if (asset?.type !== 'raster-image' && asset?.type !== 'sanitized-svg') return;
    editor.updateShape(id, { props: { [key]: value } });
  };

  if (isDefault && !creationType) return null;
  const targetSuffix = labelTarget ? selected?.type === 'frame' ? ' title' : ' label' : '';
  const title = selected ? boardObjectName(selected.type) + targetSuffix
    : isDefault ? boardObjectName(activeTool) + ' defaults' : shapes.length + ' selected';

  return (
    <div
      data-glideboard-role={isDefault ? 'default-style-panel' : 'selected-style-panel'}
      style={{
        ...panelStyle,
        boxSizing: 'border-box',
        width: 148,
        padding: 0,
        gap: 0,
        border: 'none',
      }}
      onPointerDown={event => {
        event.stopPropagation();
        if (editingSession) event.preventDefault();
      }}
    >
      <StyleOptionStyles />
      <div role="heading" aria-level={2}
        style={{ fontSize: 12, fontWeight: 650, padding: '8px 6px 5px', borderBottom: '1px solid ' + wbTheme.border }}>
        {title}
      </div>
      {locked ? <div style={{ padding: 6, fontSize: 11, color: wbTheme.textSoft }}>Locked selection</div> : <>
      {selectedAsset && !editingShape ? (
        <div
          data-glideboard-role="asset-inspector"
          data-glideboard-ignore-shortcuts
          onPointerDown={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
          onKeyUp={event => event.stopPropagation()}
        >
		  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
			<AssetLifecycleCommands key={`commands:${selectedAsset.id}`} shapeId={selectedAsset.id as ShapeId} />
			<AltTextField
              key={`alt:${selectedAsset.id}`}
              assetId={selectedAsset.id}
              value={String(selectedAsset.props['altText'] ?? '')}
              onCommit={value => updateAssetProp(selectedAsset.id as ShapeId, 'altText', value)}
            />
            {selectedAsset.type === 'raster-image' ? (
              <div>
                <div style={{ ...sectionTitleStyle, marginBottom: 6 }}>Crop</div>
                <RasterCropControls
                  key={`crop:${selectedAsset.id}`}
                  assetId={selectedAsset.id}
                  crop={(selectedAsset.props['crop'] as { x: number; y: number; w: number; h: number } | undefined)
                    ?? { x: 0, y: 0, w: 1, h: 1 }}
                  onCommit={value => updateAssetProp(selectedAsset.id as ShapeId, 'crop', value)}
                />
              </div>
            ) : (
              <>
                <div>
                  <div style={{ ...sectionTitleStyle, marginBottom: 6 }}>Color mode</div>
                  <div style={rowStyle} role="group" aria-label="SVG color mode">
                    <IconButton
                      active={(selectedAsset.props['colorMode'] ?? 'native') === 'native'}
                      onClick={() => updateAssetProp(selectedAsset.id as ShapeId, 'colorMode', 'native')}
                    >Native</IconButton>
                    <IconButton
                      active={selectedAsset.props['colorMode'] === 'monochrome'}
                      onClick={() => updateAssetProp(selectedAsset.id as ShapeId, 'colorMode', 'monochrome')}
                    >Monochrome</IconButton>
                  </div>
                </div>
                {selectedAsset.props['colorMode'] === 'monochrome' && <label style={{ display: 'grid', gridTemplateColumns: '1fr 32px', alignItems: 'center', gap: 8,
                  fontSize: 10, color: wbTheme.textSoft }}>
                  Theme color
                  <input
                    data-glideboard-ignore-shortcuts
                    aria-label="Theme color"
                    type="color"
                    value={String(selectedAsset.props['themeColor'] ?? '#000000').slice(0, 7)}
                    onInput={event => updateAssetProp(
                      selectedAsset.id as ShapeId,
                      'themeColor',
                      event.currentTarget.value,
                    )}
                    style={{ width: 32, height: 26, padding: 2, borderRadius: 4, border: `1px solid ${wbTheme.border}` }}
                  />
                </label>}
              </>
            )}
          </div>
        </div>
      ) : null}

      <CoreStyleControls
        colorLabel={textOnly ? 'Text color' : targetType === 'sticky-note' ? 'Background' : 'Color'}
        color={textOnly ? textColor : bodyColor}
        opacity={opacity === MIXED ? MIXED : Number(opacity ?? 1)}
        fillStyle={getCommonValue('fillStyle')}
        strokeWidth={getCommonValue('strokeWidth')}
        strokePresentation={currentStroke}
        font={getCommonValue('font')}
        fontSize={getCommonValue('fontSize')}
        textAlign={creationType === 'text' ? activeStyles?.['standaloneTextAlign'] ?? 'left' : getCommonValue('textAlign')}
        showColor={textOnly ? supportsTextColor : supports('color') && !shapes.some(shape => shape.type === 'text')}
        showOpacity={!labelTarget && supports('opacity')}
        showFill={!textOnly && supports('fillStyle')}
        showStrokeStyle={!textOnly && supports('strokeStyle')}
        showSketch={showSketch}
        showStrokeWidth={!textOnly && supports('strokeWidth')}
        showPressure={supportsPressure}
        showFont={(textOnly || creationType === 'sticky-note') && supports('font')}
        showFontSize={(textOnly || creationType === 'sticky-note') && supports('fontSize')}
        showTextAlign={(textOnly || creationType === 'sticky-note') && supports('textAlign')}
        onColor={value => {
          if (textOnly) updateTextColor(value);
          else updateBodyColor(value);
        }}
        onOpacity={value => updateProp('opacity', value)}
        onFill={value => updateProp('fillStyle', value)}
        onStrokePresentation={updateStrokePresentation}
        onStrokeWidth={value => updateProp('strokeWidth', value)}
        onFont={value => updateProp('font', value)}
        onFontSize={value => updateProp('fontSize', value)}
        onTextAlign={value => updateProp(creationType === 'text' ? 'standaloneTextAlign' : 'textAlign', value)}
      />

      {!textOnly && supports('routeStyle') ? (
        <StyleGroup label="Route" value={routeStyle} grid>
          {ROUTE_OPTIONS.map(({ value, label, path }) => (
            <VisualStyleButton key={value} label={label} active={routeStyle === value} onClick={() => updateArrowRoute(value)}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={path} />
                {value === 'smart' && <rect x="7" y="8" width="6" height="6" rx="1" />}
              </svg>
            </VisualStyleButton>
          ))}
        </StyleGroup>
      ) : null}

      {!textOnly && ([
        { terminal: 'start', label: 'Start arrowhead', prop: 'arrowheadStart', current: arrowheadStart },
        { terminal: 'end', label: 'End arrowhead', prop: 'arrowheadEnd', current: arrowheadEnd },
      ] as const).filter(({ prop }) => supports(prop)).map(({ terminal, label, current }) => (
        <StyleGroup key={terminal} label={label} value={current} grid>
          {ARROWHEAD_OPTIONS.map(({ value, label }) => (
            <VisualStyleButton key={value} label={label} active={current === value} onClick={() => updateArrowhead(terminal, value)}>
              <ArrowheadPreview terminal={terminal} style={value} />
            </VisualStyleButton>
          ))}
        </StyleGroup>
      ))}

      {!textOnly && supports('clipContent') ? (
        <StyleGroup label="Frame content" value={clipContent}>
            <IconButton active={clipContent === false} onClick={() => updateProp('clipContent', false)}>Overflow</IconButton>
            <IconButton active={clipContent === true} onClick={() => updateProp('clipContent', true)}>Clip</IconButton>
        </StyleGroup>
      ) : null}

      {canArrange && !editingShape ? (
        <div>
          <div style={sectionTitleStyle}>Arrange</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            <button title="Align left" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedIds, 'left')}>Left</button>
            <button title="Align horizontal centers" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedIds, 'center-x')}>H Mid</button>
            <button title="Align right" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedIds, 'right')}>Right</button>
            <button title="Align top" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedIds, 'top')}>Top</button>
            <button title="Align vertical centers" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedIds, 'center-y')}>V Mid</button>
            <button title="Align bottom" style={buttonStyleSmall} onClick={() => editor.alignShapes(selectedIds, 'bottom')}>Bottom</button>
            {transformRoots.length >= 3 && <>
            <button title="Distribute horizontal gaps" style={buttonStyleSmall}
              onClick={() => editor.distributeShapes(selectedIds, 'horizontal')}>H Gap</button>
            <button title="Distribute vertical gaps" style={buttonStyleSmall}
              onClick={() => editor.distributeShapes(selectedIds, 'vertical')}>V Gap</button>
            </>}
            <button title="Tidy into a row" style={buttonStyleSmall}
              onClick={() => editor.tidyShapes(selectedIds, 'row')}>Tidy</button>
            {canMatchSizes && <>
            <button title="Match width" style={buttonStyleSmall}
              onClick={() => editor.matchShapeSizes(selectedIds, 'width')}>Width</button>
            <button title="Match height" style={buttonStyleSmall}
              onClick={() => editor.matchShapeSizes(selectedIds, 'height')}>Height</button>
            <button title="Match size" style={buttonStyleSmall}
              onClick={() => editor.matchShapeSizes(selectedIds, 'both')}>Size</button>
            </>}
          </div>
        </div>
      ) : null}

      </>}
    </div>
  );
}
