import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import {
  MIN_PASSWORD_LENGTH,
  getPasswordErrorMessage,
  hasEmailPassword,
  updatePassword,
  validateNewPassword,
  verifyCurrentPassword,
} from '@/lib/authService';

interface ProfileSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ProfileSettingsDialog = ({ open, onOpenChange }: ProfileSettingsDialogProps) => {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const requiresCurrentPassword = user ? hasEmailPassword(user) : true;
  const fullName = (user?.user_metadata?.full_name as string | undefined) ?? '';

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;

    if (requiresCurrentPassword && !currentPassword) {
      toast.error('請輸入目前密碼');
      return;
    }
    const validationError = validateNewPassword(newPassword, confirmPassword);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsSaving(true);
    try {
      if (requiresCurrentPassword) {
        const isValid = await verifyCurrentPassword(user.email, currentPassword);
        if (!isValid) {
          toast.error('目前密碼不正確');
          return;
        }
      }
      await updatePassword(newPassword);
      toast.success('密碼已更新');
      handleOpenChange(false);
    } catch (error) {
      console.error('Password update error:', error);
      toast.error(getPasswordErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>個人設定</DialogTitle>
          <DialogDescription>檢視帳號資訊並變更登入密碼。</DialogDescription>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">電子郵件：</span>
            {user?.email}
          </p>
          {fullName && (
            <p>
              <span className="text-muted-foreground">姓名：</span>
              {fullName}
            </p>
          )}
        </div>

        <Separator />

        <form onSubmit={handleSubmit} className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4" />
            {requiresCurrentPassword ? '變更密碼' : '設定密碼'}
          </h3>
          {!requiresCurrentPassword && (
            <p className="text-xs text-muted-foreground">
              您目前使用第三方帳號登入，設定密碼後也可以使用電子郵件與密碼登入。
            </p>
          )}

          {requiresCurrentPassword && (
            <div className="space-y-2">
              <Label htmlFor="current-password">目前密碼</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-password">新密碼</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              placeholder={`至少 ${MIN_PASSWORD_LENGTH} 個字元`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">確認新密碼</Label>
            <Input
              id="confirm-new-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? '更新中...' : '更新密碼'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ProfileSettingsDialog;
