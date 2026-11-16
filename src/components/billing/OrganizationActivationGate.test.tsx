import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationActivationGate } from './OrganizationActivationGate';

// docs/requirements/PRICING_AND_BILLING.md §3

const state = vi.hoisted(() => ({ status: 'pending' as string | null }));
vi.mock('@/contexts/OrganizationContext', () => ({
  useOrganizationContext: () => ({ currentOrganization: { id: 'org-1', name: '永泰布行' } }),
}));
vi.mock('@/hooks/useOrganizationEntitlement', () => ({
  useOrganizationEntitlement: () => ({ data: state.status ? { status: state.status } : null }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));

function renderGate(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <OrganizationActivationGate><p>ERP 內容</p></OrganizationActivationGate>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrganizationActivationGate', () => {
  beforeEach(() => { state.status = 'pending'; });

  it('a pending organization sees how to activate instead of the page', () => {
    renderGate('/order');
    expect(screen.getByText('「永泰布行」尚未開通')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看方案與價格' }).getAttribute('href')).toBe('/pricing');
    expect(screen.getByRole('button', { name: '申請免費試用' })).toBeTruthy();
    expect(screen.queryByText('ERP 內容')).toBeNull();
  });

  it('organization settings stay open while pending', () => {
    renderGate('/system');
    expect(screen.getByText('ERP 內容')).toBeTruthy();
  });

  it('an active organization, or one without billing data yet, sees the page', () => {
    state.status = 'active';
    renderGate('/order');
    expect(screen.getByText('ERP 內容')).toBeTruthy();
    state.status = null;
    renderGate('/order');
    expect(screen.getAllByText('ERP 內容').length).toBe(2);
  });
});
