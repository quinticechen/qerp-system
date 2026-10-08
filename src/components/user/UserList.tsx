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
import { ROLE_BADGE_CLASSES, ROLE_LABELS, isMemberRole } from '@/lib/roles';
import type { OrganizationMember } from '@/types/organizationMember';

// 邀請啟用有效期限：7 天，超過後邀請視為已過期，需由有新增使用者權限的角色重新發送
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export const UserList = () => {
  const [selectedUser, setSelectedUser] = useState<OrganizationMember | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { organizationId, organization, hasOrganization } = useCurrentOrganization();
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id;
  const { hasPermission } = useOrganizationPermissions();
  const canResendInvitation = hasPermission('canCreateUsers');
  const canEditUsers = hasPermission('canEditUsers');

  const { data: users, isLoading } = useQuery({
    queryKey: ['organization_users', organizationId],
    queryFn: async (): Promise<OrganizationMember[]> => {
      if (!organizationId) {
        console.log('No organization ID available');
        return [];
      }

      console.log('Fetching users for organization:', organizationId);
      
      // All memberships of this organization: active, deactivated (so they can be
      // re-enabled) and invitations that haven't been accepted yet
      const { data: userOrgs, error: userOrgsError } = await supabase
        .from('user_organizations')
        .select('user_id, is_active, joined_at, accepted_at, role')
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

      // Get invitation status (not yet accepted) for these users
      const { data: memberStatus, error: memberStatusError } = await supabase
        .rpc('get_organization_member_status', { _organization_id: organizationId });

      if (memberStatusError) {
        console.error('Error fetching member status:', memberStatusError);
      }

      // Combine the data
      const processedData = profiles?.map((profile): OrganizationMember => {
        const userOrg = userOrgs.find(uo => uo.user_id === profile.id);
        const status = memberStatus?.find(ms => ms.user_id === profile.id);
        const isPending = status?.is_pending ?? userOrg?.accepted_at == null;
        const invitedAt = status?.invited_at;
        const isExpired = isPending && !!invitedAt
          && (Date.now() - new Date(invitedAt).getTime() > INVITATION_EXPIRY_MS);

        const isOwner = profile.id === organization?.owner_id;
        const memberRole = isMemberRole(userOrg?.role) ? userOrg.role : 'viewer';

        return {
          id: profile.id,
          email: profile.email,
          full_name: profile.full_name,
          phone: profile.phone,
          // Membership status is per organization; profiles.is_active is per person
          is_active: userOrg?.is_active ?? false,
          is_owner: isOwner,
          is_pending: isPending,
          is_expired: isExpired,
          invited_at: invitedAt,
          created_at: profile.created_at,
          joined_at: isPending ? null : userOrg?.joined_at,
          email_confirmed: status?.email_confirmed ?? true,
          // Invitees already hold the role they were invited with; it takes effect once they accept
          role: isOwner ? 'owner' : memberRole,
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
      // 只停用／啟用在目前組織的成員資格，不影響此人在其他組織的狀態；由資料庫檢查權限
      const { error } = await supabase.rpc('set_member_active', {
        _organization_id: organizationId,
        _user_id: userId,
        _is_active: !currentStatus,
      });

      if (error) throw error;

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

  const handleView = (user: OrganizationMember) => {
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
    } catch (error) {
      console.error('Error resending invitation:', error);
      toast.error(`重新發送邀請失敗: ${(error as { message?: string }).message ?? '未知錯誤'}`);
    }
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
      key: 'role',
      title: '角色',
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: 'owner', label: ROLE_LABELS.owner },
        { value: 'admin', label: ROLE_LABELS.admin },
        { value: 'editor', label: ROLE_LABELS.editor },
        { value: 'viewer', label: ROLE_LABELS.viewer },
      ],
      render: (value: OrganizationMember['role']) => (
        <Badge variant="outline" className={`text-xs ${ROLE_BADGE_CLASSES[value]}`}>
          {ROLE_LABELS[value]}
        </Badge>
      )
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
          {canEditUsers && !row.is_pending && !row.is_owner && row.id !== currentUserId && (
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
            // Anyone can edit their own name and phone; editing others needs canEditUsers
            onEdit={canEditUsers || selectedUser.id === currentUserId ? () => {
              setViewDialogOpen(false);
              setEditDialogOpen(true);
            } : undefined}
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
