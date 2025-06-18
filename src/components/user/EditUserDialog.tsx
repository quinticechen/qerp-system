
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

interface EditUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: any;
}

interface EditUserForm {
  full_name: string;
  phone: string;
  role_id: string;
}

export const EditUserDialog = ({ open, onOpenChange, user }: EditUserDialogProps) => {
  const { register, handleSubmit, reset, setValue, watch } = useForm<EditUserForm>();
  const queryClient = useQueryClient();
  const { organizationId, hasOrganization } = useCurrentOrganization();
  const selectedRoleId = watch('role_id');

  // 獲取組織角色列表
  const { data: roles = [] } = useQuery({
    queryKey: ['organization-roles', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('organization_roles')
        .select('id, name, display_name')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('display_name');

      if (error) throw error;
      return data;
    },
    enabled: hasOrganization,
  });

  useEffect(() => {
    if (user && roles.length > 0) {
      // 從用戶的角色中找到第一個匹配的角色
      const userRoleId = user.roles?.[0]?.role_id;
      reset({
        full_name: user.full_name || '',
        phone: user.phone || '',
        role_id: userRoleId || ''
      });
    }
  }, [user, roles, reset]);

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

      // 更新角色 - 先刪除現有角色，再添加新角色
      const { error: deleteRoleError } = await supabase
        .from('user_organization_roles')
        .delete()
        .eq('user_id', user.id)
        .eq('organization_id', organizationId);

      if (deleteRoleError) throw deleteRoleError;

      // 添加新角色
      const currentUser = await supabase.auth.getUser();
      const { error: addRoleError } = await supabase
        .from('user_organization_roles')
        .insert({
          user_id: user.id,
          organization_id: organizationId,
          role_id: data.role_id,
          granted_by: currentUser.data.user?.id,
          is_active: true
        });

      if (addRoleError) throw addRoleError;

      // 記錄操作日誌
      await supabase
        .from('user_operation_logs')
        .insert({
          operator_id: currentUser.data.user?.id,
          target_user_id: user.id,
          operation_type: 'update',
          operation_details: {
            full_name: data.full_name,
            phone: data.phone,
            role_id: data.role_id
          }
        });

      queryClient.invalidateQueries({ queryKey: ['organization_users'] });
      toast.success('使用者資料更新成功');
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating user:', error);
      toast.error('更新使用者資料失敗');
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
            <Input value={user?.email} disabled className="bg-gray-50" />
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
            <Label htmlFor="role_id">角色 *</Label>
            <Select onValueChange={(value) => setValue('role_id', value)} value={selectedRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇角色" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
