
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationContext } from '@/contexts/OrganizationContext';

interface DeleteOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DeleteOrganizationDialog = ({ open, onOpenChange }: DeleteOrganizationDialogProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { currentOrganization, refreshOrganizations } = useOrganizationContext();
  const [confirmText, setConfirmText] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const orgName = currentOrganization?.name ?? '';
  const canDelete = understood && confirmText === orgName && !isDeleting;

  const resetState = () => {
    setConfirmText('');
    setUnderstood(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!isDeleting) {
      if (!next) resetState();
      onOpenChange(next);
    }
  };

  const handleDelete = async () => {
    if (!currentOrganization || !canDelete) return;

    setIsDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_organization', {
        _organization_id: currentOrganization.id,
        _confirm_name: confirmText,
      });

      if (error) throw error;

      toast({
        title: '組織已刪除',
        description: `「${orgName}」已從介面中移除`,
      });

      try {
        localStorage.removeItem('currentOrganizationId');
      } catch {
        // ignore storage errors
      }

      resetState();
      onOpenChange(false);
      await refreshOrganizations();
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Error deleting organization:', error);
      toast({
        title: '刪除失敗',
        description: (error as { message?: string }).message ?? '請稍後再試或聯繫系統管理員',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle size={20} />
            刪除組織
          </DialogTitle>
          <DialogDescription>
            刪除後，「{orgName}」會立即從您與所有成員的介面中移除，無法再存取或找回。
            組織內的資料會基於稽核目的保留，但您將無法再自行復原此組織。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="confirm-org-name">
              請輸入組織名稱「<span className="font-semibold">{orgName}</span>」以確認
            </Label>
            <Input
              id="confirm-org-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={orgName}
              disabled={isDeleting}
              autoComplete="off"
            />
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="confirm-understood"
              checked={understood}
              onCheckedChange={(checked) => setUnderstood(checked === true)}
              disabled={isDeleting}
            />
            <Label htmlFor="confirm-understood" className="text-sm font-normal leading-snug cursor-pointer">
              我了解此操作無法復原，組織將從介面中移除且無法自行找回
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isDeleting}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={!canDelete}
          >
            {isDeleting ? '刪除中...' : '永久刪除組織'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
