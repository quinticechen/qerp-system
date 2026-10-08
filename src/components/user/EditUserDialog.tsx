
import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { useAuth } from '@/hooks/useAuth';
import { MEMBER_ROLES, ROLE_LABELS, isMemberRole, type MemberRole } from '@/lib/roles';
import type { OrganizationMember } from '@/types/organizationMember';

interface EditUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: OrganizationMember;
}

interface EditUserForm {
  full_name: string;
  phone: string;
  role: MemberRole | '';
}

export const EditUserDialog = ({ open, onOpenChange, user }: EditUserDialogProps) => {
  const { register, handleSubmit, reset, setValue, watch } = useForm<EditUserForm>();
  const queryClient = useQueryClient();
  const { organizationId } = useCurrentOrganization();
  const { user: currentUser } = useAuth();
  const selectedRole = watch('role');

  // Nobody can change their own role or the owner's (enforced again by set_member_role)
  const canChangeRole = !user.is_owner && user.id !== currentUser?.id;

  useEffect(() => {
    reset({
      full_name: user.full_name || '',
      phone: user.phone || '',
      role: isMemberRole(user.role) ? user.role : '',
    });
  }, [user, reset]);

  const onSubmit = async (data: EditUserForm) => {
    try {
      // 更新基本資料
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: data.full_name,
          phone: data.phone
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      // 角色有變更時才更新，由資料庫檢查權限
      if (canChangeRole && data.role && data.role !== user.role) {
        const { error: roleError } = await supabase.rpc('set_member_role', {
          _organization_id: organizationId,
          _user_id: user.id,
          _role: data.role,
        });

        if (roleError) throw roleError;
      }

      // 記錄操作日誌
      await supabase
        .from('user_operation_logs')
        .insert({
          operator_id: currentUser?.id,
          target_user_id: user.id,
          operation_type: 'update',
          operation_details: {
            full_name: data.full_name,
            phone: data.phone,
            role: data.role
          }
        });

      queryClient.invalidateQueries({ queryKey: ['organization_users'] });
      toast.success('使用者資料更新成功');
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating user:', error);
      toast.error(`更新使用者資料失敗：${(error as { message?: string }).message ?? '未知錯誤'}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>編輯使用者</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>電子信箱</Label>
            <Input value={user.email} disabled className="bg-gray-50" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="full_name">姓名</Label>
            <Input
              id="full_name"
              {...register('full_name')}
              placeholder="請輸入姓名"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">電話</Label>
            <Input
              id="phone"
              {...register('phone')}
              placeholder="請輸入電話"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">角色</Label>
            {canChangeRole ? (
              <Select onValueChange={(value) => setValue('role', value as MemberRole)} value={selectedRole}>
                <SelectTrigger id="role">
                  <SelectValue placeholder="選擇角色" />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Input id="role" value={ROLE_LABELS[user.role]} disabled className="bg-gray-50" />
                <p className="text-sm text-gray-500">
                  {user.is_owner ? '擁有者的角色只能經由轉移擁有權變更' : '不能修改自己的角色'}
                </p>
              </>
            )}
            {canChangeRole && selectedRole && (
              <p className="text-sm text-gray-500">
                {MEMBER_ROLES.find((role) => role.value === selectedRole)?.description}
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
              更新
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
