
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { isMemberRole, type OrganizationRole } from '@/lib/roles';

interface OrganizationAccess {
  role: OrganizationRole | null;
  permissions: Record<string, boolean>;
}

const NO_ACCESS: OrganizationAccess = { role: null, permissions: {} };

// The current user's role and permissions in the selected organization.
// Mirrors the database function user_has_organization_permission(): active members get their role's
// permissions from role_permissions, and the owner gets the admin set.
// Every component shares one cached copy, so menus, guards and buttons can all call this freely.
export const useOrganizationPermissions = () => {
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();
  const isOwner = !!user && !!currentOrganization && currentOrganization.owner_id === user.id;

  const { data = NO_ACCESS, isLoading, refetch } = useQuery({
    queryKey: ['organization-permissions', user?.id, currentOrganization?.id, isOwner],
    enabled: !!user && !!currentOrganization,
    queryFn: async (): Promise<OrganizationAccess> => {
      const { data: membership, error: membershipError } = await supabase
        .from('user_organizations')
        .select('role, is_active')
        .eq('user_id', user!.id)
        .eq('organization_id', currentOrganization!.id)
        .maybeSingle();

      if (membershipError) throw membershipError;

      const memberRole = membership?.is_active && isMemberRole(membership.role) ? membership.role : null;
      const catalogRole = isOwner ? 'admin' : memberRole;
      if (!catalogRole) return NO_ACCESS;

      const { data: rolePermissions, error: rolePermissionsError } = await supabase
        .from('role_permissions')
        .select('permission_key')
        .eq('role', catalogRole);

      if (rolePermissionsError) throw rolePermissionsError;

      return {
        role: isOwner ? 'owner' : memberRole,
        permissions: Object.fromEntries((rolePermissions ?? []).map(({ permission_key }) => [permission_key, true])),
      };
    },
  });

  const { role, permissions } = data;

  const hasPermission = (permission: string): boolean => {
    return permissions[permission] || false;
  };

  const hasAnyPermission = (permissionList: string[]): boolean => {
    return permissionList.some(permission => hasPermission(permission));
  };

  return {
    role,
    permissions,
    isOwner,
    // Without a user or organization there is nothing to load
    loading: !!user && !!currentOrganization && isLoading,
    hasPermission,
    hasAnyPermission,
    refreshPermissions: refetch
  };
};
