import React from 'react';
import { FiAlertCircle, FiBox, FiLoader, FiRotateCcw, FiX } from 'react-icons/fi';
import type { GlideboardAssetPlacementState } from './types.js';
import { wbTheme } from './theme.js';

export function AssetPlacementStatus({
  placement,
  onCancel,
  onRetry,
}: {
  placement: GlideboardAssetPlacementState;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const isError = placement.status === 'error';
  const isPending = placement.status === 'pending';
  const instruction = isError
    ? `${placement.error} Try placement again or dismiss this message.`
    : isPending
      ? 'Preparing asset...'
      : 'Click or drag on the canvas to place';

  return (
    <section
      data-glideboard-role="asset-placement-status"
      data-placement-status={placement.status}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      style={{
        position: 'absolute', left: '50%', top: 16, transform: 'translateX(-50%)', zIndex: 92,
        width: 'max-content', maxWidth: 'calc(100% - 24px)', minHeight: 42,
        display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px 7px 11px',
        border: `1px solid ${isError ? wbTheme.danger : wbTheme.accentStroke}`,
        borderRadius: 8, background: wbTheme.surface, boxShadow: wbTheme.shadow,
        color: wbTheme.text, fontFamily: 'inherit',
      }}
    >
      <span aria-hidden style={{ color: isError ? wbTheme.dangerText : wbTheme.accentText, display: 'grid' }}>
        {isError ? <FiAlertCircle size={17} /> : isPending ? <FiLoader size={17} /> : <FiBox size={17} />}
      </span>
      <span style={{ minWidth: 0, lineHeight: 1.25 }}>
        <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
          {isError ? `Couldn't place ${placement.displayName}` : `Placing ${placement.displayName}`}
        </strong>
        <span style={{ display: 'block', color: isError ? wbTheme.dangerText : wbTheme.textMuted, fontSize: 11 }}>
          {instruction}
        </span>
      </span>
      {isError ? (
        <StatusButton label="Try placement again" onClick={onRetry}><FiRotateCcw size={14} /></StatusButton>
      ) : null}
      <StatusButton label={isPending ? 'Cancel asset placement' : isError ? 'Dismiss placement error' : 'Cancel asset placement'} onClick={onCancel}>
        <FiX size={15} />
      </StatusButton>
    </section>
  );
}

function StatusButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-glideboard-ignore-shortcuts
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 30, height: 30, flex: '0 0 30px', display: 'grid', placeItems: 'center',
        border: `1px solid ${wbTheme.border}`, borderRadius: 6, background: wbTheme.surfaceMuted,
        color: wbTheme.textMuted, cursor: 'pointer', padding: 0,
      }}
    >{children}</button>
  );
}
