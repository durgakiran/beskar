import React from 'react';
import {
  FiChevronLeft,
  FiChevronRight,
  FiCopy,
  FiEdit2,
  FiMoreHorizontal,
  FiPlus,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import type { PageId } from '@durgakiran/glideline';
import { useGlideboardController } from './GlideboardContext.js';
import { useSignalValue } from './useSignalValue.js';
import { wbTheme } from './theme.js';

export function PageTabs() {
  const controller = useGlideboardController();
  const { editor } = controller;
  const pageIds = useSignalValue(editor.getPageIdsSignal()) ?? [];
  const activePageId = useSignalValue(editor.activePageId) ?? editor.getActivePageId();
  const readOnly = useSignalValue(controller.readOnlySignal) ?? false;
  useSignalValue(editor.getDocumentVersionSignal());
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renamingPageId, setRenamingPageId] = React.useState<PageId | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [error, setError] = React.useState('');
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  React.useEffect(() => {
    setMenuOpen(false);
    setConfirmDelete(false);
    setError('');
  }, [activePageId]);

  const run = (operation: () => void) => {
    try {
      operation();
      setError('');
      setMenuOpen(false);
      setConfirmDelete(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update this page.');
    }
  };

  const beginRename = (pageId: PageId) => {
    const page = editor.getPage(pageId);
    if (!page || readOnly) return;
    setRenamingPageId(pageId);
    setRenameValue(page.name);
    setMenuOpen(false);
  };

  const commitRename = () => {
    if (!renamingPageId) return;
    run(() => editor.renamePage(renamingPageId, renameValue));
    setRenamingPageId(null);
  };

  const activeIndex = pageIds.indexOf(activePageId);
  return (
    <div
      ref={rootRef}
      data-glideboard-role="page-tabs"
      style={{
        position: 'absolute', left: 12, right: 180, bottom: 12, height: 42, zIndex: 105,
        display: 'flex', alignItems: 'center', gap: 4, padding: 4,
        border: `1px solid ${wbTheme.border}`, borderRadius: 8, boxSizing: 'border-box',
        background: wbTheme.surface, boxShadow: wbTheme.shadow, color: wbTheme.text,
        fontFamily: 'inherit', pointerEvents: 'auto',
      }}
      onPointerDown={event => event.stopPropagation()}
    >
      <div role="tablist" aria-label="Whiteboard pages" style={{ minWidth: 0, flex: 1, display: 'flex', gap: 2, overflowX: 'auto', scrollbarWidth: 'thin' }}>
        {pageIds.map((pageId, index) => {
          const page = editor.getPage(pageId);
          const active = pageId === activePageId;
          return renamingPageId === pageId ? (
            <input
              key={pageId}
              autoFocus
              aria-label="Page name"
              value={renameValue}
              onChange={event => setRenameValue(event.currentTarget.value)}
              onBlur={commitRename}
              onKeyDown={event => {
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') setRenamingPageId(null);
              }}
              style={{ width: 150, height: 32, padding: '0 8px', boxSizing: 'border-box', borderRadius: 4,
                border: `1px solid ${wbTheme.accent}`, outline: 0, background: wbTheme.surfaceInset, color: wbTheme.text }}
            />
          ) : (
            <button
              key={pageId}
              type="button"
              role="tab"
              aria-selected={active}
              title={readOnly ? page?.name : `${page?.name} · Double-click to rename`}
              onClick={() => editor.setActivePage(pageId)}
              onDoubleClick={() => beginRename(pageId)}
              onKeyDown={event => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const next = pageIds[index + (event.key === 'ArrowLeft' ? -1 : 1)];
                if (next) editor.setActivePage(next);
              }}
              style={{
                flex: '0 0 auto', maxWidth: 180, height: 32, padding: '0 12px', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderRadius: 4, cursor: 'pointer',
                border: active ? `1px solid ${wbTheme.accent}` : '1px solid transparent',
                background: active ? wbTheme.accentSurface : 'transparent',
                color: active ? wbTheme.accentText : wbTheme.textSoft, fontSize: 11, fontWeight: active ? 650 : 500,
              }}
            >{page?.name ?? 'Untitled page'}</button>
          );
        })}
      </div>

      {!readOnly ? <IconButton label="Create page" onClick={() => run(() => { editor.createPage(); })}><FiPlus size={15} /></IconButton> : null}
      {!readOnly ? (
        <div style={{ position: 'relative', flex: '0 0 auto' }}>
          <IconButton label="Page actions" pressed={menuOpen} onClick={() => { setMenuOpen(open => !open); setConfirmDelete(false); }}>
            <FiMoreHorizontal size={16} />
          </IconButton>
          {menuOpen ? (
            <div role="menu" aria-label="Page actions" style={{
              position: 'absolute', right: 0, bottom: 42, width: 210, padding: 6,
              border: `1px solid ${wbTheme.border}`, borderRadius: 8, background: wbTheme.surface,
              boxShadow: wbTheme.shadow, color: wbTheme.text,
            }}>
              {confirmDelete ? (
                <div style={{ padding: 8 }}>
                  <div style={{ fontSize: 11, lineHeight: 1.4 }}>Delete this page and all of its content?</div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
                    <MenuButton label="Cancel" icon={FiX} onClick={() => setConfirmDelete(false)} />
                    <MenuButton danger label="Delete page" icon={FiTrash2} disabled={pageIds.length === 1} onClick={() => run(() => { editor.deletePage(activePageId); })} />
                  </div>
                </div>
              ) : (
                <>
                  <MenuButton label="Rename" icon={FiEdit2} onClick={() => beginRename(activePageId)} />
                  <MenuButton label="Duplicate" icon={FiCopy} onClick={() => run(() => { editor.duplicatePage(activePageId); })} />
                  <MenuButton label="Move left" icon={FiChevronLeft} disabled={activeIndex <= 0} onClick={() => run(() => { editor.movePage(activePageId, -1); })} />
                  <MenuButton label="Move right" icon={FiChevronRight} disabled={activeIndex < 0 || activeIndex >= pageIds.length - 1} onClick={() => run(() => { editor.movePage(activePageId, 1); })} />
                  <MenuButton danger label="Delete" icon={FiTrash2} disabled={pageIds.length === 1} onClick={() => setConfirmDelete(true)} />
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <div role="alert" style={{ position: 'absolute', left: 0, bottom: 48, maxWidth: 320, padding: '8px 10px', borderRadius: 6,
        border: `1px solid ${wbTheme.dangerText}`, background: wbTheme.surface, color: wbTheme.dangerText, fontSize: 11 }}>{error}</div> : null}
    </div>
  );
}

function IconButton({ label, pressed, onClick, children }: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return <button type="button" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} style={{
    width: 32, height: 32, flex: '0 0 auto', padding: 0, display: 'grid', placeItems: 'center',
    borderRadius: 4, border: `1px solid ${pressed ? wbTheme.accent : wbTheme.border}`,
    background: pressed ? wbTheme.accentSurface : wbTheme.surfaceMuted,
    color: pressed ? wbTheme.accentText : wbTheme.textSoft, cursor: 'pointer',
  }}>{children}</button>;
}

function MenuButton({ label, icon: Icon, onClick, disabled = false, danger = false }: {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return <button type="button" role="menuitem" disabled={disabled} onClick={onClick} style={{
    width: '100%', height: 34, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 8,
    border: 0, borderRadius: 4, background: 'transparent', color: danger ? wbTheme.dangerText : wbTheme.text,
    fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
  }}><Icon size={14} />{label}</button>;
}
