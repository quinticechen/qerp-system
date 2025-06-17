
import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface EditUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: any;
}

interface EditUserForm {
  full_name: string;
  phone: string;
  roles: string[];
}

const roleOptions = [
  { value: 'admin', label: '管理員' },
  { value: 'sales', label: '業務' },
  { value: 'assistant', label: '助理' },
  { value: 'accounting', label: '會計' },
  { value: 'warehouse', label: '倉管' }
];

export const EditUserDialog = ({ open, onOpenChange, user }: EditUserDialogProps) => {
  const { register, handleSubmit, reset, watch, setValue } = useForm<EditUserForm>();
  const queryClient = useQueryClient();
  const selectedRoles = watch('roles') || [];

  useEffect(() => {
    if (user) {
      const userRoles = Array.isArray(user.roles) ? user.roles.map((r: any) => r.role) : [];
      reset({
        full_name: user.full_name || '',
        phone: user.phone || '',
        roles: userRoles
      });
    }
  }, [user, reset]);

  const handleRoleChange = (roleValue: string, checked: boolean) => {
    const currentRoles = selectedRoles;
    if (checked) {
      setValue('roles', [...currentRoles, roleValue]);
    } else {
      setValue('roles', currentRoles.filter(role => role !== roleValue));
    }
  };

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

      // 獲取當前角色
      const currentRoles = Array.isArray(user.roles) ? user.roles.map((r: any) => r.role) : [];
      const newRoles = data.roles || [];

      // 刪除不再需要的角色
      const rolesToRemove = currentRoles.filter(role => !newRoles.includes(role));
      if (rolesToRemove.length > 0) {
        const { error: removeError } = await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', user.id)
          .in('role', rolesToRemove);

        if (removeError) throw removeError;
      }

      // 添加新角色
      const rolesToAdd = newRoles.filter(role => !currentRoles.includes(role));
      if (rolesToAdd.length > 0) {
        const roleInserts = rolesToAdd.map(role => ({
          user_id: user.id,
          role: role as any,
          granted_by: (await supabase.auth.getUser()).data.user?.id
        }));

        const { error: addError } = await supabase
          .from('user_roles')
          .insert(roleInserts);

        if (addError) throw addError;
      }

      // 記錄操作日誌
      await supabase
        .from('user_operation_logs')
        .insert({
          operator_id: (await supabase.auth.getUser()).data.user?.id,
          target_user_id: user.id,
          operation_type: 'update',
          operation_details: {
            full_name: data.full_name,
            phone: data.phone,
            roles_added: rolesToAdd,
            roles_removed: rolesToRemove
          }
        });

      queryClient.invalidateQueries({ queryKey: ['users_with_roles'] });
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
            <Label>角色</Label>
            <div className="space-y-2">
              {roleOptions.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={option.value}
                    checked={selectedRoles.includes(option.value)}
                    onCheckedChange={(checked) => handleRoleChange(option.value, checked as boolean)}
                  />
                  <Label htmlFor={option.value} className="text-sm">
                    {option.label}
                  </Label>
                </div>
              ))}
            </div>
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
