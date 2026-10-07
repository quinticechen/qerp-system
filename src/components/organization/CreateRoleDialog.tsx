
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useForm } from 'react-hook-form';
import { useToast } from '@/hooks/use-toast';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import { PERMISSION_GROUPS } from '@/lib/permissionLabels';

interface CreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface CreateRoleForm {
  name: string;
  display_name: string;
  description?: string;
}


export const CreateRoleDialog = ({ open, onOpenChange, onSuccess }: CreateRoleDialogProps) => {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<CreateRoleForm>();
  const { toast } = useToast();
  const { currentOrganization } = useOrganizationContext();
  const [selectedPermissions, setSelectedPermissions] = React.useState<Record<string, boolean>>({});

  const onSubmit = async (data: CreateRoleForm) => {
    if (!currentOrganization) return;

    try {
      const { error } = await supabase
        .from('organization_roles')
        .insert({
          organization_id: currentOrganization.id,
          name: data.name.toLowerCase().replace(/\s+/g, '_'),
          display_name: data.display_name,
          description: data.description,
          permissions: selectedPermissions,
          is_system_role: false,
        });

      if (error) throw error;

      toast({
        title: "角色創建成功",
        description: "新角色已成功創建",
      });

      reset();
      setSelectedPermissions({});
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Error creating role:', error);
      toast({
        title: "創建角色失敗",
        description: "請稍後再試或聯繫系統管理員",
        variant: "destructive",
      });
    }
  };

  const handlePermissionChange = (permission: string, checked: boolean) => {
    setSelectedPermissions(prev => ({
      ...prev,
      [permission]: checked
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>創建新角色</DialogTitle>
          <DialogDescription>
            為您的組織創建一個新的角色，並設定相應的權限。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="display_name">角色顯示名稱 *</Label>
              <Input
                id="display_name"
                {...register('display_name', { required: true })}
                placeholder="例如：銷售經理"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">角色識別碼 *</Label>
              <Input
                id="name"
                {...register('name', { required: true })}
                placeholder="例如：sales_manager"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">角色描述</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="簡單描述這個角色的職責（可選）"
              rows={3}
            />
          </div>

          <div className="space-y-4">
            <Label className="text-base font-medium">權限設定</Label>
            <div className="space-y-6">
              {Object.entries(PERMISSION_GROUPS).map(([group, permissions]) => (
                <div key={group} className="space-y-3">
                  <h4 className="font-medium text-gray-900">{group}</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {permissions.map((permission) => (
                      <div key={permission.key} className="flex items-center space-x-2">
                        <Checkbox
                          id={permission.key}
                          checked={selectedPermissions[permission.key] || false}
                          onCheckedChange={(checked) => 
                            handlePermissionChange(permission.key, checked as boolean)
                          }
                        />
                        <Label 
                          htmlFor={permission.key}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {permission.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
              className="bg-blue-600 hover:bg-blue-700"
              disabled={isSubmitting}
            >
              {isSubmitting ? '創建中...' : '創建角色'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
