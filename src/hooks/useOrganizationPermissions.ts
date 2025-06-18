
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useOrganizationContext } from '@/contexts/OrganizationContext';

export interface OrganizationRole {
  id: string;
  organization_id: string;
  name: string;
  display_name: string;
  description?: string;
  permissions: Record<string, boolean>;
  is_system_role: boolean;
  is_active: boolean;
}

export interface UserOrganizationRole {
  id: string;
  user_id: string;
  organization_id: string;
  role_id: string;
  granted_at: string;
  is_active: boolean;
  role: OrganizationRole;
}

export const useOrganizationPermissions = () => {
  const { user } = useAuth();
  const { currentOrganization } = useOrganizationContext();
  const [userRoles, setUserRoles] = useState<UserOrganizationRole[]>([]);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !currentOrganization) {
      setUserRoles([]);
      setPermissions({});
      setIsOwner(false);
      setLoading(false);
      return;
    }

    fetchUserPermissions();
  }, [user, currentOrganization]);

  const fetchUserPermissions = async () => {
    if (!user || !currentOrganization) return;

    try {
      setLoading(true);

      // 檢查是否為組織擁有者
      const isOrgOwner = currentOrganization.owner_id === user.id;
      setIsOwner(isOrgOwner);

      // 獲取使用者在當前組織的角色
      const { data: userRolesData, error } = await supabase
        .from('user_organization_roles')
        .select(`
          id,
          user_id,
          organization_id,
          role_id,
          granted_at,
          is_active,
          role:organization_roles(
            id,
            organization_id,
            name,
            display_name,
            description,
            permissions,
            is_system_role,
            is_active
          )
        `)
        .eq('user_id', user.id)
        .eq('organization_id', currentOrganization.id)
        .eq('is_active', true);

      if (error) throw error;

      const roles = userRolesData as UserOrganizationRole[];
      setUserRoles(roles);

      // 合併所有角色的權限
      const mergedPermissions: Record<string, boolean> = {};
      
      if (isOrgOwner) {
        // 組織擁有者擁有所有權限
        mergedPermissions.canManageOrganization = true;
        mergedPermissions.canManageUsers = true;
        mergedPermissions.canManageRoles = true;
        mergedPermissions.canViewAll = true;
        mergedPermissions.canEditAll = true;
        mergedPermissions.canDeleteAll = true;
        // 設定所有基本權限為 true
        const allPermissions = [
          'canViewProducts', 'canCreateProducts', 'canEditProducts', 'canDeleteProducts',
          'canViewInventory', 'canCreateInventory', 'canEditInventory',
          'canViewOrders', 'canCreateOrders', 'canEditOrders',
          'canViewPurchases', 'canCreatePurchases', 'canEditPurchases',
          'canViewShipping', 'canCreateShipping', 'canEditShipping',
          'canViewCustomers', 'canCreateCustomers', 'canEditCustomers',
          'canViewFactories', 'canCreateFactories', 'canEditFactories',
          'canViewUsers', 'canCreateUsers', 'canEditUsers',
          'canViewPermissions', 'canEditPermissions',
          'canViewSystemSettings', 'canEditSystemSettings'
        ];
        allPermissions.forEach(permission => {
          mergedPermissions[permission] = true;
        });
      } else {
        // 合併所有角色的權限
        roles.forEach(userRole => {
          const rolePermissions = userRole.role.permissions;
          Object.keys(rolePermissions).forEach(permission => {
            mergedPermissions[permission] = mergedPermissions[permission] || rolePermissions[permission];
          });
        });
      }

      setPermissions(mergedPermissions);
    } catch (error) {
      console.error('Error fetching user permissions:', error);
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (permission: string): boolean => {
    return permissions[permission] || false;
  };

  const hasAnyPermission = (permissionList: string[]): boolean => {
    return permissionList.some(permission => hasPermission(permission));
  };

  return {
    userRoles,
    permissions,
    isOwner,
    loading,
    hasPermission,
    hasAnyPermission,
    refreshPermissions: fetchUserPermissions
  };
};
