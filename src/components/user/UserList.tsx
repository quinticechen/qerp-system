import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, Edit, UserX, UserCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ViewUserDialog } from './ViewUserDialog';
import { EditUserDialog } from './EditUserDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { toast } from 'sonner';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

export const UserList = () => {
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { organizationId, hasOrganization } = useCurrentOrganization();

  const { data: users, isLoading } = useQuery({
    queryKey: ['organization_users', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        console.log('No organization ID available');
        return [];
      }

      console.log('Fetching users for organization:', organizationId);
      
      // First get all user_organization relationships for this organization
      const { data: userOrgs, error: userOrgsError } = await supabase
        .from('user_organizations')
        .select('user_id, is_active, joined_at')
        .eq('organization_id', organizationId)
        .eq('is_active', true);

      if (userOrgsError) {
        console.error('Error fetching user organizations:', userOrgsError);
        throw userOrgsError;
      }

      if (!userOrgs || userOrgs.length === 0) {
        return [];
      }

      // Get user IDs
      const userIds = userOrgs.map(uo => uo.user_id);

      // Get profiles for these users
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, is_active, created_at')
        .in('id', userIds);

      if (profilesError) {
        console.error('Error fetching profiles:', profilesError);
        throw profilesError;
      }

      // Get roles for these users
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_organization_roles')
        .select(`
          user_id,
          organization_roles (
            name,
            display_name
          )
        `)
        .eq('organization_id', organizationId)
        .in('user_id', userIds)
        .eq('is_active', true);

      if (rolesError) {
        console.error('Error fetching user roles:', rolesError);
        throw rolesError;
      }

      // Combine the data
      const processedData = profiles?.map(profile => {
        const userOrg = userOrgs.find(uo => uo.user_id === profile.id);
        const roles = userRoles?.filter(ur => ur.user_id === profile.id) || [];
        
        return {
          id: profile.id,
          email: profile.email,
          full_name: profile.full_name,
          phone: profile.phone,
          is_active: profile.is_active,
          created_at: profile.created_at,
          joined_at: userOrg?.joined_at,
          roles: roles.map(role => ({
            role: role.organization_roles?.name,
            display_name: role.organization_roles?.display_name
          }))
        };
      }) || [];

      console.log('Fetched organization users:', processedData);
      return processedData;
    },
    enabled: hasOrganization
  });

  const handleToggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !currentStatus })
        .eq('id', userId);

      if (error) throw error;

      // 記錄操作日誌
      const currentUser = await supabase.auth.getUser();
      await supabase
        .from('user_operation_logs')
        .insert({
          operator_id: currentUser.data.user?.id,
          target_user_id: userId,
          operation_type: currentStatus ? 'disable' : 'enable',
          operation_details: { previous_status: currentStatus, new_status: !currentStatus }
        });

      queryClient.invalidateQueries({ queryKey: ['organization_users'] });
      toast.success(currentStatus ? '使用者已停用' : '使用者已啟用');
    } catch (error) {
      console.error('Error toggling user status:', error);
      toast.error('操作失敗');
    }
  };

  const handleView = (user: any) => {
    setSelectedUser(user);
    setViewDialogOpen(true);
  };

  const handleEdit = (user: any) => {
    setSelectedUser(user);
    setEditDialogOpen(true);
  };

  const getRoleBadge = (role: string) => {
    const roleMap = {
      admin: 'bg-red-100 text-red-800 border-red-200',
      sales: 'bg-blue-100 text-blue-800 border-blue-200',
      assistant: 'bg-green-100 text-green-800 border-green-200',
      accounting: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      warehouse: 'bg-purple-100 text-purple-800 border-purple-200'
    };
    return roleMap[role as keyof typeof roleMap] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getRoleText = (role: string) => {
    const roleTextMap = {
      admin: '管理員',
      sales: '業務',
      assistant: '助理',
      accounting: '會計',
      warehouse: '倉管'
    };
    return roleTextMap[role as keyof typeof roleTextMap] || role;
  };

  const columns: TableColumn[] = [
    {
      key: 'email',
      title: '電子信箱',
      sortable: true,
      filterable: false,
      render: (value) => <span className="font-medium text-gray-900">{value}</span>
    },
    {
      key: 'full_name', 
      title: '姓名',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'phone',
      title: '電話',
      sortable: true,
      filterable: false,
      render: (value) => <span className="text-gray-700">{value || '-'}</span>
    },
    {
      key: 'roles',
      title: '角色',
      sortable: false,
      filterable: false,
      render: (value, row) => {
        const roles = Array.isArray(row.roles) ? row.roles : [];
        return (
          <div className="flex flex-wrap gap-1">
            {roles.length > 0 ? roles.map((roleInfo: any, index: number) => (
              <Badge key={index} variant="outline" className="text-xs bg-blue-100 text-blue-800 border-blue-200">
                {roleInfo.display_name || roleInfo.role}
              </Badge>
            )) : (
              <span className="text-gray-500">無角色</span>
            )}
          </div>
        );
      }
    },
    {
      key: 'is_active',
      title: '狀態',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'true', label: '啟用' },
        { value: 'false', label: '停用' }
      ],
      render: (value) => (
        <Badge variant="outline" className={value ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200'}>
          {value ? '啟用' : '停用'}
        </Badge>
      )
    },
    {
      key: 'joined_at',
      title: '加入時間',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {new Date(value).toLocaleDateString('zh-TW')}
        </span>
      )
    },
    {
      key: 'actions',
      title: '操作',
      sortable: false,
      filterable: false,
      render: (value, row) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleView(row)}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleEdit(row)}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleToggleUserStatus(row.id, row.is_active)}
            className={row.is_active 
              ? "border-red-300 text-red-700 hover:bg-red-50" 
              : "border-green-300 text-green-700 hover:bg-green-50"
            }
          >
            {row.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
          </Button>
        </div>
      )
    }
  ];

  if (!hasOrganization) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-gray-700">請先選擇組織</div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">載入中...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900">組織成員列表</CardTitle>
        </CardHeader>
        <CardContent>
          <EnhancedTable
            columns={columns}
            data={users || []}
            loading={isLoading}
            searchPlaceholder="搜尋使用者姓名、電子信箱、電話..."
            emptyMessage="沒有找到使用者"
          />
        </CardContent>
      </Card>

      {/* 對話框 */}
      {selectedUser && (
        <>
          <ViewUserDialog
            open={viewDialogOpen}
            onOpenChange={setViewDialogOpen}
            user={selectedUser}
          />
          <EditUserDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            user={selectedUser}
          />
        </>
      )}
    </div>
  );
};
