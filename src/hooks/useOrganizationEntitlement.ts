import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BillingPeriod, PlanCode } from '@/lib/billingPlans';

export interface OrganizationEntitlement {
  plan: PlanCode;
  status: 'pending' | 'active' | 'past_due';
  billing_period: BillingPeriod | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  max_members: number;
  members: number;
  query_messages_per_month: number;
  query_messages_used: number;
}

export const entitlementQueryKey = (organizationId: string | undefined) => ['organization-entitlement', organizationId];

/** The current organization's plan, status and usage (get_organization_entitlement). */
export const useOrganizationEntitlement = (organizationId: string | undefined, options: { refetchInterval?: number | false } = {}) =>
  useQuery({
    queryKey: entitlementQueryKey(organizationId),
    enabled: !!organizationId,
    refetchInterval: options.refetchInterval,
    queryFn: async (): Promise<OrganizationEntitlement | null> => {
      const { data, error } = await supabase.rpc('get_organization_entitlement', { _organization_id: organizationId! });
      if (error) {
        // Not deployed yet (PGRST202): behave as before billing existed.
        if (error.code === 'PGRST202') return null;
        throw error;
      }
      return data as unknown as OrganizationEntitlement;
    },
  });
