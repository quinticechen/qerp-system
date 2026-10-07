import { useOrganizationPermissions } from './useOrganizationPermissions';

// Roles are scoped to the current organization (user_organization_roles), not global.
// The legacy global `user_roles` table has been dropped.
export const useUserRole = () => {
  const { userRoles, isOwner, loading } = useOrganizationPermissions();

  const roles = userRoles
    .filter((userRole) => userRole.role?.is_active)
    .map((userRole) => userRole.role.name);

  const hasRole = (role: string) => roles.includes(role);
  const hasAnyRole = (roleList: string[]) => roleList.some((role) => roles.includes(role));

  return {
    roles,
    isOwner,
    // The organization owner holds every permission, so treat them as admin too
    isAdmin: isOwner || roles.includes('admin'),
    loading,
    hasRole,
    hasAnyRole,
  };
};
