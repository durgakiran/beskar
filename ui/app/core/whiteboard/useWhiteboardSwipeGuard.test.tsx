import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWhiteboardSwipeGuard } from './useWhiteboardSwipeGuard';

function Board() {
    const ref = useWhiteboardSwipeGuard();
    return (
        <>
            <div ref={ref}>
                <div data-testid="controls" />
                <div data-testid="tabs" style={{ overflowX: 'auto' }} />
            </div>
            <div data-testid="outside" />
        </>
    );
}

function wheel(target: HTMLElement, options: WheelEventInit) {
    return target.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...options,
    }));
}

afterEach(cleanup);

describe('useWhiteboardSwipeGuard', () => {
    it('cancels horizontal swipes in either direction within the board', () => {
        const { getByTestId } = render(<Board />);
        const controls = getByTestId('controls');
        expect(wheel(controls, { deltaX: -30, deltaY: 2 })).toBe(false);
        expect(wheel(controls, { deltaX: 30 })).toBe(false);
        expect(wheel(getByTestId('outside'), { deltaX: -30 })).toBe(true);
    });

    it('preserves vertical scroll and modified wheel input for zoom', () => {
        const { getByTestId } = render(<Board />);
        const controls = getByTestId('controls');
        expect(wheel(controls, { deltaX: 2, deltaY: 30 })).toBe(true);
        expect(wheel(controls, { deltaX: 30, ctrlKey: true })).toBe(true);
        expect(wheel(controls, { deltaX: 30, metaKey: true })).toBe(true);
    });

    it('lets tabs scroll until they reach the boundary in the swipe direction', () => {
        const { getByTestId } = render(<Board />);
        const tabs = getByTestId('tabs');
        Object.defineProperties(tabs, {
            clientWidth: { value: 100 },
            scrollWidth: { value: 200 },
        });

        tabs.scrollLeft = 50;
        expect(wheel(tabs, { deltaX: -30 })).toBe(true);
        expect(wheel(tabs, { deltaX: 30 })).toBe(true);
        tabs.scrollLeft = 0;
        expect(wheel(tabs, { deltaX: -30 })).toBe(false);
        tabs.scrollLeft = 100;
        expect(wheel(tabs, { deltaX: 30 })).toBe(false);
    });

    it('lets the canvas handle its own wheel input and removes the guard on unmount', () => {
        const { getByTestId, unmount } = render(<Board />);
        const controls = getByTestId('controls');
        const board = controls.parentElement!;
        const handleCanvasWheel = vi.fn((event: WheelEvent) => event.preventDefault());
        controls.addEventListener('wheel', handleCanvasWheel);
        expect(wheel(controls, { deltaX: 30 })).toBe(false);
        expect(handleCanvasWheel).toHaveBeenCalledOnce();

        unmount();
        expect(wheel(board, { deltaX: 30 })).toBe(true);
    });
});
