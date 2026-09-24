import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GlideboardController } from './GlideboardController';
import { GlideboardProvider } from './GlideboardContext';
import { PageTabs } from './PageTabs';

afterEach(cleanup);

describe('PageTabs', () => {
  it('creates, renames, duplicates, reorders, and deletes pages', async () => {
    const controller = new GlideboardController({ sessionKey: 'page-tabs' });
    try {
      render(<GlideboardProvider controller={controller}><PageTabs /></GlideboardProvider>);
      expect(screen.getAllByRole('tab')).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: 'Create page' }));
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      const pageTwo = screen.getByRole('tab', { name: 'Page 2' });
      expect(pageTwo.getAttribute('aria-selected')).toBe('true');

      fireEvent.doubleClick(pageTwo);
      const input = screen.getByRole('textbox', { name: 'Page name' });
      fireEvent.change(input, { target: { value: 'Architecture' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(screen.getByRole('tab', { name: 'Architecture' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
      expect(screen.getAllByRole('tab')).toHaveLength(3);
      expect(screen.getByRole('tab', { name: 'Architecture Copy' }).getAttribute('aria-selected')).toBe('true');

      fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Move left' }));
      expect(controller.editor.getPageIds().indexOf(controller.editor.getActivePageId())).toBe(1);

      fireEvent.click(screen.getByRole('button', { name: 'Page actions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete page' }));
      expect(screen.getAllByRole('tab')).toHaveLength(2);
    } finally {
      await controller.dispose();
    }
  });

  it('keeps page navigation available while hiding mutations in read-only mode', async () => {
    const controller = new GlideboardController({ sessionKey: 'page-tabs-readonly' });
    try {
      controller.editor.createPage('Reference');
      controller.setReadOnly(true);
      render(<GlideboardProvider controller={controller}><PageTabs /></GlideboardProvider>);

      fireEvent.click(screen.getByRole('tab', { name: 'Page 1' }));
      expect(controller.editor.getPage(controller.editor.getActivePageId())?.name).toBe('Page 1');
      expect(screen.queryByRole('button', { name: 'Create page' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Page actions' })).toBeNull();
    } finally {
      await controller.dispose();
    }
  });
});
