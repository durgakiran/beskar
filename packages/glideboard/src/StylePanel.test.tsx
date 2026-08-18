import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArrowUtil, type AnyRecord } from '@durgakiran/glideline';
import { GlideboardProvider } from './GlideboardContext';
import { GlideboardController } from './GlideboardController';
import { PositionSizeBar, StylePanel } from './StylePanel';
import { Canvas } from './Canvas';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel(controller: GlideboardController) {
  return render(
    <GlideboardProvider controller={controller}>
      <StylePanel />
      <PositionSizeBar />
    </GlideboardProvider>,
  );
}

function importTestAsset(controller: GlideboardController, type: 'raster-image' | 'sanitized-svg', id: string) {
  const common = {
    id,
    kind: 'asset',
    type,
    schemaVersion: 1,
    meta: {},
  };
  const record: AnyRecord = type === 'raster-image'
    ? { ...common, props: { hash: 'a'.repeat(64), mimeType: 'image/png', byteLength: 128, width: 400, height: 200 } }
    : { ...common, props: {
      hash: 'b'.repeat(64), mimeType: 'image/svg+xml', sanitizerVersion: 1, byteLength: 128,
      width: 100, height: 50, viewBox: [0, 0, 100, 50],
      paths: [{ d: 'M0 0h100v50H0z', fill: '#000000' }],
    } };
  const report = controller.editor.importRecords([record]);
  return report.idMap[id] ?? id;
}

describe('StylePanel text targeting', () => {
  it('uses compact icon controls for default styles when nothing is selected', () => {
    const controller = new GlideboardController({ sessionKey: 'compact-default-style-panel' });
    try {
      const view = renderPanel(controller);

      expect(view.getByRole('group', { name: 'Default color' })).toBeDefined();
      expect(view.getByRole('group', { name: 'Default fill' })).toBeDefined();
      expect(view.getByRole('group', { name: 'Default stroke style' })).toBeDefined();
      expect(view.getByRole('group', { name: 'Default stroke width' })).toBeDefined();
      expect(view.getByRole('group', { name: 'Default font family' })).toBeDefined();
      expect(view.getByRole('group', { name: 'Default font size' })).toBeDefined();
      expect(view.getByRole('group', { name: 'Default label alignment' })).toBeDefined();
      expect(view.queryByText('Stroke / Fill Color')).toBeNull();

      const panel = view.container.querySelector<HTMLElement>('[data-glideboard-role="default-style-panel"]')!;
      expect(panel.querySelectorAll('[data-glideboard-role="core-style-controls"]')).toHaveLength(1);
      expect(panel.style.width).toBe('148px');
      expect(panel.style.top).toBe('12px');
      expect(panel.style.right).toBe('12px');
      expect(view.getByRole('group', { name: 'Default color' }).style.gridTemplateColumns)
        .toBe('repeat(5, 28px)');
      expect(view.getByRole('group', { name: 'Default color' }).querySelectorAll('button')).toHaveLength(15);
      expect(view.getByRole('button', { name: 'pink' })).toBeDefined();
      expect(view.getByRole('group', { name: 'Default stroke style' }).style.gridTemplateColumns)
        .toBe('repeat(5, 28px)');
      const pressureButton = view.getByRole('button', { name: 'Pressure-sensitive stroke' });
      expect(pressureButton.style.width).toBe('28px');
      expect(pressureButton.className).toContain('glideboard-style-option');
      expect(view.queryByRole('group', { name: 'Grid and snapping' })).toBeNull();
      expect(view.container.querySelectorAll('[data-fill-preview="pattern"] circle')).toHaveLength(9);
      expect(view.container.querySelectorAll('[data-fill-preview="lined"] line')).toHaveLength(4);
      expect(view.container.querySelector('[data-fill-preview="pattern"] rect:last-child')?.getAttribute('stroke'))
        .toBe('var(--gray-12, #221f26)');
      expect(view.getByRole('slider', { name: 'Default opacity' }).className).toContain('glideboard-opacity-slider');

      fireEvent.click(view.getByRole('button', { name: 'blue' }));
      expect(view.container.querySelector('[data-fill-preview="pattern"] rect:last-child')?.getAttribute('stroke'))
        .toBe('var(--gray-12, #221f26)');
      fireEvent.click(view.getByRole('button', { name: 'Pattern fill' }));
      fireEvent.click(view.getByRole('button', { name: 'Pressure-sensitive stroke' }));
      expect(controller.editor.activeStyles.peek()).toMatchObject({
        strokeStyle: 'solid',
        pressureSensitive: true,
      });
      fireEvent.click(view.getByRole('button', { name: 'Dashed stroke' }));
      fireEvent.click(view.getByRole('button', { name: 'Thick stroke width' }));
      fireEvent.click(view.getByRole('button', { name: 'Center labels' }));
      fireEvent.change(view.getByRole('slider', { name: 'Default opacity' }), { target: { value: '0.6' } });

      expect(controller.editor.activeStyles.peek()).toMatchObject({
        color: 'blue',
        labelColor: 'blue',
        fillStyle: 'pattern',
        strokeStyle: 'dashed',
        pressureSensitive: false,
        strokeWidth: 'thick',
        textAlign: 'center',
        opacity: 0.6,
      });
    } finally {
      void controller.dispose();
    }
  });

  it('shows text-only controls for standalone text', () => {
    const controller = new GlideboardController({ sessionKey: 'text-style-panel' });
    try {
      const id = controller.editor.createShape({
        type: 'text',
        x: 20,
        y: 30,
        props: { text: 'Text', font: 'sans', fontSize: 'md', color: 'black' },
      });
      controller.editor.setSelectedShapeIds([id]);
      const view = renderPanel(controller);

      expect(view.queryByText('Text Color')).toBeNull();
      expect(view.queryByText('Font Family')).toBeNull();
      expect(view.queryByText('Font Size')).toBeNull();
      expect(view.queryByText('Stroke / Fill Color')).toBeNull();
      expect(view.queryByText('Stroke Width')).toBeNull();
      expect(view.queryByText('Fill')).toBeNull();
      const panel = view.container.querySelector<HTMLElement>('[data-glideboard-role="selected-style-panel"]')!;
      expect(panel.querySelectorAll('[data-glideboard-role="core-style-controls"]')).toHaveLength(1);
      expect(panel.style.width).toBe('148px');
      expect(panel.style.padding).toBe('0px');
      expect(panel.style.gap).toBe('0');
      expect(view.getByRole('group', { name: 'Text color' }).style.gridTemplateColumns)
        .toBe('repeat(5, 28px)');
      expect(view.getByRole('group', { name: 'Font family' }).style.gridTemplateColumns)
        .toBe('repeat(5, 28px)');
      expect(view.getByRole('button', { name: 'Sans font' }).getAttribute('data-isactive')).toBe('true');
      const opacitySlider = view.getByRole('slider', { name: 'Shape opacity' });
      const dividers = view.container.querySelectorAll('[data-glideboard-role="style-options-divider"]');
      expect(dividers).toHaveLength(1);
      expect(dividers[0]?.getAttribute('data-divider-section')).toBe('appearance-typography');
      fireEvent.click(view.getByRole('button', { name: 'pink' }));
      fireEvent.change(opacitySlider, { target: { value: '0.5' } });
      expect(controller.editor.getShape(id)?.props).toMatchObject({ color: 'pink', opacity: 0.5 });
      expect(controller.editor.activeStyles.peek()).toMatchObject({ color: 'pink', labelColor: 'pink', opacity: 0.5 });
      expect(view.queryByRole('group', { name: 'Grid and snapping' })).toBeNull();
      expect(view.queryByRole('checkbox')).toBeNull();
    } finally {
      void controller.dispose();
    }
  });

  it('uses the edited or label-targeted shape while selection is cleared', () => {
    const controller = new GlideboardController({ sessionKey: 'label-style-panel' });
    try {
      const id = controller.editor.createShape({
        type: 'box',
        x: 20,
        y: 30,
        props: { label: 'Label' },
      });
      controller.editor.setSelectedShapeIds([id]);
      controller.textStyleTargetIdSignal.value = id;
      const view = renderPanel(controller);

      expect(view.queryByText('Text Color')).toBeNull();
      expect(view.queryByText('Fill')).toBeNull();
      expect(view.getByRole('slider', { name: 'Shape opacity' })).toBeDefined();

      act(() => controller.editor.startEditing(id));
      expect(controller.editor.getSelectedShapeIds()).toEqual([]);
      expect(view.queryByText('Text Color')).toBeNull();
      expect(view.queryByText('Stroke Width')).toBeNull();

      const tomato = view.getByTitle('tomato');
      expect(fireEvent.pointerDown(tomato)).toBe(false);
      expect(controller.editor.editingShapeId.peek()).toBe(id);
      fireEvent.click(tomato);
      expect(controller.editor.getShape(id)?.props.labelColor).toBe('tomato');
      fireEvent.change(view.getByRole('slider', { name: 'Shape opacity' }), { target: { value: '0.6' } });
      expect(controller.editor.getShape(id)?.props.opacity).toBe(0.6);
      expect(controller.editor.activeStyles.peek()).toMatchObject({
        color: 'tomato', labelColor: 'tomato', opacity: 0.6,
      });
      act(() => controller.editor.cancelEditing(false));
    } finally {
      void controller.dispose();
    }
  });
});

describe('StylePanel asset inspector', () => {
	it('offers accessible replace/download commands and reports picker and download outcomes', async () => {
		const controller = new GlideboardController({ sessionKey: 'asset-commands-panel' });
		const createObjectURL = vi.fn(() => 'blob:download');
		const revokeObjectURL = vi.fn();
		vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		try {
			const assetId = importTestAsset(controller, 'raster-image', 'asset:commands-raster');
			const shapeId = controller.editor.createShape({
				type: 'raster-image', x: 0, y: 0,
				props: { w: 200, h: 100, assetId },
			});
			controller.editor.setSelectedShapeIds([shapeId]);
			const replace = vi.spyOn(controller, 'replaceAsset').mockResolvedValue(shapeId);
			const download = vi.spyOn(controller, 'downloadAsset').mockResolvedValue({
				bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', fileName: 'original.png',
			});
			const view = renderPanel(controller);

			expect(view.getByRole('group', { name: 'Asset commands' })).toBeDefined();
			const picker = view.getByLabelText('Choose replacement image') as HTMLInputElement;
			const file = new File([new Uint8Array([1, 2, 3])], 'replacement.png', { type: 'image/png' });
			fireEvent.change(picker, { target: { files: [file] } });
			await waitFor(() => expect(replace).toHaveBeenCalledWith(shapeId, expect.objectContaining({ kind: 'raster', name: 'replacement.png' })));
			expect(view.getByRole('status').textContent).toContain('Replaced');

			replace.mockRejectedValueOnce(new Error('Replacement storage is offline.'));
			fireEvent.change(picker, { target: { files: [file] } });
			await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Replace failed'));
			fireEvent.click(view.getByRole('button', { name: 'Retry replace' }));
			await waitFor(() => expect(view.getByRole('status').textContent).toContain('Replaced'));

			fireEvent.click(view.getByRole('button', { name: 'Download' }));
			await waitFor(() => expect(download).toHaveBeenCalledWith(shapeId));
			expect(createObjectURL).toHaveBeenCalled();
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
			expect(click).toHaveBeenCalled();
			expect(view.getByRole('status').textContent).toContain('Download started');

			download.mockResolvedValueOnce({ bytes: new Uint8Array([4]), mimeType: 'image/jpeg' });
			fireEvent.click(view.getByRole('button', { name: 'Download' }));
			await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
			download.mockResolvedValueOnce({ bytes: new Uint8Array([5]), mimeType: 'image/svg+xml' });
			fireEvent.click(view.getByRole('button', { name: 'Download' }));
			await waitFor(() => expect(click).toHaveBeenCalledTimes(3));
			download.mockResolvedValueOnce({ bytes: new Uint8Array([6]), mimeType: 'application/x-custom' });
			fireEvent.click(view.getByRole('button', { name: 'Download' }));
			await waitFor(() => expect(click).toHaveBeenCalledTimes(4));

			download.mockRejectedValueOnce(new Error('Original bytes are unavailable.'));
			fireEvent.click(view.getByRole('button', { name: 'Download' }));
			await waitFor(() => expect(view.getByRole('alert').textContent).toContain('unavailable'));
			expect(view.getByRole('button', { name: 'Retry download' })).toBeDefined();
			fireEvent.click(view.getByRole('button', { name: 'Dismiss download error' }));
			expect(view.queryByRole('alert')).toBeNull();

			act(() => { controller.readOnlySignal.value = true; });
			expect((view.getByRole('button', { name: 'Replace' }) as HTMLButtonElement).disabled).toBe(true);
			expect((view.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(false);
		} finally {
			click.mockRestore();
			await controller.dispose();
		}
	});

  it('treats replacement and download cancellation as terminal aborts without error alerts', async () => {
    const controller = new GlideboardController({ sessionKey: 'asset-command-aborts' });
    try {
      const assetId = importTestAsset(controller, 'raster-image', 'asset:abort-raster');
      const shapeId = controller.editor.createShape({ type: 'raster-image', x: 0, y: 0, props: { w: 10, h: 10, assetId } });
      controller.editor.setSelectedShapeIds([shapeId]);
      vi.spyOn(controller, 'replaceAsset').mockRejectedValue(new DOMException('cancelled', 'AbortError'));
      vi.spyOn(controller, 'downloadAsset').mockRejectedValue(new DOMException('cancelled', 'AbortError'));
      const view = renderPanel(controller);
      const picker = view.getByLabelText('Choose replacement image');
      fireEvent.change(picker, { target: { files: [new File(['<svg/>'], 'cancel.svg', { type: 'image/svg+xml' })] } });
      await act(async () => { await Promise.resolve(); });
      expect(view.queryByRole('alert')).toBeNull();
      fireEvent.click(view.getByRole('button', { name: 'Download' }));
      await act(async () => { await Promise.resolve(); });
      expect(view.queryByRole('alert')).toBeNull();
    } finally {
      await controller.dispose();
    }
  });

  it('persists the selected asset aspect lock and uses it for numeric resize', () => {
    const controller = new GlideboardController({ sessionKey: 'asset-aspect-panel' });
    try {
      const rasterAssetId = importTestAsset(controller, 'raster-image', 'asset:panel-raster');
      const svgAssetId = importTestAsset(controller, 'sanitized-svg', 'asset:panel-svg');
      const unlockedId = controller.editor.createShape({
        type: 'raster-image', x: 0, y: 0,
        props: { w: 200, h: 100, assetId: rasterAssetId, aspectLocked: false },
      });
      const lockedId = controller.editor.createShape({
        type: 'sanitized-svg', x: 300, y: 0,
        props: { w: 120, h: 60, assetId: svgAssetId, aspectLocked: true },
      });
      controller.editor.setSelectedShapeIds([unlockedId]);
      const view = renderPanel(controller);

      const aspectButton = view.getByLabelText('Aspect ratio');
      expect(aspectButton.getAttribute('title')).toBe('Lock aspect ratio');
      const width = view.getByRole('spinbutton', { name: /^W$/ });
      fireEvent.change(width, { target: { value: '300' } });
      fireEvent.blur(width);
      expect(controller.editor.getShape(unlockedId)?.props).toMatchObject({
        w: 300, h: 100, aspectLocked: false,
      });

      fireEvent.click(aspectButton);
      expect(controller.editor.getShape(unlockedId)?.props.aspectLocked).toBe(true);
      expect(aspectButton.getAttribute('title')).toBe('Unlock aspect ratio');
      fireEvent.change(view.getByRole('spinbutton', { name: /^W$/ }), { target: { value: '450' } });
      fireEvent.blur(view.getByRole('spinbutton', { name: /^W$/ }));
      expect(controller.editor.getShape(unlockedId)?.props).toMatchObject({ w: 450, h: 150 });

      act(() => controller.editor.setSelectedShapeIds([lockedId]));
      expect(view.getByLabelText('Aspect ratio').getAttribute('title')).toBe('Unlock aspect ratio');
      act(() => controller.editor.setSelectedShapeIds([unlockedId]));
      expect(view.getByLabelText('Aspect ratio').getAttribute('title')).toBe('Unlock aspect ratio');
    } finally {
      void controller.dispose();
    }
  });

  it('edits raster alt text and applies only valid nondestructive crops', () => {
    const controller = new GlideboardController({ sessionKey: 'raster-inspector-panel' });
    try {
      const assetId = importTestAsset(controller, 'raster-image', 'asset:crop-raster');
      const id = controller.editor.createShape({
        type: 'raster-image', x: 0, y: 0,
        props: { w: 200, h: 100, assetId, crop: { x: 0, y: 0, w: 1, h: 1 } },
      });
      controller.editor.setSelectedShapeIds([id]);
      const view = renderPanel(controller);

      fireEvent.change(view.getByLabelText('Alt text'), { target: { value: 'Product preview' } });
      fireEvent.blur(view.getByLabelText('Alt text'));
      expect(controller.editor.getShape(id)?.props.altText).toBe('Product preview');

      fireEvent.change(view.getByLabelText('Crop X'), { target: { value: '0.8' } });
      fireEvent.change(view.getByLabelText('Crop W'), { target: { value: '0.4' } });
      fireEvent.click(view.getByText('Apply crop'));
      expect(view.getByRole('alert').textContent).toMatch(/within 0 to 1/i);
      expect(controller.editor.getShape(id)?.props.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });

      fireEvent.change(view.getByLabelText('Crop X'), { target: { value: '0.2' } });
      fireEvent.change(view.getByLabelText('Crop Y'), { target: { value: '0.1' } });
      fireEvent.change(view.getByLabelText('Crop W'), { target: { value: '0.6' } });
      fireEvent.change(view.getByLabelText('Crop H'), { target: { value: '0.7' } });
      fireEvent.click(view.getByText('Apply crop'));
      expect(view.queryByRole('alert')).toBeNull();
      expect(controller.editor.getShape(id)?.props.crop).toEqual({ x: 0.2, y: 0.1, w: 0.6, h: 0.7 });

      const reset = view.getByRole('button', { name: 'Reset crop' });
      reset.focus();
      fireEvent.click(reset);
      expect(document.activeElement).toBe(reset);
      expect(view.getByLabelText('Crop X')).toHaveProperty('value', '0');
      expect(view.getByLabelText('Crop Y')).toHaveProperty('value', '0');
      expect(view.getByLabelText('Crop W')).toHaveProperty('value', '1');
      expect(view.getByLabelText('Crop H')).toHaveProperty('value', '1');
      expect(controller.editor.getShape(id)?.props.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });

      fireEvent.click(view.getByRole('button', { name: 'Apply crop' }));
      expect(controller.editor.getShape(id)?.props.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    } finally {
      void controller.dispose();
    }
  });

  it('contains keyboard and pointer events while preserving the selected crop target', () => {
    const controller = new GlideboardController({ sessionKey: 'asset-input-boundary' });
    try {
      const assetId = importTestAsset(controller, 'raster-image', 'asset:input-boundary');
      const id = controller.editor.createShape({
        type: 'raster-image', x: 0, y: 0,
        props: { w: 200, h: 100, assetId, crop: { x: 0, y: 0, w: 1, h: 1 } },
      });
      controller.editor.setSelectedShapeIds([id]);
      const leakedKey = vi.fn(() => controller.editor.createShape({
        type: 'text', x: 20, y: 20, props: { text: 'leaked' },
      }));
      const view = render(
        <div
          onKeyDown={leakedKey}
          onPointerDown={() => controller.editor.setSelectedShapeIds([])}
        >
          <GlideboardProvider controller={controller}>
            <StylePanel />
          </GlideboardProvider>
        </div>,
      );

      const altText = view.getByLabelText('Alt text');
      fireEvent.pointerDown(altText);
      fireEvent.change(altText, { target: { value: 'Accessible preview' } });
      fireEvent.keyDown(altText, { key: 't' });
      expect(leakedKey).not.toHaveBeenCalled();
      expect(controller.editor.getSelectedShapeIds()).toEqual([id]);
      expect(controller.editor.serialize().records.filter(record => record.kind === 'shape')).toHaveLength(1);
      fireEvent.blur(altText);
      expect(controller.editor.getShape(id)?.props.altText).toBe('Accessible preview');

      const cropX = view.getByLabelText('Crop X');
      fireEvent.pointerDown(cropX);
      fireEvent.change(cropX, { target: { value: '0.25' } });
      fireEvent.change(view.getByLabelText('Crop W'), { target: { value: '0.5' } });
      expect(controller.editor.getSelectedShapeIds()).toEqual([id]);
      fireEvent.click(view.getByText('Apply crop'));
      expect(controller.editor.getShape(id)?.props.crop).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
      expect(controller.editor.getSelectedShapeIds()).toEqual([id]);
      fireEvent.click(view.getByText('Reset crop'));
      expect(controller.editor.getShape(id)?.props.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    } finally {
      void controller.dispose();
    }
  });

  it('edits SVG aria alt text and immediately repaints the monochrome theme color', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const controller = new GlideboardController({ sessionKey: 'svg-inspector-panel' });
    try {
      const assetId = importTestAsset(controller, 'sanitized-svg', 'asset:inspector-svg');
      const id = controller.editor.createShape({
        type: 'sanitized-svg', x: 0, y: 0,
        props: { w: 200, h: 100, assetId, colorMode: 'native', themeColor: '#000000' },
      });
      controller.editor.setSelectedShapeIds([id]);
      const view = render(
        <GlideboardProvider controller={controller}>
          <Canvas />
          <StylePanel />
        </GlideboardProvider>,
      );
      const themeColor = view.getByLabelText('Theme color') as HTMLInputElement;
      const native = view.getByRole('button', { name: 'Native' });
      const monochrome = view.getByRole('button', { name: 'Monochrome' });

      expect(themeColor.disabled).toBe(true);
      expect(native.getAttribute('aria-pressed')).toBe('true');
      expect(monochrome.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(monochrome);
      expect(controller.editor.getShape(id)?.props.colorMode).toBe('monochrome');
      expect(themeColor.disabled).toBe(false);
      expect(native.getAttribute('aria-pressed')).toBe('false');
      expect(monochrome.getAttribute('aria-pressed')).toBe('true');
      fireEvent.input(themeColor, { target: { value: '#12ab34' } });
      expect(controller.editor.getShape(id)?.props.themeColor).toBe('#12ab34');
      await waitFor(() => expect(
        view.container.querySelector(`[data-shape-id="${id}"] path`)?.getAttribute('fill'),
      ).toBe('#12ab34'));
      fireEvent.change(view.getByLabelText('Alt text'), { target: { value: 'Brand symbol' } });
      fireEvent.blur(view.getByLabelText('Alt text'));
      expect(controller.editor.getShape(id)?.props.altText).toBe('Brand symbol');
      await waitFor(() => expect(
        view.container.querySelector(`[data-shape-id="${id}"] [role="img"]`)?.getAttribute('aria-label'),
      ).toBe('Brand symbol'));

      fireEvent.click(native);
      expect(controller.editor.getShape(id)?.props.colorMode).toBe('native');
      expect(themeColor.disabled).toBe(true);
      expect(native.getAttribute('aria-pressed')).toBe('true');
      expect(monochrome.getAttribute('aria-pressed')).toBe('false');
    } finally {
      void controller.dispose();
    }
  });
});

describe('StylePanel command coverage', () => {
  it('updates opacity for the selected shape', () => {
    const controller = new GlideboardController({ sessionKey: 'selected-opacity' });
    try {
      const id = controller.editor.createShape({
        type: 'box', x: 0, y: 0, props: { w: 200, h: 100, opacity: 0.8 },
      });
      controller.editor.setSelectedShapeIds([id]);
      const view = renderPanel(controller);

      const slider = view.getByRole('slider', { name: 'Shape opacity' });
      expect(slider.getAttribute('value')).toBe('0.8');
      expect(view.queryByText('Stroke / Fill Color')).toBeNull();
      expect(view.queryByText('Text Color')).toBeNull();
      const colorGroup = view.getByRole('group', { name: 'Shape color' });
      expect(colorGroup.compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const divider = view.container.querySelector<HTMLElement>('[data-glideboard-role="style-options-divider"]')!;
      const fill = view.getByRole('group', { name: 'Fill' });
      const strokeStyle = view.getByRole('group', { name: 'Stroke style' });
      const strokeWidth = view.getByRole('group', { name: 'Stroke width' });
      const typographyDivider = view.container.querySelector<HTMLElement>('[data-divider-section="appearance-typography"]')!;
      const fontFamily = view.getByRole('group', { name: 'Font family' });
      const fontSize = view.getByRole('group', { name: 'Font size' });
      const textAlign = view.getByRole('group', { name: 'Label alignment' });
      expect(slider.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(divider.compareDocumentPosition(fill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(fill.compareDocumentPosition(strokeStyle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(strokeStyle.compareDocumentPosition(strokeWidth) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(strokeWidth.compareDocumentPosition(typographyDivider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(typographyDivider.compareDocumentPosition(fontFamily) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(fontFamily.compareDocumentPosition(fontSize) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(fontSize.compareDocumentPosition(textAlign) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(view.queryByText('Fill')).toBeNull();
      expect(view.queryByText('Stroke Style')).toBeNull();
      expect(view.queryByText('Stroke Width')).toBeNull();
      expect(view.queryByText('Font Family')).toBeNull();
      expect(view.queryByText('Font Size')).toBeNull();
      expect(view.queryByText('Text Align')).toBeNull();
      fireEvent.click(view.getByRole('button', { name: 'pink' }));
      fireEvent.change(slider, { target: { value: '0.4' } });

      expect(controller.editor.getShape(id)?.props).toMatchObject({
        color: 'pink', labelColor: 'pink', opacity: 0.4,
      });
      expect(controller.editor.activeStyles.peek()).toMatchObject({
        color: 'pink', labelColor: 'pink', opacity: 0.4,
      });
      expect(view.getByText('40%')).toBeDefined();
      const panel = view.container.querySelector<HTMLElement>('[data-glideboard-role="selected-style-panel"]')!;
      expect(panel.textContent).not.toContain('Position and Size');
      expect(view.container.querySelector('[data-glideboard-role="position-size-bar"]')).not.toBeNull();
    } finally {
      void controller.dispose();
    }
  });

  it('persists aspect lock for a generic shape', () => {
    const controller = new GlideboardController({ sessionKey: 'generic-aspect-lock' });
    try {
      const id = controller.editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 200, h: 100 } });
      controller.editor.setSelectedShapeIds([id]);
      const view = renderPanel(controller);

      const aspectButton = view.getByLabelText('Aspect ratio');
      expect(aspectButton.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(aspectButton);

      expect(aspectButton.getAttribute('aria-pressed')).toBe('true');
      expect(controller.editor.getShape(id)?.meta).toMatchObject({ aspectLocked: true });
    } finally {
      void controller.dispose();
    }
  });

  it('commits precise transforms from the keyboard and contains inspector events', () => {
    const controller = new GlideboardController({ sessionKey: 'precision-style-controls' });
    try {
      const assetId = importTestAsset(controller, 'raster-image', 'asset:precision-raster');
      const id = controller.editor.createShape({
        type: 'raster-image', x: 10, y: 20, rotation: Math.PI / 4,
        props: { w: 200, h: 100, assetId, crop: { x: 0, y: 0, w: 1, h: 1 } },
      });
      controller.editor.setSelectedShapeIds([id]);
      const precision = vi.spyOn(controller.editor, 'setShapePrecision');
      const view = renderPanel(controller);

      const x = view.getByRole('spinbutton', { name: 'X' });
      fireEvent.change(x, { target: { value: '45' } });
      fireEvent.keyDown(x, { key: 'Enter' });
      fireEvent.blur(x);
      fireEvent.change(view.getByRole('spinbutton', { name: 'Y' }), { target: { value: '55' } });
      fireEvent.blur(view.getByRole('spinbutton', { name: 'Y' }));
      fireEvent.change(view.getByRole('spinbutton', { name: 'H' }), { target: { value: '125' } });
      fireEvent.blur(view.getByRole('spinbutton', { name: 'H' }));
      fireEvent.change(view.getByRole('spinbutton', { name: '°' }), { target: { value: '30' } });
      fireEvent.blur(view.getByRole('spinbutton', { name: '°' }));
      expect(precision).toHaveBeenCalledWith(id, { x: 45 });
      expect(precision).toHaveBeenCalledWith(id, { y: 55 });
      expect(controller.editor.getShape(id)?.rotation).toBeCloseTo(Math.PI / 6);
      expect(controller.editor.getShape(id)?.props.h).toBe(125);

      const inspector = view.container.querySelector('[data-glideboard-role="asset-inspector"]')!;
      for (const [type, init] of [
        ['pointerUp', {}], ['mouseDown', {}], ['click', {}],
        ['keyDown', { key: 'a' }], ['keyUp', { key: 'a' }],
      ] as const) fireEvent[type](inspector, init);

      fireEvent.click(view.getByRole('button', { name: 'Reset rotation' }));
      expect(controller.editor.getShape(id)?.rotation).toBe(0);
    } finally {
      void controller.dispose();
    }
  });

  it('updates default drawing styles without a selection', () => {
    const controller = new GlideboardController({ sessionKey: 'default-style-controls' });
    try {
      const view = renderPanel(controller);

      for (const label of [
        'None fill', 'Semi fill', 'Solid fill', 'Pattern fill', 'Lined fill',
        'Thin stroke width', 'Medium stroke width', 'Thick stroke width', 'Extra large stroke width',
        'Dashed stroke', 'Dotted stroke', 'Pressure-sensitive stroke',
      ]) fireEvent.click(view.getByRole('button', { name: label }));
      fireEvent.click(view.getAllByTitle('tomato')[0]!);
      fireEvent.click(view.getAllByTitle('blue')[0]!);

      expect(controller.editor.activeStyles.peek()).toMatchObject({
        color: 'blue', fillStyle: 'lined', strokeStyle: 'solid', strokeWidth: 'xl',
        pressureSensitive: true,
      });
    } finally {
      void controller.dispose();
    }
  });

  it('dispatches every arrange command for a compatible multi-selection', () => {
    const controller = new GlideboardController({ sessionKey: 'arrange-style-controls' });
    try {
      const ids = [0, 1, 2].map(index => controller.editor.createShape({
        type: 'box', x: index * 100, y: index * 40, props: { w: 40 + index * 10, h: 30 + index * 5 },
      }));
      controller.editor.setSelectedShapeIds(ids);
      const spies = [
        vi.spyOn(controller.editor, 'alignShapes'),
        vi.spyOn(controller.editor, 'distributeShapes'),
        vi.spyOn(controller.editor, 'tidyShapes'),
        vi.spyOn(controller.editor, 'matchShapeSizes'),
      ];
      const view = renderPanel(controller);

      for (const title of [
        'Align left', 'Align horizontal centers', 'Align right', 'Align top',
        'Align vertical centers', 'Align bottom', 'Distribute horizontal gaps',
        'Distribute vertical gaps', 'Tidy into a row', 'Match width', 'Match height', 'Match size',
      ]) fireEvent.click(view.getByTitle(title));

      expect(spies[0]).toHaveBeenCalledTimes(6);
      expect(spies[1]).toHaveBeenCalledTimes(2);
      expect(spies[2]).toHaveBeenCalledOnce();
      expect(spies[3]).toHaveBeenCalledTimes(3);
    } finally {
      void controller.dispose();
    }
  });

  it('updates arrow, text, and frame-specific style controls', () => {
    const controller = new GlideboardController({ sessionKey: 'shape-style-controls' });
    try {
      const arrow = controller.editor.createShape({
        type: 'arrow', x: 0, y: 0,
        props: {
          ...new ArrowUtil().getDefaultProps(),
          end: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 100, y: 50 } },
          routeStyle: 'curve', arrowheadStart: 'none', arrowheadEnd: 'arrow',
        },
      });
      controller.editor.setSelectedShapeIds([arrow]);
      const view = renderPanel(controller);
      for (const label of ['Curve', 'Ortho', 'Smart']) fireEvent.click(view.getByRole('button', { name: label }));
      const none = view.getAllByRole('button', { name: 'None' });
      const arrows = view.getAllByRole('button', { name: 'Arrow' });
      fireEvent.click(arrows[0]!);
      fireEvent.click(none[none.length - 1]!);
      expect(controller.editor.getShape(arrow)?.props).toMatchObject({
        routeStyle: 'smart', arrowheadStart: 'arrow', arrowheadEnd: 'none',
      });

      const text = controller.editor.createShape({ type: 'text', x: 0, y: 0, props: { text: 'Styled' } });
      act(() => controller.editor.setSelectedShapeIds([text]));
      for (const label of ['Draw font', 'Sans font', 'Serif font', 'Mono font']) {
        fireEvent.click(view.getByRole('button', { name: label }));
      }
      for (const label of ['Small font', 'Medium font', 'Large font', 'Extra large font']) {
        fireEvent.click(view.getByRole('button', { name: label }));
      }
      expect(controller.editor.getShape(text)?.props).toMatchObject({ font: 'mono', fontSize: 'xl' });

      const labeledBox = controller.editor.createShape({ type: 'box', x: 0, y: 0, props: { label: 'Aligned' } });
      act(() => controller.editor.setSelectedShapeIds([labeledBox]));
      for (const label of ['Align labels left', 'Center labels', 'Align labels right']) {
        fireEvent.click(view.getByRole('button', { name: label }));
      }
      expect(controller.editor.getShape(labeledBox)?.props.textAlign).toBe('right');

      const frame = controller.editor.createShape({ type: 'frame', x: 0, y: 0, props: { w: 200, h: 100 } });
      act(() => controller.editor.setSelectedShapeIds([frame]));
      fireEvent.click(view.getByRole('button', { name: 'Overflow' }));
      fireEvent.click(view.getByRole('button', { name: 'Clip' }));
      expect(controller.editor.getShape(frame)?.props.clipContent).toBe(true);
    } finally {
      void controller.dispose();
    }
  });
});
