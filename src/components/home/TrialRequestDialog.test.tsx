import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrialRequestDialog } from './TrialRequestDialog';

// docs/requirements/HOME_PAGE.md §2, §4

const db = vi.hoisted(() => ({ insert: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: db.from } }));

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TrialRequestDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('TrialRequestDialog', () => {
  beforeEach(() => {
    db.insert.mockReset();
    db.from.mockReset().mockReturnValue({ insert: db.insert });
  });

  it('saves the request and shows the call-back message', async () => {
    db.insert.mockResolvedValueOnce({ error: null });
    renderDialog();
    fill('姓名 *', ' 王小明 ');
    fill('電話 *', '0912-345-678');
    fill('公司名稱 *', '永泰布行');
    fill('Email', 'wang@example.com');
    fill('備註', '下午方便');
    fireEvent.click(screen.getByRole('button', { name: '建立' }));

    await waitFor(() => expect(screen.getByText('已收到您的試用申請', { selector: 'h3' })).toBeTruthy());
    const message = screen.getByRole('status').textContent ?? '';
    expect(message).toContain('我們會盡快致電給您，並為您開通 QERP 帳號');
    expect(message).toContain('感謝您的耐心等候');
    expect(db.from).toHaveBeenCalledWith('trial_requests');
    expect(db.insert).toHaveBeenCalledWith({
      contact_name: '王小明',
      phone: '0912-345-678',
      company_name: '永泰布行',
      email: 'wang@example.com',
      company_size: null,
      note: '下午方便',
    });
  });

  it('requires name, phone and company name, and checks the phone', async () => {
    renderDialog();
    fill('電話 *', 'abc');
    fireEvent.click(screen.getByRole('button', { name: '建立' }));

    await waitFor(() => expect(screen.getByText('請輸入姓名')).toBeTruthy());
    expect(screen.getByText('請輸入正確的電話號碼')).toBeTruthy();
    expect(screen.getByText('請輸入公司名稱')).toBeTruthy();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('shows the rate-limit message and keeps the form', async () => {
    db.insert.mockResolvedValueOnce({ error: { code: 'PT429', message: '申請太頻繁，請稍後再試' } });
    renderDialog();
    fill('姓名 *', '王小明');
    fill('電話 *', '0912345678');
    fill('公司名稱 *', '永泰布行');
    fireEvent.click(screen.getByRole('button', { name: '建立' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('申請太頻繁，請稍後再試'));
    expect(screen.getByRole('button', { name: '建立' })).toBeTruthy();
  });

  it('a filled-in honeypot shows the thank-you message without saving', async () => {
    renderDialog();
    fill('姓名 *', '王小明');
    fill('電話 *', '0912345678');
    fill('公司名稱 *', '永泰布行');
    fireEvent.change(screen.getByLabelText('網站'), { target: { value: 'spam.example' } });
    fireEvent.click(screen.getByRole('button', { name: '建立' }));

    await waitFor(() => expect(screen.getByText('已收到您的試用申請', { selector: 'h3' })).toBeTruthy());
    expect(db.insert).not.toHaveBeenCalled();
  });
});
