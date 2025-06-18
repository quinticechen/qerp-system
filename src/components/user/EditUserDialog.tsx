
import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface EditUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: any;
}

export const EditUserDialog: React.FC<EditUserDialogProps> = ({
  open,
  onOpenChange,
  user,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');

  // Get current organization
  const { data: currentOrg } = useQuery({
    queryKey: ['current-organization'],
    queryFn: async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return null;

      const { data: userOrgs } = await supabase
        .from('user_organizations')
        .select('organization_id, organizations(*)')
        .eq('user_id', currentUser.id)
        .eq('is_active', true)
        .limit(1);

      return userOrgs?.[0]?.organizations || null;
    }
  });

  // Get available roles for the organization
  const { data: availableRoles } = useQuery({
    queryKey: ['organization-roles', currentOrg?.id],
    queryFn: async () => {
      if (!currentOrg?.id) return [];

      const { data, error } = await supabase
        .from('organization_roles')
        .select('*')
        .eq('organization_id', currentOrg.id)
        .eq('is_active', true)
        .order('display_name');

      if (error) throw error;
      return data || [];
    },
    enabled: !!currentOrg?.id
  });

  // Get user's current role
  const { data: userRole } = useQuery({
    queryKey: ['user-role', user?.id, currentOrg?.id],
    queryFn: async () => {
      if (!user?.id || !currentOrg?.id) return null;

      const { data, error } = await supabase
        .from('user_organization_roles')
        .select('role_id, organization_roles(*)')
        .eq('user_id', user.id)
        .eq('organization_id', currentOrg.id)
        .eq('is_active', true)
        .limit(1);

      if (error) throw error;
      return data?.[0] || null;
    },
    enabled: !!user?.id && !!currentOrg?.id
  });

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  useEffect(() => {
    if (userRole) {
      setSelectedRoleId(userRole.role_id);
    }
  }, [userRole]);

  const updateUserMutation = useMutation({
    mutationFn: async (userData: {
      userId: string;
      fullName: string;
      phone: string;
      roleId: string;
    }) => {
      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: userData.fullName,
          phone: userData.phone,
        })
        .eq('id', userData.userId);

      if (profileError) throw profileError;

      // Update role if changed
      if (userData.roleId !== userRole?.role_id) {
        // Deactivate current role
        if (userRole?.role_id) {
          await supabase
            .from('user_organization_roles')
            .update({ is_active: false })
            .eq('user_id', userData.userId)
            .eq('organization_id', currentOrg!.id)
            .eq('role_id', userRole.role_id);
        }

        // Add new role
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        await supabase
          .from('user_organization_roles')
          .insert({
            user_id: userData.userId,
            organization_id: currentOrg!.id,
            role_id: userData.roleId,
            granted_by: currentUser!.id,
          });
      }
    },
    onSuccess: () => {
      toast({
        title: "成功",
        description: "用戶資料已更新",
      });
      queryClient.invalidateQueries({ queryKey: ['organization-users'] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      console.error('Error updating user:', error);
      toast({
        title: "錯誤",
        description: "更新用戶資料時發生錯誤",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!user?.id || !currentOrg?.id || !selectedRoleId) {
      toast({
        title: "錯誤",
        description: "請填寫所有必填欄位",
        variant: "destructive",
      });
      return;
    }

    updateUserMutation.mutate({
      userId: user.id,
      fullName,
      phone,
      roleId: selectedRoleId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>編輯用戶</DialogTitle>
          <DialogDescription>
            編輯用戶的基本資料和角色權限
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">電子郵件</Label>
            <Input
              id="email"
              value={user?.email || ''}
              disabled
              className="bg-gray-100"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">姓名</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="輸入姓名"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">電話</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="輸入電話號碼"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">角色</Label>
            <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="選擇角色" />
              </SelectTrigger>
              <SelectContent>
                {availableRoles?.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={updateUserMutation.isPending}
          >
            {updateUserMutation.isPending ? '更新中...' : '更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
