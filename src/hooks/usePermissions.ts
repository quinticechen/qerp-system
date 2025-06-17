
import { useOrganizationPermissions } from './useOrganizationPermissions';

export interface Permission {
  canViewProducts: boolean;
  canCreateProducts: boolean;
  canEditProducts: boolean;
  canDeleteProducts: boolean;
  canViewInventory: boolean;
  canCreateInventory: boolean;
  canEditInventory: boolean;
  canViewOrders: boolean;
  canCreateOrders: boolean;
  canEditOrders: boolean;
  canViewPurchases: boolean;
  canCreatePurchases: boolean;
  canEditPurchases: boolean;
  canViewShipping: boolean;
  canCreateShipping: boolean;
  canEditShipping: boolean;
  canViewCustomers: boolean;
  canCreateCustomers: boolean;
  canEditCustomers: boolean;
  canViewFactories: boolean;
  canCreateFactories: boolean;
  canEditFactories: boolean;
  canViewUsers: boolean;
  canCreateUsers: boolean;
  canEditUsers: boolean;
  canViewPermissions: boolean;
  canEditPermissions: boolean;
  canViewSystemSettings: boolean;
  canEditSystemSettings: boolean;
  // 新增組織權限
  canManageOrganization: boolean;
  canManageUsers: boolean;
  canManageRoles: boolean;
}

export const usePermissions = () => {
  const { permissions, loading, hasPermission, isOwner } = useOrganizationPermissions();

  // 轉換組織權限到舊的權限介面
  const convertedPermissions: Permission = {
    canViewProducts: permissions.canViewProducts || false,
    canCreateProducts: permissions.canCreateProducts || false,
    canEditProducts: permissions.canEditProducts || false,
    canDeleteProducts: permissions.canDeleteProducts || false,
    canViewInventory: permissions.canViewInventory || false,
    canCreateInventory: permissions.canCreateInventory || false,
    canEditInventory: permissions.canEditInventory || false,
    canViewOrders: permissions.canViewOrders || false,
    canCreateOrders: permissions.canCreateOrders || false,
    canEditOrders: permissions.canEditOrders || false,
    canViewPurchases: permissions.canViewPurchases || false,
    canCreatePurchases: permissions.canCreatePurchases || false,
    canEditPurchases: permissions.canEditPurchases || false,
    canViewShipping: permissions.canViewShipping || false,
    canCreateShipping: permissions.canCreateShipping || false,
    canEditShipping: permissions.canEditShipping || false,
    canViewCustomers: permissions.canViewCustomers || false,
    canCreateCustomers: permissions.canCreateCustomers || false,
    canEditCustomers: permissions.canEditCustomers || false,
    canViewFactories: permissions.canViewFactories || false,
    canCreateFactories: permissions.canCreateFactories || false,
    canEditFactories: permissions.canEditFactories || false,
    canViewUsers: permissions.canViewUsers || false,
    canCreateUsers: permissions.canCreateUsers || false,
    canEditUsers: permissions.canEditUsers || false,
    canViewPermissions: permissions.canViewPermissions || false,
    canEditPermissions: permissions.canEditPermissions || false,
    canViewSystemSettings: permissions.canViewSystemSettings || false,
    canEditSystemSettings: permissions.canEditSystemSettings || false,
    canManageOrganization: permissions.canManageOrganization || isOwner,
    canManageUsers: permissions.canManageUsers || isOwner,
    canManageRoles: permissions.canManageRoles || isOwner,
  };

  return {
    permissions: convertedPermissions,
    loading,
    hasPermission: (permission: keyof Permission) => hasPermission(permission),
  };
};
