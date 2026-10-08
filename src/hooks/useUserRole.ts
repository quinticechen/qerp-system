import { useOrganizationPermissions } from './useOrganizationPermissions';

// The current user's single role in the selected organization (user_organizations.role, or 'owner').
// The legacy global `user_roles` table has been dropped.
export const useUserRole = () => {
  const { role, isOwner, loading } = useOrganizationPermissions();

  const roles = role ? [role] : [];

  const hasRole = (roleName: string) => roles.includes(roleName as typeof roles[number]);
  const hasAnyRole = (roleList: string[]) => roleList.some((roleName) => hasRole(roleName));

  return {
    role,
    roles,
    isOwner,
    // The organization owner holds every permission, so treat them as admin too
    isAdmin: isOwner || role === 'admin',
    loading,
    hasRole,
    hasAnyRole,
  };
};
