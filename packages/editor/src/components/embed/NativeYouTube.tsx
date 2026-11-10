import React, { useEffect, useId, useRef } from 'react';
import type { YouTubeFrame, YouTubeHandler } from '../../types';

/** Native media is clipped to the DOM placeholder; it never receives document
 * HTML, arbitrary URLs, app cookies, auth tokens or Wails message handlers. */
export function NativeYouTube({ videoID, handler, onError, onReady }: {
  videoID: string; handler: YouTubeHandler; onError: () => void; onReady: () => void;
}) {
  const id = `youtube-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const host = useRef<HTMLDivElement>(null);
  const error = useRef(onError); error.current = onError;
  const ready = useRef(onReady); ready.current = onReady;
  useEffect(() => {
    const element = host.current; if (!element) return;
    let disposed = false, queued = 0, busy = false, dirty = false;
    let previous = '';
    const update = async () => {
      queued = 0;
      if (disposed) return;
      if (busy) { dirty = true; return; }
      const rect = element.getBoundingClientRect();
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
        if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
      }
      // Native views sit above DOM content. Hide them under menus/dialogs and
      // clip beneath the app's sticky document controls while scrolling.
      for (const toolbar of document.querySelectorAll('[aria-label="Document editing tools"]')) {
        const bounds = toolbar.getBoundingClientRect();
        if (bounds.top <= top && bounds.bottom > top) top = bounds.bottom;
      }
      // Clip under other DOM content (for example the sticky app header).
      for (let step = 0; step < 8 && bottom > top; step++) {
        const hit = document.elementFromPoint((left+right)/2, top+1);
        if (!hit || element.contains(hit)) break;
        const obstruction = hit.closest('header, nav, [role="toolbar"], [aria-label="Document editing tools"]') || hit;
        const edge = obstruction.getBoundingClientRect().bottom;
        if (edge <= top) break;
        top = Math.min(bottom, edge);
      }
      const overlay = Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [role="menu"], [role="listbox"]'))
        .some(node => node.getClientRects().length > 0 && node.getAttribute('aria-hidden') !== 'true');
      const hidden = document.hidden || !element.getClientRects().length || !!overlay || right <= left || bottom <= top;
      const frame: YouTubeFrame = { x: rect.left, y: rect.top, width: rect.width, height: rect.height,
        clipX: left, clipY: top, clipWidth: Math.max(0, right-left), clipHeight: Math.max(0, bottom-top),
        viewportWidth: innerWidth, viewportHeight: innerHeight };
      const signature = hidden ? 'hidden' : JSON.stringify(frame);
      if (signature === previous) return;
      previous = signature; busy = true;
      try { if (hidden) await handler.hide(id); else { await handler.show(id, videoID, frame); if (!disposed) ready.current(); } }
      catch { if (!disposed) error.current(); }
      finally { busy = false; if (dirty) { dirty = false; schedule(); } }
    };
    const schedule = () => { if (!disposed && !queued) queued = requestAnimationFrame(() => void update()); };
    const resize = new ResizeObserver(schedule); resize.observe(element);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','style','open','role','data-state'] });
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => {
      disposed = true; cancelAnimationFrame(queued); resize.disconnect(); mutations.disconnect();
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
      void handler.close(id).catch(() => {});
    };
  }, [id, videoID, handler]);
  return <div ref={host} role="group" aria-label="YouTube video player" style={{ width: '100%', height: '100%', minHeight: 200 }}>Loading YouTube player…</div>;
}
