
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { createInviteClient } from '@/integrations/supabase/inviteClient';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';
import { useQuery } from '@tanstack/react-query';

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreateUserForm {
  email: string;
  full_name: string;
  phone: string;
  role_id: string;
}

export const CreateUserDialog = ({ open, onOpenChange }: CreateUserDialogProps) => {
  const { register, handleSubmit, reset, setValue, watch } = useForm<CreateUserForm>();
  const queryClient = useQueryClient();
  const { organizationId, hasOrganization } = useCurrentOrganization();
  
  const selectedRoleId = watch('role_id');

  // 獲取組織角色列表，排除組織擁有者角色
  const { data: roles = [] } = useQuery({
    queryKey: ['organization-roles', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('organization_roles')
        .select('id, name, display_name')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .neq('name', 'owner') // 排除組織擁有者角色
        .order('display_name');

      if (error) throw error;
      return data;
    },
    enabled: hasOrganization,
  });

  const onSubmit = async (data: CreateUserForm) => {
    if (!organizationId) {
      toast.error('請先選擇組織');
      return;
    }

    try {
      console.log('Creating user with data:', data);
      
      // 使用 signUp 而不是 admin.inviteUserByEmail（前端沒有 service role key）。
      // 透過獨立的 inviteClient 呼叫，避免 signUp 回傳的 session 覆蓋掉目前登入
      // 管理員自己的 session。
      const { data: signUpData, error: signUpError } = await createInviteClient().auth.signUp({
        email: data.email,
        password: Math.random().toString(36).slice(-8), // 臨時密碼
        options: {
          data: {
            full_name: data.full_name,
            phone: data.phone,
            organization_id: organizationId,
            role_id: data.role_id
          },
          // 對應 App.tsx 中受保護的 /dashboard 路由；使用者確認信箱後
          // 會直接帶著已建立好的組織成員資格進入該組織工作區
          emailRedirectTo: `${window.location.origin}/dashboard`
        }
      });

      if (signUpError) {
        console.error('SignUp error:', signUpError);
        throw signUpError;
      }

      if (signUpData.user) {
        // profile 已由資料庫的 handle_new_user trigger 自動建立，
        // 這裡改用 update 補上 trigger 沒有寫入的欄位（例如 phone）
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            full_name: data.full_name,
            phone: data.phone
          })
          .eq('id', signUpData.user.id);

        if (profileError) {
          console.error('Profile update error:', profileError);
        }

        // 將用戶加入組織
        const { error: orgError } = await supabase
          .from('user_organizations')
          .insert({
            user_id: signUpData.user.id,
            organization_id: organizationId,
            is_active: true
          });

        if (orgError) {
          console.error('Organization membership error:', orgError);
        }

        // 分配角色
        const { error: roleError } = await supabase
          .from('user_organization_roles')
          .insert({
            user_id: signUpData.user.id,
            organization_id: organizationId,
            role_id: data.role_id,
            granted_by: (await supabase.auth.getUser()).data.user?.id,
            is_active: true
          });

        if (roleError) {
          console.error('Role assignment error:', roleError);
        }
      }

      // 記錄操作日誌
      const currentUser = await supabase.auth.getUser();
      if (currentUser.data.user) {
        await supabase
          .from('user_operation_logs')
          .insert({
            operator_id: currentUser.data.user.id,
            target_user_id: signUpData.user?.id,
            operation_type: 'create',
            operation_details: {
              email: data.email,
              full_name: data.full_name,
              organization_id: organizationId
            }
          });
      }

      queryClient.invalidateQueries({ queryKey: ['organization_users'] });
      toast.success('使用者已創建，邀請郵件已發送');
      reset();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error creating user:', error);
      toast.error(`創建使用者失敗: ${error.message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新增使用者</DialogTitle>
          <DialogDescription>
            輸入使用者資訊，系統將發送邀請郵件讓用戶完成註冊
          </DialogDescription>
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
              創建使用者
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
