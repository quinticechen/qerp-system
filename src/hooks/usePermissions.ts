
import { useUserRole } from './useUserRole';

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
}

const rolePermissions: Record<string, Permission> = {
  admin: {
    canViewProducts: true,
    canCreateProducts: true,
    canEditProducts: true,
    canDeleteProducts: true,
    canViewInventory: true,
    canCreateInventory: true,
    canEditInventory: true,
    canViewOrders: true,
    canCreateOrders: true,
    canEditOrders: true,
    canViewPurchases: true,
    canCreatePurchases: true,
    canEditPurchases: true,
    canViewShipping: true,
    canCreateShipping: true,
    canEditShipping: true,
    canViewCustomers: true,
    canCreateCustomers: true,
    canEditCustomers: true,
    canViewFactories: true,
    canCreateFactories: true,
    canEditFactories: true,
    canViewUsers: true,
    canCreateUsers: true,
    canEditUsers: true,
    canViewPermissions: true,
    canEditPermissions: true,
    canViewSystemSettings: true,
    canEditSystemSettings: true,
  },
  sales: {
    canViewProducts: true,
    canCreateProducts: false,
    canEditProducts: false,
    canDeleteProducts: false,
    canViewInventory: true,
    canCreateInventory: false,
    canEditInventory: false,
    canViewOrders: true,
    canCreateOrders: true,
    canEditOrders: true,
    canViewPurchases: true,
    canCreatePurchases: false,
    canEditPurchases: false,
    canViewShipping: true,
    canCreateShipping: false,
    canEditShipping: false,
    canViewCustomers: true,
    canCreateCustomers: true,
    canEditCustomers: true,
    canViewFactories: true,
    canCreateFactories: false,
    canEditFactories: false,
    canViewUsers: false,
    canCreateUsers: false,
    canEditUsers: false,
    canViewPermissions: false,
    canEditPermissions: false,
    canViewSystemSettings: false,
    canEditSystemSettings: false,
  },
  assistant: {
    canViewProducts: true,
    canCreateProducts: true,
    canEditProducts: true,
    canDeleteProducts: false,
    canViewInventory: true,
    canCreateInventory: true,
    canEditInventory: true,
    canViewOrders: true,
    canCreateOrders: true,
    canEditOrders: true,
    canViewPurchases: true,
    canCreatePurchases: true,
    canEditPurchases: true,
    canViewShipping: true,
    canCreateShipping: true,
    canEditShipping: true,
    canViewCustomers: true,
    canCreateCustomers: true,
    canEditCustomers: true,
    canViewFactories: true,
    canCreateFactories: true,
    canEditFactories: true,
    canViewUsers: false,
    canCreateUsers: false,
    canEditUsers: false,
    canViewPermissions: false,
    canEditPermissions: false,
    canViewSystemSettings: false,
    canEditSystemSettings: false,
  },
  accounting: {
    canViewProducts: true,
    canCreateProducts: false,
    canEditProducts: false,
    canDeleteProducts: false,
    canViewInventory: true,
    canCreateInventory: false,
    canEditInventory: false,
    canViewOrders: true,
    canCreateOrders: false,
    canEditOrders: false,
    canViewPurchases: true,
    canCreatePurchases: false,
    canEditPurchases: false,
    canViewShipping: true,
    canCreateShipping: false,
    canEditShipping: false,
    canViewCustomers: true,
    canCreateCustomers: false,
    canEditCustomers: false,
    canViewFactories: true,
    canCreateFactories: false,
    canEditFactories: false,
    canViewUsers: false,
    canCreateUsers: false,
    canEditUsers: false,
    canViewPermissions: false,
    canEditPermissions: false,
    canViewSystemSettings: false,
    canEditSystemSettings: false,
  },
  warehouse: {
    canViewProducts: true,
    canCreateProducts: false,
    canEditProducts: false,
    canDeleteProducts: false,
    canViewInventory: true,
    canCreateInventory: true,
    canEditInventory: true,
    canViewOrders: true,
    canCreateOrders: false,
    canEditOrders: false,
    canViewPurchases: true,
    canCreatePurchases: false,
    canEditPurchases: false,
    canViewShipping: true,
    canCreateShipping: true,
    canEditShipping: true,
    canViewCustomers: false,
    canCreateCustomers: false,
    canEditCustomers: false,
    canViewFactories: false,
    canCreateFactories: false,
    canEditFactories: false,
    canViewUsers: false,
    canCreateUsers: false,
    canEditUsers: false,
    canViewPermissions: false,
    canEditPermissions: false,
    canViewSystemSettings: false,
    canEditSystemSettings: false,
  },
};

export const usePermissions = () => {
  const { roles, isAdmin, loading } = useUserRole();

  const getPermissions = (): Permission => {
    if (loading) {
      // 返回無權限的預設值
      return Object.keys(rolePermissions.sales).reduce((acc, key) => {
        acc[key as keyof Permission] = false;
        return acc;
      }, {} as Permission);
    }

    if (isAdmin) {
      return rolePermissions.admin;
    }

    // 合併所有角色的權限（取聯集）
    const mergedPermissions = roles.reduce((acc, role) => {
      const rolePermission = rolePermissions[role];
      if (rolePermission) {
        Object.keys(rolePermission).forEach(key => {
          const permKey = key as keyof Permission;
          acc[permKey] = acc[permKey] || rolePermission[permKey];
        });
      }
      return acc;
    }, {} as Permission);

    return mergedPermissions;
  };

  const permissions = getPermissions();

  return {
    permissions,
    loading,
    hasPermission: (permission: keyof Permission) => permissions[permission],
  };
};
