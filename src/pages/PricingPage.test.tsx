import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PricingPage from './PricingPage';

// docs/requirements/PRICING_AND_BILLING.md §2

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));

function CheckoutProbe() {
  const location = useLocation();
  return <p>checkout:{location.search}</p>;
}

function renderPricing(path = '/pricing') {
  render(
    <HelmetProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/checkout" element={<CheckoutProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

const card = (name: string) => screen.getByRole('article', { name: `${name}方案` });

describe('PricingPage', () => {
  it('shows yearly prices first and switches between periods', () => {
    renderPricing();
    expect(within(card('標準')).getByText('NT$14,900')).toBeTruthy();
    expect(within(card('專業')).getByText('NT$39,900')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /月繳/ }));
    expect(within(card('標準')).getByText('NT$1,490')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /兩年繳/ }));
    expect(within(card('專業')).getByText('NT$71,800')).toBeTruthy();
    expect(within(card('專業')).getByText(/約 NT\$2,992 \/ 月/)).toBeTruthy();
  });

  it('the free plan opens the contact form', () => {
    renderPricing();
    fireEvent.click(within(card('免費')).getByRole('button', { name: '申請免費試用' }));
    expect(screen.getByRole('dialog', { name: '免費試用 QERP' })).toBeTruthy();
  });

  it('a paid plan continues to checkout with the plan and period', () => {
    renderPricing();
    fireEvent.click(screen.getByRole('radio', { name: /兩年繳/ }));
    fireEvent.click(within(card('專業')).getByRole('button', { name: '選擇專業方案' }));
    expect(screen.getByText('checkout:?plan=pro&period=two_years')).toBeTruthy();
  });

  it('says nothing was charged when Stripe checkout was cancelled', () => {
    renderPricing('/pricing?canceled=1');
    expect(screen.getByRole('status').textContent).toContain('沒有收取任何費用');
  });
});
