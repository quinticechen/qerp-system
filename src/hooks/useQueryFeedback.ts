import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { postQueryApi } from '@/lib/queryApi';

export type QueryFeedback = 'up' | 'down';

/**
 * Thumbs up/down on a Query reply (docs/requirements/QUERY_AGENT_LANGFUSE.md §2.4). The server
 * saves it on the message and sends it to Langfuse; null clears it.
 */
export function useQueryFeedback(messageId: string, saved: QueryFeedback | null) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (value: QueryFeedback | null) =>
      postQueryApi<{ feedback: { value: QueryFeedback } | null }>(`/query/messages/${messageId}/feedback`, { value }),
    onError: () => toast.error('回饋沒有送出，請稍後再試'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['query-messages'] }),
  });

  // Show the choice at once, then the server's answer; after a failure, what is saved.
  const current = mutation.isPending
    ? mutation.variables ?? null
    : mutation.isSuccess
      ? mutation.data.feedback?.value ?? null
      : saved;

  return {
    feedback: current,
    /** Choosing the current rating again clears it. */
    rate: (value: QueryFeedback) => mutation.mutate(current === value ? null : value),
    isSaving: mutation.isPending,
  };
}
