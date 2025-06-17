
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreateUserForm {
  email: string;
  password: string;
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

export const CreateUserDialog = ({ open, onOpenChange }: CreateUserDialogProps) => {
  const { register, handleSubmit, reset, watch, setValue } = useForm<CreateUserForm>();
  const queryClient = useQueryClient();
  const selectedRoles = watch('roles') || [];

  const handleRoleChange = (roleValue: string, checked: boolean) => {
    const currentRoles = selectedRoles;
    if (checked) {
      setValue('roles', [...currentRoles, roleValue]);
    } else {
      setValue('roles', currentRoles.filter(role => role !== roleValue));
    }
  };

  const onSubmit = async (data: CreateUserForm) => {
    try {
      // 創建使用者帳號
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            full_name: data.full_name,
            phone: data.phone
          }
        }
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('用戶創建失敗');

      // 更新 profiles 表
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: authData.user.id,
          email: data.email,
          full_name: data.full_name,
          phone: data.phone,
          is_active: true
        });

      if (profileError) throw profileError;

      // 分配角色
      if (data.roles && data.roles.length > 0) {
        const roleInserts = data.roles.map(role => ({
          user_id: authData.user!.id,
          role: role as any,
          granted_by: (await supabase.auth.getUser()).data.user?.id
        }));

        const { error: rolesError } = await supabase
          .from('user_roles')
          .insert(roleInserts);

        if (rolesError) throw rolesError;
      }

      // 記錄操作日誌
      await supabase
        .from('user_operation_logs')
        .insert({
          operator_id: (await supabase.auth.getUser()).data.user?.id,
          target_user_id: authData.user.id,
          operation_type: 'create',
          operation_details: {
            email: data.email,
            full_name: data.full_name,
            roles: data.roles
          }
        });

      queryClient.invalidateQueries({ queryKey: ['users_with_roles'] });
      toast.success('使用者創建成功');
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error('創建使用者失敗');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新增使用者</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">電子信箱 *</Label>
            <Input
              id="email"
              type="email"
              {...register('email', { required: true })}
              placeholder="請輸入電子信箱"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">密碼 *</Label>
            <Input
              id="password"
              type="password"
              {...register('password', { required: true })}
              placeholder="請輸入密碼"
            />
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
              創建
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
