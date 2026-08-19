import React, { useMemo } from 'react';
import {
  FiAlignCenter,
  FiAlignLeft,
  FiAlignRight,
  FiActivity,
  FiDownload,
  FiLock,
  FiRefreshCw,
  FiRotateCcw,
  FiUnlock,
  FiX,
} from 'react-icons/fi';
import {
  TLDRAW_COLORS,
  type GlideShape,
  type ShapeId,
} from '@durgakiran/glideline';
import { useSelectedShapes } from './hooks/useSelectedShapes.js';
import { useGlideboardController } from './GlideboardContext.js';
import type {
  ArrowRouteStyle,
  ArrowheadStyle,
} from './GlideboardController.js';
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

function StrokePreview({ style, width = 2 }: { style: 'solid' | 'dashed' | 'dotted'; width?: number }) {
  return <span style={{ width: 16, borderTop: `${width}px ${style} currentColor` }} />;
}

function OpacityControl({
  label,
  value,
  onChange,
  padding = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  padding?: React.CSSProperties['padding'];
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '1fr 30px', alignItems: 'center', gap: 4, padding }}>
      <input
        className="glideboard-opacity-slider"
        aria-label={label}
        type="range"
        min={0.1}
        max={1}
        step={0.1}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        style={{
          width: '100%',
          '--glideboard-opacity-percent': `${value * 100}%`,
        } as React.CSSProperties}
      />
      <output style={{ fontSize: 10, color: wbTheme.textSoft, textAlign: 'right' }}>
        {Math.round(value * 100)}%
      </output>
    </label>
  );
}

type CoreStyleMode = 'default' | 'shape' | 'text';

function CoreStyleControls({
  mode,
  color,
  opacity,
  fillStyle,
  strokeStyle,
  strokeWidth,
  pressureSensitive,
  font,
  fontSize,
  textAlign,
  showColor,
  showOpacity,
  showFill,
  showStrokeStyle,
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
  mode: CoreStyleMode;
  color: unknown;
  opacity: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  strokeWidth: unknown;
  pressureSensitive: boolean;
  font: unknown;
  fontSize: unknown;
  textAlign: unknown;
  showColor: boolean;
  showOpacity: boolean;
  showFill: boolean;
  showStrokeStyle: boolean;
  showStrokeWidth: boolean;
  showPressure: boolean;
  showFont: boolean;
  showFontSize: boolean;
  showTextAlign: boolean;
  onColor: (value: string) => void;
  onOpacity: (value: number) => void;
  onFill: (value: string) => void;
  onStrokePresentation: (value: 'solid' | 'dashed' | 'dotted' | 'pressure') => void;
  onStrokeWidth: (value: string) => void;
  onFont: (value: string) => void;
  onFontSize: (value: string) => void;
  onTextAlign: (value: string) => void;
}) {
  const colorLabel = mode === 'default' ? 'Default color' : mode === 'text' ? 'Text color' : 'Shape color';
  const hasAppearance = showFill || showStrokeStyle || showStrokeWidth;
  const hasTypography = showFont || showFontSize || showTextAlign;
  return (
    <div data-glideboard-role="core-style-controls" style={{ display: 'contents' }}>
      {showColor ? (
        <div role="group" aria-label={colorLabel} style={optionGridStyle}>
          {Object.entries(TLDRAW_COLORS).map(([name, hex]) => (
            <ColorOptionButton key={name} name={name} hex={hex}
              active={color === name || color === hex} onClick={() => onColor(name)} />
          ))}
        </div>
      ) : null}
      {showOpacity ? (
        <OpacityControl label={mode === 'default' ? 'Default opacity' : 'Shape opacity'}
          value={opacity} onChange={onOpacity} padding={mode === 'default' ? '0 8px' : 0} />
      ) : null}
      {showOpacity && hasAppearance ? (
        <div data-glideboard-role="style-options-divider" data-divider-section="color-appearance"
          style={{ height: 1, background: wbTheme.border, marginTop: mode === 'default' ? 4 : 0 }} />
      ) : null}
      {showFill ? (
        <div role="group" aria-label={mode === 'default' ? 'Default fill' : 'Fill'} style={optionGridStyle}>
          {(['none', 'semi', 'solid', 'pattern', 'lined'] as const).map(kind => (
            <VisualStyleButton key={kind} label={`${kind[0]!.toUpperCase()}${kind.slice(1)} fill`}
              active={fillStyle === kind} onClick={() => onFill(kind)}>
              <FillPreview kind={kind} />
            </VisualStyleButton>
          ))}
        </div>
      ) : null}
      {showStrokeStyle ? (
        <div role="group" aria-label={mode === 'default' ? 'Default stroke style' : 'Stroke style'} style={optionGridStyle}>
          {(['solid', 'dashed', 'dotted'] as const).map(kind => (
            <VisualStyleButton key={kind} label={`${kind[0]!.toUpperCase()}${kind.slice(1)} stroke`}
              active={!pressureSensitive && strokeStyle === kind} onClick={() => onStrokePresentation(kind)}>
              <StrokePreview style={kind} />
            </VisualStyleButton>
          ))}
          {showPressure ? (
            <VisualStyleButton label="Pressure-sensitive stroke" active={pressureSensitive}
              onClick={() => onStrokePresentation('pressure')}><FiActivity size={14} /></VisualStyleButton>
          ) : null}
        </div>
      ) : null}
      {showStrokeWidth ? (
        <div role="group" aria-label={mode === 'default' ? 'Default stroke width' : 'Stroke width'} style={optionGridStyle}>
          {([['thin', 1.5], ['medium', 2.5], ['thick', 3.5], ['xl', 5]] as const).map(([kind, width]) => (
            <VisualStyleButton key={kind}
              label={`${kind === 'xl' ? 'Extra large' : `${kind[0]!.toUpperCase()}${kind.slice(1)}`} stroke width`}
              active={strokeWidth === kind} onClick={() => onStrokeWidth(kind)}>
              <StrokePreview style="solid" width={width} />
            </VisualStyleButton>
          ))}
        </div>
      ) : null}
      {hasTypography ? (
        <div data-glideboard-role="style-options-divider" data-divider-section="appearance-typography"
          style={{ height: 1, background: wbTheme.border }} />
      ) : null}
      {showFont ? (
        <div role="group" aria-label={mode === 'default' ? 'Default font family' : 'Font family'} style={optionGridStyle}>
          <VisualStyleButton label="Draw font" active={font === 'draw'} onClick={() => onFont('draw')}>
            <span style={{ fontFamily: '"Shantell Sans", cursive', fontSize: 10 }}>Aa</span>
          </VisualStyleButton>
          <VisualStyleButton label="Sans font" active={font === 'sans'} onClick={() => onFont('sans')}>
            <span style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: 10 }}>Aa</span>
          </VisualStyleButton>
          <VisualStyleButton label="Serif font" active={font === 'serif'} onClick={() => onFont('serif')}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 10 }}>Aa</span>
          </VisualStyleButton>
          <VisualStyleButton label="Mono font" active={font === 'mono'} onClick={() => onFont('mono')}>
            <span style={{ fontFamily: '"Fira Code", monospace', fontSize: 10 }}>Aa</span>
          </VisualStyleButton>
        </div>
      ) : null}
      {showFontSize ? (
        <div role="group" aria-label={mode === 'default' ? 'Default font size' : 'Font size'} style={optionGridStyle}>
          <VisualStyleButton label="Small font" active={fontSize === 'sm'} onClick={() => onFontSize('sm')}><span style={{ fontSize: 9 }}>S</span></VisualStyleButton>
          <VisualStyleButton label="Medium font" active={fontSize === 'md'} onClick={() => onFontSize('md')}><span style={{ fontSize: 10 }}>M</span></VisualStyleButton>
          <VisualStyleButton label="Large font" active={fontSize === 'lg'} onClick={() => onFontSize('lg')}><span style={{ fontSize: 11 }}>L</span></VisualStyleButton>
          <VisualStyleButton label="Extra large font" active={fontSize === 'xl'} onClick={() => onFontSize('xl')}><span style={{ fontSize: 11 }}>XL</span></VisualStyleButton>
        </div>
      ) : null}
      {showTextAlign ? (
        <div role="group" aria-label={mode === 'default' ? 'Default label alignment' : 'Label alignment'} style={optionGridStyle}>
          <VisualStyleButton label="Align labels left" active={textAlign === 'left'} onClick={() => onTextAlign('left')}><FiAlignLeft size={14} /></VisualStyleButton>
          <VisualStyleButton label="Center labels" active={textAlign === 'center'} onClick={() => onTextAlign('center')}><FiAlignCenter size={14} /></VisualStyleButton>
          <VisualStyleButton label="Align labels right" active={textAlign === 'right'} onClick={() => onTextAlign('right')}><FiAlignRight size={14} /></VisualStyleButton>
        </div>
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
  const selected = selectedShapes.length === 1 && !editingSession ? selectedShapes[0]! : null;
  if (!selected) return null;

  const selectedWorld = editor.getShapeVisualWorldBounds(selected);
  const selectedLocal = editor.getShapeLocalBounds(selected.id as ShapeId);
  const selectedAsset = selected.type === 'raster-image' || selected.type === 'sanitized-svg'
    ? selected
    : null;
  const lockAspect = selectedAsset
    ? selectedAsset.props['aspectLocked'] !== false
    : selected.meta['aspectLocked'] === true;
  const canResizePrecisely = selected.type !== 'group' && selected.type !== 'arrow';
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
      <NumericField label="W" value={selectedLocal.w} disabled={!canResizePrecisely}
        onCommit={w => editor.setShapePrecision(selected.id as ShapeId, { w, lockAspect })} />
      <NumericField label="H" value={selectedLocal.h} disabled={!canResizePrecisely}
        onCommit={h => editor.setShapePrecision(selected.id as ShapeId, { h, lockAspect })} />
      <NumericField label="°" value={selected.rotation * 180 / Math.PI} disabled={selected.type === 'arrow'}
        onCommit={degrees => editor.setShapePrecision(selected.id as ShapeId, { rotation: degrees * Math.PI / 180 })} />
      <button title={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'} aria-label="Aspect ratio"
        aria-pressed={lockAspect} onClick={toggleAspectLock}
        style={{ ...buttonStyleSmall, width: 28, flex: '0 0 28px' }}>
        {lockAspect ? <FiLock size={13} /> : <FiUnlock size={13} />}
      </button>
      <button title="Reset rotation" aria-label="Reset rotation"
        onClick={() => editor.setShapePrecision(selected.id as ShapeId, { rotation: 0 })}
        style={{ ...buttonStyleSmall, width: 28, flex: '0 0 28px' }}><FiRotateCcw size={13} /></button>
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
  const textOnly = Boolean(editingShape)
    || (shapes.length > 0 && shapes.every(shape => shape.type === 'text'))
    || (
      selectedShapes.length === 1
      && selectedShapes[0]!.id === textStyleTargetId
    );
  const selected = selectedShapes.length === 1 ? selectedShapes[0]! : null;
  const selectedAsset = selected?.type === 'raster-image' || selected?.type === 'sanitized-svg'
    ? selected
    : null;
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
  const pressureSensitive = getCommonValue('pressureSensitive') === true;
  const opacity = Number(getCommonValue('opacity') ?? 1);
  const font = getCommonValue('font');
  const fontSize = getCommonValue('fontSize');
  const textAlign = getCommonValue('textAlign');
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

  const updateShapeColor = (value: unknown) => {
    editor.activeStyles.value = {
      ...editor.activeStyles.value,
      color: value,
      labelColor: value,
    };
    editor.batch('Shape color change', () => {
      for (const shape of shapes) {
        const props: Record<string, unknown> = {};
        if ('color' in shape.props) props['color'] = value;
        if ('labelColor' in shape.props) props['labelColor'] = value;
        if (Object.keys(props).length > 0) {
          editor.updateShape(shape.id as ShapeId, { props });
        }
      }
    });
  };

  const updateStrokePresentation = (value: 'solid' | 'dashed' | 'dotted' | 'pressure') => {
    if (value === 'pressure') {
      updateProp('strokeStyle', 'solid');
      updateProp('pressureSensitive', true);
      return;
    }
    updateProp('strokeStyle', value);
    if (shapes.length === 0 || supportedKeys.has('pressureSensitive')) {
      updateProp('pressureSensitive', false);
    }
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

  const updateAssetProp = (id: ShapeId, key: string, value: unknown) => {
    const asset = editor.getShape(id);
    if (asset?.type !== 'raster-image' && asset?.type !== 'sanitized-svg') return;
    editor.updateShape(id, { props: { [key]: value } });
  };

  const isDefault = shapes.length === 0;
  const coreMode: CoreStyleMode = isDefault ? 'default' : textOnly ? 'text' : 'shape';
  const showAppearanceDefaults = isDefault || !textOnly;


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
          <div style={sectionTitleStyle}>Asset</div>
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
                <label style={{ display: 'grid', gridTemplateColumns: '1fr 32px', alignItems: 'center', gap: 8,
                  fontSize: 10, color: wbTheme.textSoft }}>
                  Theme color
                  <input
                    data-glideboard-ignore-shortcuts
                    aria-label="Theme color"
                    type="color"
                    value={String(selectedAsset.props['themeColor'] ?? '#000000').slice(0, 7)}
                    disabled={selectedAsset.props['colorMode'] !== 'monochrome'}
                    onInput={event => updateAssetProp(
                      selectedAsset.id as ShapeId,
                      'themeColor',
                      event.currentTarget.value,
                    )}
                    style={{ width: 32, height: 26, padding: 2, borderRadius: 4, border: `1px solid ${wbTheme.border}` }}
                  />
                </label>
              </>
            )}
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

      <CoreStyleControls
        mode={coreMode}
        color={textOnly ? textColor : color}
        opacity={opacity}
        fillStyle={fillStyle}
        strokeStyle={strokeStyle}
        strokeWidth={strokeWidth}
        pressureSensitive={pressureSensitive}
        font={font}
        fontSize={fontSize}
        textAlign={textAlign}
        showColor={isDefault || (textOnly ? supportsTextColor : supportedKeys.has('color'))}
        showOpacity={isDefault || supportedKeys.has('opacity')}
        showFill={showAppearanceDefaults && (isDefault || supportedKeys.has('fillStyle'))}
        showStrokeStyle={showAppearanceDefaults && (isDefault || supportedKeys.has('strokeStyle'))}
        showStrokeWidth={showAppearanceDefaults && (isDefault || supportedKeys.has('strokeWidth'))}
        showPressure={isDefault || supportedKeys.has('pressureSensitive')}
        showFont={isDefault || supportedKeys.has('font')}
        showFontSize={isDefault || supportedKeys.has('fontSize')}
        showTextAlign={isDefault || supportedKeys.has('textAlign')}
        onColor={value => {
          if (textOnly) updateTextColor(value);
          else updateShapeColor(value);
        }}
        onOpacity={value => updateProp('opacity', value)}
        onFill={value => updateProp('fillStyle', value)}
        onStrokePresentation={updateStrokePresentation}
        onStrokeWidth={value => updateProp('strokeWidth', value)}
        onFont={value => updateProp('font', value)}
        onFontSize={value => updateProp('fontSize', value)}
        onTextAlign={value => updateProp('textAlign', value)}
      />

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

      {supportedKeys.has('clipContent') ? (
        <div>
          <div style={sectionTitleStyle}>Frame Content</div>
          <div style={rowStyle}>
            <IconButton active={!clipContent} onClick={() => updateProp('clipContent', false)}>Overflow</IconButton>
            <IconButton active={clipContent === true} onClick={() => updateProp('clipContent', true)}>Clip</IconButton>
          </div>
        </div>
      ) : null}

    </div>
  );
}
