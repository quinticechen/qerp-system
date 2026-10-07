import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Mail } from 'lucide-react';
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
import { getPasswordErrorMessage, sendPasswordResetEmail } from '@/lib/authService';

interface ForgotPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEmail?: string;
}

const ForgotPasswordDialog = ({ open, onOpenChange, defaultEmail = '' }: ForgotPasswordDialogProps) => {
  const [email, setEmail] = useState(defaultEmail);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Start each opening fresh, prefilled with the email typed on the login form.
  useEffect(() => {
    if (open) {
      setEmail(defaultEmail);
      setSent(false);
    }
  }, [open, defaultEmail]);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error('請輸入電子郵件');
      return;
    }

    setIsSending(true);
    try {
      await sendPasswordResetEmail(trimmedEmail);
      setSent(true);
      toast.success('重設密碼信已寄出，請檢查您的收件箱');
    } catch (error) {
      console.error('Password reset email error:', error);
      toast.error(getPasswordErrorMessage(error));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重設密碼</DialogTitle>
          <DialogDescription>
            輸入您註冊時使用的電子郵件，我們會寄送重設密碼連結給您。
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              若 <span className="font-semibold">{email.trim()}</span> 已註冊，您將在幾分鐘內收到重設密碼信。
              請點擊信中連結設定新密碼（也請檢查垃圾郵件匣）。
            </p>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>關閉</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">電子郵件</Label>
              <Input
                id="reset-email"
                type="email"
                placeholder="請輸入您的電子郵件"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={isSending}>
                <Mail className="mr-2 h-4 w-4" />
                {isSending ? '寄送中...' : '寄送重設連結'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ForgotPasswordDialog;
