import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MessageFeedback } from './MessageFeedback';

// docs/requirements/QUERY_AGENT_LANGFUSE.md §2.4

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/queryApi', () => ({ postQueryApi: api.post }));

function renderFeedback(feedback: 'up' | 'down' | null) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MessageFeedback messageId="m1" feedback={feedback} />
    </QueryClientProvider>,
  );
}

describe('MessageFeedback', () => {
  it('sends thumbs down for the reply and shows it as chosen', async () => {
    api.post.mockResolvedValueOnce({ feedback: { value: 'down' } });
    renderFeedback(null);
    const down = screen.getByRole('button', { name: '回覆沒有幫助' });
    expect(down.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(down);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/query/messages/m1/feedback', { value: 'down' }));
    await waitFor(() => expect(down.getAttribute('aria-pressed')).toBe('true'));
  });

  it('choosing the saved rating again clears it', async () => {
    api.post.mockResolvedValueOnce({ feedback: null });
    renderFeedback('up');
    const up = screen.getByRole('button', { name: '回覆有幫助' });
    expect(up.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(up);
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/query/messages/m1/feedback', { value: null }));
  });
});
