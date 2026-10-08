import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isMemberRole, type OrganizationRole } from '@/lib/roles';

export type RoleMemberCounts = Record<OrganizationRole, number>;

// Active members of the organization per role, counted the same way as the user management list
export const useRoleMemberCounts = (organizationId: string | undefined, ownerId: string | undefined) =>
  useQuery({
    queryKey: ['role-member-counts', organizationId, ownerId],
    enabled: !!organizationId,
    queryFn: async (): Promise<RoleMemberCounts> => {
      const { data, error } = await supabase
        .from('user_organizations')
        .select('user_id, role')
        .eq('organization_id', organizationId!)
        .eq('is_active', true);
      if (error) throw error;

      const counts: RoleMemberCounts = { owner: 0, admin: 0, editor: 0, viewer: 0 };
      (data ?? []).forEach(({ user_id, role }) => {
        if (user_id === ownerId) counts.owner += 1;
        else if (isMemberRole(role)) counts[role] += 1;
      });
      return counts;
    },
  });
