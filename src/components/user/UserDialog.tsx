import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { useAuth } from '@/hooks/useAuth';
import { MEMBER_ROLES, ROLE_BADGE_CLASSES, ROLE_LABELS, isMemberRole, type MemberRole } from '@/lib/roles';
import type { OrganizationMember } from '@/types/organizationMember';
import { RecordDialog } from '@/components/common/RecordDialog';
import { DetailSection } from '@/components/common/DetailSection';
import { DetailField } from '@/components/common/DetailField';
import { FormField } from '@/components/common/FormField';
import { ActiveToggleButton } from '@/components/common/ActiveToggleButton';

interface UserDialogProps {
  // Pass the row from the latest list data so the view shows saved changes
  user: OrganizationMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Anyone can edit their own name and phone; editing others needs canEditUsers
  canEdit: boolean;
  // Disable or re-enable the membership; leave out when not allowed (the owner, yourself, invitees)
  onToggleActive?: () => Promise<void>;
}

const StatusBadge = ({ user }: { user: OrganizationMember }) => {
  if (user.is_pending) {
    return user.is_expired ? (
      <Badge variant="outline" className="border-red-200 bg-red-100 text-red-800">已過期</Badge>
    ) : (
      <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-800">邀請中</Badge>
    );
  }
  return (
    <Badge variant="outline" className={user.is_active ? 'border-green-200 bg-green-100 text-green-800' : 'border-red-200 bg-red-100 text-red-800'}>
      {user.is_active ? '啟用' : '停用'}
    </Badge>
  );
};

export const UserDialog = ({ user, open, onOpenChange, canEdit, onToggleActive }: UserDialogProps) => {
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  const { user: currentUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<MemberRole | ''>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setEditing(false);
  }, [open, user?.id]);

  if (!user) return null;

  // Nobody can change their own role or the owner's (enforced again by set_member_role)
  const canChangeRole = !user.is_owner && user.id !== currentUser?.id;
  const roleDescription = user.is_owner
    ? '擁有組織的所有權限，並可以轉移擁有權'
    : MEMBER_ROLES.find((option) => option.value === user.role)?.description;

  const startEditing = () => {
    setFullName(user.full_name || '');
    setPhone(user.phone || '');
    setRole(isMemberRole(user.role) ? user.role : '');
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error: profileError } = await supabase.from('profiles').update({ full_name: fullName, phone }).eq('id', user.id);
      if (profileError) throw profileError;

      // 角色有變更時才更新，由資料庫檢查權限
      if (canChangeRole && role && role !== user.role) {
        const { error: roleError } = await supabase.rpc('set_member_role', {
          _organization_id: organizationId,
          _user_id: user.id,
          _role: role,
        });
        if (roleError) throw roleError;
      }

      await supabase.from('user_operation_logs').insert({
        operator_id: currentUser?.id,
        target_user_id: user.id,
        operation_type: 'update',
        operation_details: { full_name: fullName, phone, role },
      });

      await queryClient.invalidateQueries({ queryKey: ['organization_users'] });
      toast.success('使用者資料更新成功');
      setEditing(false);
    } catch (error) {
      toast.error(`更新使用者資料失敗：${(error as { message?: string }).message ?? '未知錯誤'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    if (!onToggleActive) return;
    setSaving(true);
    try {
      await onToggleActive();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode={editing ? 'edit' : 'view'}
      title={editing ? '編輯使用者' : '使用者詳情'}
      description={user.email}
      size="lg"
      history={{ recordId: user.id }}
      onEdit={canEdit ? startEditing : undefined}
      onCancelEdit={() => setEditing(false)}
      onSubmit={handleSave}
      submitting={saving}
      editActions={
        onToggleActive && <ActiveToggleButton isActive={user.is_active} subject="使用者" onToggle={handleToggle} disabled={saving} />
      }
    >
      {editing ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DetailField label="電子信箱">{user.email}</DetailField>
          <FormField label="姓名" htmlFor="user-full-name">
            <Input id="user-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="請輸入姓名" />
          </FormField>
          <FormField label="電話" htmlFor="user-phone">
            <Input id="user-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="請輸入電話" />
          </FormField>
          <FormField
            label="角色"
            htmlFor="user-role"
            hint={
              canChangeRole
                ? MEMBER_ROLES.find((option) => option.value === role)?.description
                : user.is_owner
                  ? '擁有者的角色只能經由轉移擁有權變更'
                  : '不能修改自己的角色'
            }
          >
            {canChangeRole ? (
              <Select value={role} onValueChange={(value) => setRole(value as MemberRole)}>
                <SelectTrigger id="user-role">
                  <SelectValue placeholder="選擇角色" />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input id="user-role" value={ROLE_LABELS[user.role]} disabled className="bg-gray-50" />
            )}
          </FormField>
        </div>
      ) : (
        <>
          <DetailSection title="基本資料" fields>
            <DetailField label="電子信箱">{user.email}</DetailField>
            <DetailField label="姓名">{user.full_name}</DetailField>
            <DetailField label="電話">{user.phone}</DetailField>
            <DetailField label="狀態">
              <StatusBadge user={user} />
            </DetailField>
          </DetailSection>

          <DetailSection title="角色權限">
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Badge variant="outline" className={ROLE_BADGE_CLASSES[user.role]}>
                {ROLE_LABELS[user.role]}
              </Badge>
              <p className="text-sm text-gray-600">{roleDescription}</p>
            </div>
            {user.is_pending && <p className="text-sm text-gray-500">接受邀請後才會取得此角色的權限</p>}
          </DetailSection>

          <DetailSection title="時間資訊" fields>
            <DetailField label="建立時間">{new Date(user.created_at).toLocaleString('zh-TW')}</DetailField>
            <DetailField label="最後更新">{user.updated_at ? new Date(user.updated_at).toLocaleString('zh-TW') : null}</DetailField>
          </DetailSection>
        </>
      )}
    </RecordDialog>
  );
};
