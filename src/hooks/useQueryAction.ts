import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { postQueryApi } from '@/lib/queryApi';

export type QueryActionStatus = 'pending' | 'executing' | 'confirmed' | 'cancelled' | 'expired' | 'failed';

export interface QueryActionSummary {
  title: string;
  fields: { label: string; value: string }[];
}

export interface QueryAction {
  id: string;
  status: QueryActionStatus;
  summary: QueryActionSummary;
  error: string | null;
  expiresAt: Date;
}

/** A write the Query assistant drafted, and the confirm / cancel calls for it. */
export function useQueryAction(actionId: string) {
  const queryClient = useQueryClient();
  const queryKey = ['query-action', actionId];

  const { data: action, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<QueryAction> => {
      const { data, error } = await supabase
        .from('query_pending_actions')
        .select('id, status, summary, error, expires_at')
        .eq('id', actionId)
        .single();
      if (error) throw error;
      return {
        id: data.id,
        status: data.status as QueryActionStatus,
        summary: data.summary as unknown as QueryActionSummary,
        error: data.error,
        expiresAt: new Date(data.expires_at),
      };
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    // The server posts the outcome to the conversation.
    queryClient.invalidateQueries({ queryKey: ['query-messages'] });
  };

  const decide = useMutation({
    mutationFn: (verb: 'confirm' | 'cancel') => postQueryApi(`/query/actions/${actionId}/${verb}`),
    onError: (err: Error) => toast.error(err.message),
    onSettled: refresh,
  });

  return {
    action,
    isLoading,
    confirm: () => decide.mutate('confirm'),
    cancel: () => decide.mutate('cancel'),
    isDeciding: decide.isPending,
  };
}
