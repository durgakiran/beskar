import { useCallback } from 'react';

export function useWhiteboardSwipeGuard() {
    return useCallback((board: HTMLDivElement | null) => {
        if (!board) return;

        const onWheel = (event: WheelEvent) => {
            // Glideboard already consumes canvas pan and zoom. Handle swipes
            // that start on the surrounding controls and reach this listener.
            if (!event.cancelable || event.defaultPrevented || event.ctrlKey || event.metaKey) return;

            const deltaX = event.shiftKey ? event.deltaX || event.deltaY : event.deltaX;
            if (!deltaX || (!event.shiftKey && Math.abs(deltaX) <= Math.abs(event.deltaY))) return;

            for (const target of event.composedPath()) {
                if (target === board) break;
                if (!(target instanceof Element)) continue;
                const maxScroll = target.scrollWidth - target.clientWidth;
                if (maxScroll <= 0) continue;

                const { overflowX, direction } = getComputedStyle(target);
                if (overflowX !== 'auto' && overflowX !== 'scroll') continue;
                const min = direction === 'rtl' ? -maxScroll : 0;
                const max = direction === 'rtl' ? 0 : maxScroll;
                if (deltaX < 0 ? target.scrollLeft > min : target.scrollLeft < max) return;
            }

            // Safari can navigate at a scroll boundary despite overscroll-behavior.
            event.preventDefault();
        };

        board.addEventListener('wheel', onWheel, { passive: false });
        return () => board.removeEventListener('wheel', onWheel);
    }, []);
}
