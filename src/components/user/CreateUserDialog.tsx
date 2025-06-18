
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForm } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
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

  const onSubmit = async (data: CreateUserForm) => {
    if (!organizationId) {
      toast.error('請先選擇組織');
      return;
    }

    try {
      // 發送邀請郵件
      const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(
        data.email,
        {
          data: {
            full_name: data.full_name,
            phone: data.phone,
            organization_id: organizationId,
            role_id: data.role_id
          },
          redirectTo: `${window.location.origin}/auth`
        }
      );

      if (inviteError) throw inviteError;

      // 記錄操作日誌
      const currentUser = await supabase.auth.getUser();
      if (currentUser.data.user) {
        await supabase
          .from('user_operation_logs')
          .insert({
            operator_id: currentUser.data.user.id,
            target_user_id: inviteData.user?.id,
            operation_type: 'invite',
            operation_details: {
              email: data.email,
              full_name: data.full_name,
              organization_id: organizationId
            }
          });
      }

      queryClient.invalidateQueries({ queryKey: ['organization_users'] });
      toast.success('邀請已發送，用戶將收到註冊郵件');
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error('Error inviting user:', error);
      toast.error('邀請使用者失敗');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>邀請新使用者</DialogTitle>
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
              發送邀請
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
