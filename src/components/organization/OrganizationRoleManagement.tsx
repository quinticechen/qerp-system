
import React, { useState } from 'react';
import { useOrganizationPermissions } from '@/hooks/useOrganizationPermissions';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { CreateRoleDialog } from './CreateRoleDialog';
import { EditRoleDialog } from './EditRoleDialog';
import { TransferOwnershipDialog } from './TransferOwnershipDialog';
import { UserPlus, Edit, Trash2, Shield, ArrowRightLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface OrganizationRole {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  permissions: Record<string, boolean>;
  is_system_role: boolean;
  is_active: boolean;
  user_count?: number;
}

export const OrganizationRoleManagement = () => {
  const { currentOrganization } = useOrganizationContext();
  const { isOwner } = useOrganizationPermissions();
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<OrganizationRole | null>(null);

  const { data: roles = [], refetch } = useQuery({
    queryKey: ['organization-roles', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from('organization_roles')
        .select(`
          id,
          name,
          display_name,
          description,
          permissions,
          is_system_role,
          is_active,
          user_organization_roles(count)
        `)
        .eq('organization_id', currentOrganization.id)
        .eq('is_active', true)
        .order('is_system_role', { ascending: false })
        .order('display_name');

      if (error) throw error;

      return data.map(role => ({
        ...role,
        user_count: role.user_organization_roles?.[0]?.count || 0
      }));
    },
    enabled: !!currentOrganization,
  });

  const handleEditRole = (role: OrganizationRole) => {
    setSelectedRole(role);
    setEditDialogOpen(true);
  };

  const handleTransferOwnership = () => {
    setTransferDialogOpen(true);
  };

  const handleDeleteRole = async (roleId: string) => {
    if (!currentOrganization) return;

    try {
      const { error } = await supabase
        .from('organization_roles')
        .update({ is_active: false })
        .eq('id', roleId)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;

      toast({
        title: "角色已刪除",
        description: "角色已成功停用",
      });

      refetch();
    } catch (error) {
      console.error('Error deleting role:', error);
      toast({
        title: "刪除失敗",
        description: "無法刪除角色，請稍後再試",
        variant: "destructive",
      });
    }
  };

  const getPermissionCount = (permissions: Record<string, boolean> | null | undefined, roleName: string) => {
    if (roleName === 'owner') {
      return '所有權限';
    }
    if (!permissions || typeof permissions !== 'object') {
      return '0 項權限';
    }
    return `${Object.values(permissions).filter(Boolean).length} 項權限`;
  };

  const columns: TableColumn[] = [
    {
      key: 'display_name',
      title: '角色名稱',
      sortable: true,
      render: (value, row) => (
        <div className="flex items-center space-x-2">
          {row.is_system_role && (
            <Shield className="h-4 w-4 text-blue-600" />
          )}
          <span className="font-medium">{value}</span>
          {row.is_system_role && (
            <Badge variant="outline" className="text-xs">
              系統角色
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'description',
      title: '描述',
      render: (value) => (
        <span className="text-gray-600">{value || '-'}</span>
      ),
    },
    {
      key: 'permissions',
      title: '權限數量',
      render: (value, row) => (
        <Badge variant="secondary">
          {getPermissionCount(value, row.name)}
        </Badge>
      ),
    },
    {
      key: 'user_count',
      title: '使用者數量',
      render: (value) => (
        <span className="text-sm text-gray-600">{value} 名使用者</span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      render: (_, row) => (
        <div className="flex items-center space-x-2">
          {row.name === 'owner' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTransferOwnership}
              disabled={!isOwner}
              className="text-blue-600 hover:text-blue-700"
            >
              <ArrowRightLeft className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleEditRole(row)}
                disabled={!isOwner}
              >
                <Edit className="h-4 w-4" />
              </Button>
              {!row.is_system_role && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteRole(row.id)}
                  disabled={!isOwner || row.user_count > 0}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  if (!currentOrganization) {
    return <div>請先選擇組織</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">組織角色管理</h2>
        </div>
        {isOwner && (
          <Button
            onClick={() => setCreateDialogOpen(true)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            新增角色
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>角色列表</CardTitle>
          <CardDescription>
            管理 {currentOrganization.name} 的角色和權限設定
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={roles}
            searchPlaceholder="搜尋角色..."
            emptyMessage="暫無角色資料"
          />
        </CardContent>
      </Card>

      <CreateRoleDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={refetch}
      />

      <EditRoleDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        role={selectedRole}
        onSuccess={refetch}
      />

      <TransferOwnershipDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onSuccess={refetch}
      />
    </div>
  );
};
