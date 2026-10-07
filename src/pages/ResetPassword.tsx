import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, KeyRound } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import {
  MIN_PASSWORD_LENGTH,
  getPasswordErrorMessage,
  updatePassword,
  validateNewPassword,
} from '@/lib/authService';

// Supabase appends error details to the hash when the recovery link is invalid or expired.
const hasLinkError = (): boolean => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.has('error') || params.has('error_code');
};

const ResetPassword = () => {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [linkError] = useState(hasLinkError);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateNewPassword(newPassword, confirmPassword);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setIsSaving(true);
    try {
      await updatePassword(newPassword);
      toast.success('密碼已重設，歡迎回來');
      navigate('/dashboard', { replace: true });
    } catch (error) {
      console.error('Password reset error:', error);
      toast.error(getPasswordErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const renderContent = () => {
    if (loading) {
      return <p className="text-center text-slate-600">驗證連結中...</p>;
    }

    if (linkError || !session) {
      return (
        <div className="space-y-4">
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              重設密碼連結無效或已過期，請回到登入頁重新申請。
            </AlertDescription>
          </Alert>
          <Button className="w-full" onClick={() => navigate('/login', { replace: true })}>
            返回登入頁
          </Button>
        </div>
      );
    }

    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">
          帳號：<span className="font-semibold">{session.user.email}</span>
        </p>
        <div className="space-y-2">
          <Label htmlFor="reset-new-password">新密碼</Label>
          <Input
            id="reset-new-password"
            type="password"
            autoComplete="new-password"
            placeholder={`至少 ${MIN_PASSWORD_LENGTH} 個字元`}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reset-confirm-password">確認新密碼</Label>
          <Input
            id="reset-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={isSaving}>
          {isSaving ? '更新中...' : '設定新密碼'}
        </Button>
      </form>
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 px-4">
      <Card className="w-full max-w-md border-0 shadow-2xl shadow-blue-500/10">
        <CardHeader className="text-center space-y-2">
          <CardTitle className="flex items-center justify-center gap-3 text-2xl font-bold text-slate-800">
            <KeyRound className="h-6 w-6 text-blue-600" />
            重設密碼
          </CardTitle>
          <CardDescription>請為您的帳號設定新的登入密碼</CardDescription>
        </CardHeader>
        <CardContent>{renderContent()}</CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
