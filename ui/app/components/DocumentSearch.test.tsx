import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentSearch from './DocumentSearch';
import { searchDocuments } from '../core/http/searchApiHandler';
vi.mock('../core/http/searchApiHandler', () => ({ searchDocuments: vi.fn() }));
vi.mock('@components/ui/Icon', () => ({ Icon: () => <span aria-hidden="true" /> }));
const request = vi.mocked(searchDocuments);
const item = { pageId: 42, spaceId: '11111111-1111-1111-1111-111111111111', title: 'Project roadmap', spaceName: 'Product', snippet: 'Milestones', updatedAt: '2026-10-28T00:00:00Z' };
const setup = () => render(<MemoryRouter initialEntries={['/space']}><Routes><Route path="/space" element={<DocumentSearch />} /><Route path="/space/:spaceId/view/:pageId" element={<p>Opened document</p>} /></Routes></MemoryRouter>);
const type = (value: string) => { const input = screen.getByRole('combobox'); fireEvent.focus(input); fireEvent.change(input, { target: { value } }); return input; };
const debounce = async () => { await act(async () => { vi.advanceTimersByTime(260); }); };
beforeEach(() => { vi.useFakeTimers(); request.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('DocumentSearch', () => {
 it('debounces input and opens the selected result with keyboard', async () => {
  request.mockResolvedValue([item]); setup(); const input = type('road'); expect(request).not.toHaveBeenCalled(); await debounce();
  expect(request).toHaveBeenCalledWith('road', expect.any(AbortSignal)); expect(screen.getByText('Product')).toBeTruthy();
  fireEvent.keyDown(input, { key: 'ArrowDown' }); expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
  fireEvent.keyDown(input, { key: 'Enter' }); expect(screen.getByText('Opened document')).toBeTruthy();
 });
 it('ignores stale responses even if the backend ignores cancellation', async () => {
  let first!: (value: typeof item[]) => void; let second!: (value: typeof item[]) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
  setup(); type('old'); await debounce(); const signal = request.mock.calls[0][1]!; type('new'); await debounce(); expect(signal.aborted).toBe(true);
  await act(async () => { second([{ ...item, title: 'New result' }]); }); await act(async () => { first([{ ...item, title: 'Old result' }]); });
  expect(screen.getByText('New result')).toBeTruthy(); expect(screen.queryByText('Old result')).toBeNull();
 });
 it('shows empty/error states and aborts when dismissed', async () => {
  request.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('provider-secret')); setup(); const input = type('missing'); await debounce();
  expect(screen.getByRole('status').textContent).toContain('No matching documents'); type('broken'); await debounce();
  expect(screen.getByRole('status').textContent).toContain('temporarily unavailable'); expect(screen.queryByText('provider-secret')).toBeNull();
  fireEvent.keyDown(input, { key: 'Escape' }); expect(input.getAttribute('aria-expanded')).toBe('false'); expect(request.mock.calls[1][1]?.aborted).toBe(true);
 });
 it('does not search short input, clears results, and treats snippets as text', async () => {
  request.mockResolvedValue([{ ...item, snippet: '<img src=x onerror=alert(1)>' }]); const { container } = setup(); type('x'); await debounce(); expect(request).not.toHaveBeenCalled();
  type('road'); await debounce(); expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy(); expect(container.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' })); expect(screen.queryByRole('option')).toBeNull(); expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
 });
 it('supports result links and closes when focus leaves', async () => {
  request.mockResolvedValue([item]); setup(); type('road'); await debounce(); expect(screen.getByRole('link').getAttribute('href')).toBe(`/space/${item.spaceId}/view/42`);
  fireEvent.blur(screen.getByRole('combobox'), { relatedTarget: document.body }); expect(screen.queryByRole('listbox')).toBeNull();
 });
});
