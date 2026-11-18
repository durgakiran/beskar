import React from 'react';
import { LuArrowLeft } from 'react-icons/lu';
import { useGlideboardController } from './GlideboardContext.js';
import { wbTheme } from './theme.js';

export function BackToContentButton({ onClick }: { onClick: () => void }) {
  const controller = useGlideboardController();
  return (
    <button
      type="button"
      id={controller.domId('back-to-content')}
      data-glideboard-role="back-to-content"
      onClick={onClick}
      style={{
        position: 'absolute',
        bottom: 72,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: wbTheme.surface,
        color: wbTheme.accentText,
        border: `1px solid ${wbTheme.border}`,
        borderRadius: 24,
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        boxShadow: wbTheme.shadow,
      }}
    >
      <LuArrowLeft size={14} aria-hidden="true" />
      Back to content
    </button>
  );
}
