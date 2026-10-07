import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserX, UserCheck, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ViewUserDialog } from './ViewUserDialog';
import { EditUserDialog } from './EditUserDialog';
import { EnhancedTable, TableColumn } from '@/components/ui/enhanced-table';
import { toast } from 'sonner';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationPermissions } from '@/hooks/useOrganizationPermissions';
import { getInvitationRedirectUrl, sendExistingUserInvitationEmail } from '@/hooks/useInvitations';

// 邀請啟用有效期限：7 天，超過後邀請視為已過期，需由有新增使用者權限的角色重新發送
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export const UserList = () => {
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { organizationId, organization, hasOrganization } = useCurrentOrganization();
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id;
  const { hasPermission } = useOrganizationPermissions();
  const canResendInvitation = hasPermission('canCreateUsers');

  const { data: users, isLoading } = useQuery({
    queryKey: ['organization_users', organizationId],
    queryFn: async () => {
      if (!organizationId) {
        console.log('No organization ID available');
        return [];
      }

      console.log('Fetching users for organization:', organizationId);
      
      // All memberships of this organization: active, deactivated (so they can be
      // re-enabled) and invitations that haven't been accepted yet
      const { data: userOrgs, error: userOrgsError } = await supabase
        .from('user_organizations')
        .select('user_id, is_active, joined_at, accepted_at, invited_role:organization_roles!invited_role_id (name, display_name)')
        .eq('organization_id', organizationId);

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

      // Get invitation status (not yet accepted) for these users
      const { data: memberStatus, error: memberStatusError } = await supabase
        .rpc('get_organization_member_status', { _organization_id: organizationId });

      if (memberStatusError) {
        console.error('Error fetching member status:', memberStatusError);
      }

      // Combine the data
      const processedData = profiles?.map(profile => {
        const userOrg = userOrgs.find(uo => uo.user_id === profile.id);
        const roles = userRoles?.filter(ur => ur.user_id === profile.id) || [];
        const status = memberStatus?.find(ms => ms.user_id === profile.id);
        const isPending = status?.is_pending ?? userOrg?.accepted_at == null;
        const invitedAt = status?.invited_at;
        const isExpired = isPending && !!invitedAt
          && (Date.now() - new Date(invitedAt).getTime() > INVITATION_EXPIRY_MS);

        return {
          id: profile.id,
          email: profile.email,
          full_name: profile.full_name,
          phone: profile.phone,
          // Membership status is per organization; profiles.is_active is per person
          is_active: userOrg?.is_active ?? false,
          is_owner: profile.id === organization?.owner_id,
          is_pending: isPending,
          is_expired: isExpired,
          invited_at: invitedAt,
          created_at: profile.created_at,
          joined_at: isPending ? null : userOrg?.joined_at,
          email_confirmed: status?.email_confirmed ?? true,
          // Invitees have no active role yet; show the role they'll get on acceptance
          roles: isPending && userOrg?.invited_role
            ? [{ role: userOrg.invited_role.name, display_name: userOrg.invited_role.display_name }]
            : roles.map(role => ({
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
    if (!organizationId || !currentUserId) return;

    try {
      // 只停用／啟用在目前組織的成員資格，不影響此人在其他組織的狀態
      const { data: updatedRows, error } = await supabase
        .from('user_organizations')
        .update({ is_active: !currentStatus })
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .select('id');

      if (error) throw error;
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error('權限不足，無法變更此成員狀態');
      }

      // 記錄操作日誌
      await supabase
        .from('user_operation_logs')
        .insert({
          operator_id: currentUserId,
          target_user_id: userId,
          operation_type: currentStatus ? 'disable' : 'enable',
          operation_details: {
            organization_id: organizationId,
            previous_status: currentStatus,
            new_status: !currentStatus
          }
        });

      queryClient.invalidateQueries({ queryKey: ['organization_users'] });
      toast.success(currentStatus ? '使用者已停用' : '使用者已啟用');
    } catch (error) {
      console.error('Error toggling user status:', error);
      toast.error(`操作失敗: ${(error as { message?: string }).message ?? '未知錯誤'}`);
    }
  };

  const handleView = (user: any) => {
    setSelectedUser(user);
    setViewDialogOpen(true);
  };

  const handleResendInvitation = async (user: { id: string; email: string; email_confirmed: boolean }) => {
    if (!organizationId) return;

    try {
      if (user.email_confirmed) {
        // Existing account: resend('signup') does nothing for confirmed emails
        await sendExistingUserInvitationEmail(user.email);
      } else {
        const { error: resendError } = await supabase.auth.resend({
          type: 'signup',
          email: user.email,
          options: { emailRedirectTo: getInvitationRedirectUrl() },
        });
        if (resendError) throw resendError;
      }

      // 重新起算 7 天效期
      const { error: updateError } = await supabase
        .from('user_organizations')
        .update({ invited_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('organization_id', organizationId);

      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ['organization_users'] });
      toast.success('邀請信已重新發送');
    } catch (error: any) {
      console.error('Error resending invitation:', error);
      toast.error(`重新發送邀請失敗: ${error.message}`);
    }
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
      render: (value, row) => (
        row.is_pending ? (
          row.is_expired ? (
            <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
              已過期
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
              邀請中
            </Badge>
          )
        ) : (
          <Badge variant="outline" className={value ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200'}>
            {value ? '啟用' : '停用'}
          </Badge>
        )
      )
    },
    {
      key: 'joined_at',
      title: '加入時間',
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="text-gray-700">
          {value ? new Date(value).toLocaleDateString('zh-TW') : '-'}
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
          {row.is_pending && canResendInvitation && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleResendInvitation(row);
              }}
              className="border-blue-300 text-blue-700 hover:bg-blue-50"
            >
              <Send className="h-4 w-4 mr-1" />
              重新發送邀請
            </Button>
          )}
          {/* 組織擁有者與自己不能被停用 */}
          {!row.is_pending && !row.is_owner && row.id !== currentUserId && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleUserStatus(row.id, row.is_active);
              }}
              className={row.is_active
                ? "border-red-300 text-red-700 hover:bg-red-50"
                : "border-green-300 text-green-700 hover:bg-green-50"
              }
            >
              {row.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
            </Button>
          )}
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
            onRowClick={handleView}
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
            onEdit={() => {
              setViewDialogOpen(false);
              setEditDialogOpen(true);
            }}
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
