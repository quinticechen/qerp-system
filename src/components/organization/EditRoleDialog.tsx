
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

const PERMISSION_GROUPS = {
  '產品管理': [
    { key: 'canViewProducts', label: '查看產品' },
    { key: 'canCreateProducts', label: '新增產品' },
    { key: 'canEditProducts', label: '編輯產品' },
    { key: 'canDeleteProducts', label: '刪除產品' },
  ],
  '庫存管理': [
    { key: 'canViewInventory', label: '查看庫存' },
    { key: 'canCreateInventory', label: '新增庫存' },
    { key: 'canEditInventory', label: '編輯庫存' },
  ],
  '訂單管理': [
    { key: 'canViewOrders', label: '查看訂單' },
    { key: 'canCreateOrders', label: '新增訂單' },
    { key: 'canEditOrders', label: '編輯訂單' },
  ],
  '採購管理': [
    { key: 'canViewPurchases', label: '查看採購' },
    { key: 'canCreatePurchases', label: '新增採購' },
    { key: 'canEditPurchases', label: '編輯採購' },
  ],
  '出貨管理': [
    { key: 'canViewShipping', label: '查看出貨' },
    { key: 'canCreateShipping', label: '新增出貨' },
    { key: 'canEditShipping', label: '編輯出貨' },
  ],
  '客戶管理': [
    { key: 'canViewCustomers', label: '查看客戶' },
    { key: 'canCreateCustomers', label: '新增客戶' },
    { key: 'canEditCustomers', label: '編輯客戶' },
  ],
  '工廠管理': [
    { key: 'canViewFactories', label: '查看工廠' },
    { key: 'canCreateFactories', label: '新增工廠' },
    { key: 'canEditFactories', label: '編輯工廠' },
  ],
  '系統管理': [
    { key: 'canViewUsers', label: '查看使用者' },
    { key: 'canCreateUsers', label: '新增使用者' },
    { key: 'canEditUsers', label: '編輯使用者' },
    { key: 'canViewPermissions', label: '查看權限' },
    { key: 'canEditPermissions', label: '編輯權限' },
    { key: 'canViewSystemSettings', label: '查看系統設定' },
    { key: 'canEditSystemSettings', label: '編輯系統設定' },
  ],
};

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
