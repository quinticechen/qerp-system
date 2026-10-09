import { useOrganizationPermissions } from './useOrganizationPermissions';
import { PERMISSION_KEYS, type PermissionKey } from '@/lib/permissionLabels';

// One switch per permission key in docs/requirements/MULTI_TENANT_RBAC.md §4.3
export type Permission = Record<PermissionKey, boolean>;

export const usePermissions = () => {
  const { permissions, loading, hasPermission } = useOrganizationPermissions();

  const convertedPermissions = Object.fromEntries(
    PERMISSION_KEYS.map((key) => [key, permissions[key] || false]),
  ) as Permission;

  return {
    permissions: convertedPermissions,
    loading,
    hasPermission: (permission: keyof Permission) => hasPermission(permission),
  };
};
