
import React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useForm } from 'react-hook-form';
import { useToast } from '@/hooks/use-toast';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { RecordDialog } from '@/components/common/RecordDialog';
import { FormField } from '@/components/common/FormField';

interface CreateOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreateOrganizationForm {
  name: string;
  description?: string;
}

export const CreateOrganizationDialog = ({ open, onOpenChange }: CreateOrganizationDialogProps) => {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<CreateOrganizationForm>();
  const { toast } = useToast();
  const { createOrganization } = useOrganizationContext();

  const onSubmit = async (data: CreateOrganizationForm) => {
    try {
      await createOrganization(data.name, data.description);
      toast({
        title: "組織創建成功",
        description: "您的組織已成功創建，您現在是該組織的擁有者",
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating organization:', error);
      toast({
        title: "創建組織失敗",
        description: "請稍後再試或聯繫系統管理員",
        variant: "destructive",
      });
    }
  };

  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      mode="create"
      title="建立新組織"
      description="為您的團隊建立一個新的組織。您將成為該組織的擁有者，擁有完整的管理權限。"
      formId="create-organization-form"
      submitting={isSubmitting}
      submitLabel="建立組織"
    >
      <form id="create-organization-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <FormField label="組織名稱" htmlFor="organization-name" required>
          <Input id="organization-name" {...register('name', { required: true })} placeholder="輸入組織名稱" />
        </FormField>
        <FormField label="組織描述" htmlFor="organization-description">
          <Textarea id="organization-description" {...register('description')} placeholder="簡單描述您的組織（可選）" rows={3} />
        </FormField>
      </form>
    </RecordDialog>
  );
};
