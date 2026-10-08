import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isMemberRole, type MemberRole } from '@/lib/roles';

export type RolePermissionMap = Record<MemberRole, Set<string>>;

// The fixed role → permission catalog (role_permissions), the same for every organization
export const useRolePermissions = () =>
  useQuery({
    queryKey: ['role-permissions'],
    staleTime: Infinity,
    queryFn: async (): Promise<RolePermissionMap> => {
      const { data, error } = await supabase.from('role_permissions').select('role, permission_key');
      if (error) throw error;

      const map: RolePermissionMap = { admin: new Set(), editor: new Set(), viewer: new Set() };
      (data ?? []).forEach(({ role, permission_key }) => {
        if (isMemberRole(role)) map[role].add(permission_key);
      });
      return map;
    },
  });
