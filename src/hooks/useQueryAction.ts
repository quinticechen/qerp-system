import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { postQueryApi } from '@/lib/queryApi';
import { recordLink } from '@/lib/queryRecordLinks';

export type QueryActionStatus = 'pending' | 'executing' | 'confirmed' | 'cancelled' | 'expired' | 'failed';

export interface QueryActionSummary {
  title: string;
  fields: { label: string; value: string }[];
}

export interface QueryAction {
  id: string;
  /** The agent tool that drafted it; decides which page shows the record after confirmation. */
  tool: string;
  status: QueryActionStatus;
  summary: QueryActionSummary;
  error: string | null;
  expiresAt: Date;
}

/** POST /query/actions/:id/confirm|cancel — `result` is the business API's answer ({ id, number }). */
interface ActionOutcome {
  status: QueryActionStatus;
  result?: { id?: string | null } | null;
}

/**
 * A write the Query assistant drafted, and the confirm / cancel calls for it. After a confirmed
 * write, `onRecord` gets the page that opens the record (docs/requirements/QUERY_UI_LAYOUT_AND_RECORD_NAV.md §1).
 */
export function useQueryAction(actionId: string, onRecord?: (path: string) => void) {
  const queryClient = useQueryClient();
  const queryKey = ['query-action', actionId];

  const { data: action, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<QueryAction> => {
      const { data, error } = await supabase
        .from('query_pending_actions')
        .select('id, tool, status, summary, error, expires_at')
        .eq('id', actionId)
        .single();
      if (error) throw error;
      return {
        id: data.id,
        tool: data.tool,
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
    mutationFn: (verb: 'confirm' | 'cancel') => postQueryApi<ActionOutcome>(`/query/actions/${actionId}/${verb}`),
    onSuccess: (outcome, verb) => {
      if (verb !== 'confirm' || outcome.status !== 'confirmed' || !action) return;
      // Every page's lists may now be stale (the open page does not remount to refetch).
      queryClient.invalidateQueries();
      const path = recordLink(action.tool, outcome.result?.id);
      if (path) onRecord?.(path);
    },
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
