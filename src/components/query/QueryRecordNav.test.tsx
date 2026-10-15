import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { recordLink } from '@/lib/queryRecordLinks';
import { useOpenRecordFromUrl } from '@/hooks/useOpenRecordFromUrl';
import { useQueryAction } from '@/hooks/useQueryAction';

// docs/requirements/QUERY_UI_LAYOUT_AND_RECORD_NAV.md §1

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/queryApi', () => ({ postQueryApi: api.post }));

vi.mock('@/integrations/supabase/client', () => {
  const row = { id: 'action-1', tool: 'create_order', status: 'pending', summary: { title: '建立訂單', fields: [] }, error: null, expires_at: '2999-01-01T00:00:00Z' };
  const query = { select: () => query, eq: () => query, single: async () => ({ data: row, error: null }) };
  return { supabase: { from: () => query } };
});

describe('recordLink', () => {
  it('opens the record on the page of the tool that wrote it', () => {
    expect(recordLink('create_order', 'o1')).toBe('/order?open=o1');
    expect(recordLink('cancel_purchase_order', 'p1')).toBe('/purchase?open=p1');
    expect(recordLink('add_product_color', 'c1')).toBe('/product?open=c1');
    expect(recordLink('receive_inventory', 'i1')).toBe('/inventory?tab=records&open=i1');
    expect(recordLink('create_shelf', 's1')).toBe('/shelf?open=s1');
  });

  it('goes to the page without opening when there is no dialog or no id; unknown tools go nowhere', () => {
    expect(recordLink('update_inventory_roll', 'r1')).toBe('/inventory');
    expect(recordLink('create_customer', null)).toBe('/customer');
    expect(recordLink('list_orders', 'x')).toBeNull();
  });
});

describe('useOpenRecordFromUrl', () => {
  function Page({ onOpen }: { onOpen: (id: string) => void }) {
    useOpenRecordFromUrl(onOpen);
    return <span data-testid="search">{useLocation().search}</span>;
  }

  it('opens the record once and removes ?open and ?tab from the address', async () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={['/inventory?tab=records&open=i1&page=2']}>
        <Page onOpen={onOpen} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?page=2'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('i1');
  });
});

describe('useQueryAction', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it('after a confirmed write, reports the page that opens the new record', async () => {
    api.post.mockResolvedValueOnce({ id: 'action-1', status: 'confirmed', result: { id: 'order-9', number: 'B202610150001' } });
    const onRecord = vi.fn();
    const { result } = renderHook(() => useQueryAction('action-1', onRecord), { wrapper });
    await waitFor(() => expect(result.current.action?.tool).toBe('create_order'));
    act(() => result.current.confirm());
    await waitFor(() => expect(onRecord).toHaveBeenCalledWith('/order?open=order-9'));
  });

  it('does not navigate when the user cancels or the write fails', async () => {
    api.post.mockReset();
    const onRecord = vi.fn();
    api.post.mockResolvedValueOnce({ id: 'action-1', status: 'cancelled' });
    const { result } = renderHook(() => useQueryAction('action-1', onRecord), { wrapper });
    await waitFor(() => expect(result.current.action).toBeDefined());
    act(() => result.current.cancel());
    api.post.mockResolvedValueOnce({ id: 'action-1', status: 'failed', error: '庫存不足' });
    act(() => result.current.confirm());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(onRecord).not.toHaveBeenCalled();
  });
});
