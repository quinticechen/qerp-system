
import React, { useEffect } from 'react';
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
import { RecordAuditHistoryButton } from '@/components/common/RecordAuditHistoryButton';

interface EditRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: any;
  onSuccess: () => void;
}

interface EditRoleForm {
  display_name: string;
  description?: string;
}


export const EditRoleDialog = ({ open, onOpenChange, role, onSuccess }: EditRoleDialogProps) => {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<EditRoleForm>();
  const { toast } = useToast();
  const { currentOrganization } = useOrganizationContext();
  const [selectedPermissions, setSelectedPermissions] = React.useState<Record<string, boolean>>({});

  useEffect(() => {
    if (role && open) {
      reset({
        display_name: role.display_name,
        description: role.description || '',
      });
      setSelectedPermissions(role.permissions || {});
    }
  }, [role, open, reset]);

  const onSubmit = async (data: EditRoleForm) => {
    if (!currentOrganization || !role) return;

    try {
      const { error } = await supabase
        .from('organization_roles')
        .update({
          display_name: data.display_name,
          description: data.description,
          permissions: selectedPermissions,
        })
        .eq('id', role.id)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;

      toast({
        title: "角色更新成功",
        description: "角色資訊已成功更新",
      });

      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Error updating role:', error);
      toast({
        title: "更新角色失敗",
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

  if (!role) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <RecordAuditHistoryButton recordId={role.id} creation={{ tableName: 'organization_roles', createdBy: role.created_by ?? null, createdAt: role.created_at }} className="absolute right-10 top-2" />
          <DialogTitle>編輯角色 - {role.display_name}</DialogTitle>
          <DialogDescription>
            修改角色的基本資訊和權限設定。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="display_name">角色顯示名稱 *</Label>
            <Input
              id="display_name"
              {...register('display_name', { required: true })}
              placeholder="例如：銷售經理"
            />
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
              {isSubmitting ? '更新中...' : '更新角色'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
