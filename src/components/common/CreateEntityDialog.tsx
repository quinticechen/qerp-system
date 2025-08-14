import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentOrganization } from '@/hooks/useCurrentOrganization';

interface EntityField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'textarea';
  required?: boolean;
  placeholder?: string;
  rows?: number;
}

interface CreateEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEntityCreated: () => void;
  entityType: 'customer' | 'factory';
  title: string;
  tableName: 'customers' | 'factories';
  fields: EntityField[];
}

export const CreateEntityDialog: React.FC<CreateEntityDialogProps> = ({
  open,
  onOpenChange,
  onEntityCreated,
  entityType,
  title,
  tableName,
  fields,
}) => {
  const [loading, setLoading] = useState(false);
  const { organizationId } = useCurrentOrganization();
  
  const initialFormData = fields.reduce((acc, field) => {
    acc[field.key] = '';
    return acc;
  }, {} as Record<string, string>);
  
  const [formData, setFormData] = useState(initialFormData);

  const validateForm = () => {
    // 驗證名稱
    if (!formData.name?.trim()) {
      toast.error(`請輸入${entityType === 'customer' ? '客戶' : '工廠'}名稱`);
      return false;
    }
    
    // 驗證聯絡人
    if (!formData.contact_person?.trim()) {
      toast.error('請輸入聯絡人');
      return false;
    }
    
    // 驗證至少一個電話
    if (!formData.phone?.trim() && !formData.landline_phone?.trim()) {
      toast.error('請至少輸入一個電話號碼（手機或市話）');
      return false;
    }
    
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    if (!organizationId) {
      toast.error('請先選擇組織');
      return;
    }

    setLoading(true);
    try {
      const entityData: any = {
        ...formData,
        organization_id: organizationId
      };

      const { error } = await supabase
        .from(tableName)
        .insert(entityData);

      if (error) {
        console.error(`Error creating ${entityType}:`, error);
        throw error;
      }

      toast.success(`${entityType === 'customer' ? '客戶' : '工廠'}創建成功`);
      setFormData(initialFormData);
      onEntityCreated();
      onOpenChange(false);
    } catch (error: any) {
      console.error(`Error creating ${entityType}:`, error);
      toast.error(`創建${entityType === 'customer' ? '客戶' : '工廠'}失敗`);
    } finally {
      setLoading(false);
    }
  };

  const updateFormData = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key}>
                {field.label} {field.required && '*'}
              </Label>
              {field.type === 'textarea' ? (
                <Textarea
                  id={field.key}
                  value={formData[field.key] || ''}
                  onChange={(e) => updateFormData(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  rows={field.rows || 3}
                  required={field.required}
                />
              ) : (
                <Input
                  id={field.key}
                  type={field.type}
                  value={formData[field.key] || ''}
                  onChange={(e) => updateFormData(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                />
              )}
            </div>
          ))}

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              取消
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? '創建中...' : `創建${entityType === 'customer' ? '客戶' : '工廠'}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};