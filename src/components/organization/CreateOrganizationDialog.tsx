
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useForm } from 'react-hook-form';
import { useToast } from '@/hooks/use-toast';
import { useOrganizationContext } from '@/contexts/OrganizationContext';

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>創建新組織</DialogTitle>
          <DialogDescription>
            為您的團隊創建一個新的組織。您將成為該組織的擁有者，擁有完整的管理權限。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">組織名稱 *</Label>
            <Input
              id="name"
              {...register('name', { required: true })}
              placeholder="輸入組織名稱"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">組織描述</Label>
            <Textarea
              id="description"
              {...register('description')}
              placeholder="簡單描述您的組織（可選）"
              rows={3}
            />
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
              {isSubmitting ? '創建中...' : '創建組織'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
