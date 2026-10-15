import { useEffect, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import {
  autoUpdate, flip, FloatingPortal, offset, safePolygon, shift,
  useClick, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole,
} from '@floating-ui/react';
import type { MentionHandler, MentionUser, MentionUserDetails } from '../../types';

type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; user: MentionUserDetails }
  | { status: 'unavailable' }
  | { status: 'error' };

function MentionAvatar({ user }: { user: MentionUserDetails }) {
  const [failed, setFailed] = useState(false);
  let src: string | undefined;
  try {
    if (user.avatarUrl) {
      const url = new URL(user.avatarUrl, document.baseURI);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) src = url.href;
    }
  } catch { /* Fall back to initials for malformed URLs. */ }
  const initials = user.label.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || '').join('').toUpperCase();
  return <span className="mention-profile-avatar" aria-hidden="true">
    {src && !failed
      ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : initials || '?'}
  </span>;
}

export function MentionView({ node, extension, editor }: NodeViewProps) {
  const id = String(node.attrs.id || '');
  const storedLabel = String(node.attrs.label || id);
  const handler = (extension.options as { mentionHandler?: MentionHandler }).mentionHandler;
  const detailsHandler = handler?.getUserDetails;
  const [resolved, setResolved] = useState<MentionUser | null>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{
    id: string; handler: typeof handler; detailsHandler: typeof detailsHandler; state: ProfileState;
  } | null>(null);
  const profile: ProfileState = loaded?.id === id && loaded.handler === handler && loaded.detailsHandler === detailsHandler
    ? loaded.state : { status: 'loading' };
  const [attempt, setAttempt] = useState(0);
  const enabled = Boolean(detailsHandler && id);
  const { refs, floatingStyles, context } = useFloating({
    open: open && enabled,
    onOpenChange: next => {
      if (next !== open) {
        setLoaded(null);
        setOpen(next);
      }
    },
    strategy: 'fixed',
    placement: 'bottom-start',
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { enabled, delay: { open: 250, close: 100 }, handleClose: safePolygon() });
  const focus = useFocus(context, { enabled });
  const click = useClick(context, { enabled });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, click, dismiss, role]);

  useEffect(() => {
    let active = true;
    setResolved(null);
    if (handler && id) {
      void Promise.resolve().then(() => handler.resolveUser(id)).then(user => {
        if (active && user?.id === id) setResolved(user);
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [handler, id]);

  useEffect(() => {
    if (!open || !detailsHandler || !id) return;
    let active = true;
    const controller = new AbortController();
    setLoaded(null);
    void Promise.resolve().then(() => detailsHandler.call(handler, id, { signal: controller.signal })).then(user => {
      if (!active) return;
      if (user && user.id !== id) throw new Error('Mention profile ID mismatch');
      setLoaded({ id, handler, detailsHandler, state: user ? { status: 'ready', user } : { status: 'unavailable' } });
    }).catch(() => {
      if (active) setLoaded({ id, handler, detailsHandler, state: { status: 'error' } });
    });
    return () => { active = false; controller.abort(); };
  }, [open, handler, detailsHandler, id, attempt]);

  const label = resolved?.id === id ? resolved.label : storedLabel;
  const portalRoot = editor.view.dom.closest<HTMLElement>('.radix-themes') || undefined;
  return <NodeViewWrapper as="span" contentEditable={false} className="mention-inline" data-type="mention" data-id={id} data-label={storedLabel}>
    {enabled ? <button
      type="button"
      className="mention-chip mention-profile-trigger"
      ref={refs.setReference}
      {...getReferenceProps({ 'aria-label': `User details for ${label}` })}
    >@{label}</button> : <span className="mention-chip">@{label}</span>}
    {open && enabled && <FloatingPortal root={portalRoot}>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="mention-profile-card"
        contentEditable={false}
        {...getFloatingProps({ 'aria-label': `User details for ${label}` })}
      >
        <div aria-live="polite" aria-atomic="true" aria-busy={profile.status === 'loading'}>
          {profile.status === 'loading' && <p className="mention-profile-message" role="status">Loading user details…</p>}
          {profile.status === 'unavailable' && <>
            <strong>{label}</strong>
            <p className="mention-profile-message">User unavailable</p>
          </>}
          {profile.status === 'error' && <>
            <p className="mention-profile-message" role="status">Couldn’t load user details.</p>
          </>}
          {profile.status === 'ready' && <div className="mention-profile-content">
            <MentionAvatar key={profile.user.avatarUrl} user={profile.user} />
            <div className="mention-profile-info">
              <strong>{profile.user.label || label}</strong>
              {profile.user.email && <span className="mention-profile-email">{profile.user.email}</span>}
              {profile.user.spaceRole && <span className="mention-profile-role">{profile.user.spaceRole}</span>}
            </div>
          </div>}
          {(profile.status === 'error' || (profile.status === 'loading' && attempt > 0)) && <button
            key="retry"
            type="button"
            className="mention-profile-retry"
            aria-disabled={profile.status === 'loading'}
            onClick={() => {
              if (profile.status === 'error') setAttempt(value => value + 1);
            }}
          >{profile.status === 'loading' ? 'Retrying…' : 'Retry'}</button>}
        </div>
      </div>
    </FloatingPortal>}
  </NodeViewWrapper>;
}
