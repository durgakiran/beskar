import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlideboardController } from './GlideboardController';
import { GlideboardProvider } from './GlideboardContext';
import { Toolbar } from './Toolbar';

afterEach(cleanup);

describe('Toolbar Phase 3 asset surfaces', () => {
  it('opens image import, asset libraries, and layers with controlled state', async () => {
    const controller = new GlideboardController({ sessionKey: 'toolbar-phase3' });
    const onImport = vi.fn();
    const onAssets = vi.fn();
    const onLayers = vi.fn();
    try {
      const view = render(
        <GlideboardProvider controller={controller}>
          <Toolbar assetsAvailable onRequestAssetImport={onImport} onToggleAssets={onAssets} onToggleLayers={onLayers} />
        </GlideboardProvider>,
      );
      const importButton = screen.getByRole('button', { name: 'Import image' });
      fireEvent.click(importButton);
      expect(onImport).toHaveBeenCalledWith(importButton);
      fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
      fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
      expect(onAssets).toHaveBeenCalledOnce();
      expect(onLayers).toHaveBeenCalledOnce();
      expect(screen.queryByRole('button', { name: 'Main menu' })).toBeNull();

      act(() => controller.setCurrentTool('asset'));
      view.rerender(
        <GlideboardProvider controller={controller}>
          <Toolbar readOnly assetsAvailable assetsOpen onToggleAssets={onAssets} />
        </GlideboardProvider>,
      );
      expect(screen.queryByRole('button', { name: 'Import image' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Assets' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Layers' })).toBeNull();
    } finally {
      await controller.dispose();
    }
  });

  it('renders the default toolbar without optional asset controls', async () => {
    const controller = new GlideboardController({ sessionKey: 'toolbar-defaults' });
    try {
      render(<GlideboardProvider controller={controller}><Toolbar /></GlideboardProvider>);
      expect(screen.queryByRole('button', { name: 'Assets' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Layers' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Show grid' }).closest('[data-glideboard-role="toolbar-actions"]')).toBeTruthy();
    } finally {
      await controller.dispose();
    }
  });

  it('updates global grid and snapping settings from the action toolbar', async () => {
    const controller = new GlideboardController({ sessionKey: 'toolbar-snapping' });
    try {
      render(<GlideboardProvider controller={controller}><Toolbar /></GlideboardProvider>);

      fireEvent.click(screen.getByRole('button', { name: 'Show grid' }));
      fireEvent.click(screen.getByRole('button', { name: 'Snap to grid' }));
      fireEvent.click(screen.getByRole('button', { name: 'Snap to objects' }));
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Grid size' }), { target: { value: '1' } });

      expect(controller.editor.snapping.settings.peek()).toMatchObject({
        showGrid: false,
        snapToGrid: true,
        snapToObjects: false,
        gridSize: 2,
      });
    } finally {
      await controller.dispose();
    }
  });

  it('uses split toolbars by default and supports the legacy vertical layout', async () => {
    const controller = new GlideboardController({ sessionKey: 'toolbar-layout' });
    try {
      const view = render(<GlideboardProvider controller={controller}><Toolbar assetsAvailable /></GlideboardProvider>);
      expect(screen.getByRole('button', { name: 'Assets' }).closest('[data-glideboard-role="toolbar-actions"]')).toBeTruthy();
      expect(document.querySelector('[data-glideboard-role="toolbar"]')?.getAttribute('data-toolbar-layout')).toBe('split');
      expect(screen.getByRole('button', { name: 'Select' }).style.width).toBe('32px');
      expect(screen.getByRole('button', { name: 'Undo' }).style.height).toBe('32px');

      view.rerender(
        <GlideboardProvider controller={controller}><Toolbar layout="vertical" assetsAvailable /></GlideboardProvider>,
      );
      expect(document.querySelector('[data-glideboard-role="toolbar-actions"]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Assets' }).closest('[data-glideboard-role="toolbar-tools"]')).toBeTruthy();
      expect(document.querySelector('[data-glideboard-role="toolbar"]')?.getAttribute('data-toolbar-layout')).toBe('vertical');
    } finally {
      await controller.dispose();
    }
  });

  it('falls back to the default active tool and connector preset while signals initialize', async () => {
    const controller = new GlideboardController({ sessionKey: 'toolbar-signal-fallbacks' });
    try {
      (controller.editor.currentToolId as any).value = null;
      (controller.arrowPresetSignal as any).value = null;

      render(<GlideboardProvider controller={controller}><Toolbar /></GlideboardProvider>);

      expect(screen.getByTitle('Select (V)').getAttribute('data-isactive')).toBe('true');
      expect(screen.getByTitle('Connector (Arrow)')).toBeTruthy();
    } finally {
      await controller.dispose();
    }
  });
});
