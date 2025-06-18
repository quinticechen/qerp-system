
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { useToast } from '@/hooks/use-toast';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

interface TransferOwnershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface TransferForm {
  new_owner_id: string;
}

export const TransferOwnershipDialog = ({ open, onOpenChange, onSuccess }: TransferOwnershipDialogProps) => {
  const { handleSubmit, setValue, watch, formState: { isSubmitting } } = useForm<TransferForm>();
  const { toast } = useToast();
  const { currentOrganization } = useOrganizationContext();
  const { organizationId } = useCurrentOrganization();
  
  const selectedUserId = watch('new_owner_id');

  // 獲取組織成員列表（排除當前擁有者）
  const { data: members = [] } = useQuery({
    queryKey: ['organization-members-for-transfer', organizationId],
    queryFn: async () => {
      if (!organizationId || !currentOrganization) return [];

      // 獲取組織成員
      const { data: userOrgs, error: userOrgsError } = await supabase
        .from('user_organizations')
        .select('user_id')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .neq('user_id', currentOrganization.owner_id);

      if (userOrgsError) throw userOrgsError;

      if (!userOrgs || userOrgs.length === 0) return [];

      const userIds = userOrgs.map(uo => uo.user_id);

      // 獲取用戶資料
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds)
        .eq('is_active', true);

      if (profilesError) throw profilesError;

      return profiles || [];
    },
    enabled: !!organizationId && !!currentOrganization && open
  });

  const onSubmit = async (data: TransferForm) => {
    if (!currentOrganization) return;

    try {
      // 更新組織擁有者
      const { error: updateError } = await supabase
        .from('organizations')
        .update({ owner_id: data.new_owner_id })
        .eq('id', currentOrganization.id);

      if (updateError) throw updateError;

      // 為新擁有者分配 owner 角色
      const { data: ownerRole } = await supabase
        .from('organization_roles')
        .select('id')
        .eq('organization_id', currentOrganization.id)
        .eq('name', 'owner')
        .single();

      if (ownerRole) {
        // 移除舊擁有者的 owner 角色
        await supabase
          .from('user_organization_roles')
          .update({ is_active: false })
          .eq('organization_id', currentOrganization.id)
          .eq('role_id', ownerRole.id)
          .eq('user_id', currentOrganization.owner_id);

        // 為新擁有者分配 owner 角色
        await supabase
          .from('user_organization_roles')
          .upsert({
            user_id: data.new_owner_id,
            organization_id: currentOrganization.id,
            role_id: ownerRole.id,
            granted_by: currentOrganization.owner_id,
            is_active: true
          });
      }

      toast({
        title: "所有權轉移成功",
        description: "組織所有權已成功轉移",
      });

      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Error transferring ownership:', error);
      toast({
        title: "轉移失敗",
        description: "無法轉移組織所有權，請稍後再試",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>轉移組織所有權</DialogTitle>
          <DialogDescription>
            選擇要轉移所有權的組織成員。此操作不可撤銷，請謹慎選擇。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new_owner_id">選擇新擁有者 *</Label>
            <Select onValueChange={(value) => setValue('new_owner_id', value)} value={selectedUserId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇組織成員" />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.full_name || member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {members.length === 0 && (
              <p className="text-sm text-gray-500">目前沒有其他組織成員可以轉移所有權</p>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
            <p className="text-sm text-amber-800">
              <strong>警告：</strong>轉移所有權後，您將失去組織的最高管理權限，此操作無法撤銷。
            </p>
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              取消
            </Button>
            <Button 
              type="submit" 
              variant="destructive"
              disabled={isSubmitting || !selectedUserId || members.length === 0}
            >
              {isSubmitting ? '轉移中...' : '確認轉移'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
