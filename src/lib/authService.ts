import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export const MIN_PASSWORD_LENGTH = 6;

export const RESET_PASSWORD_PATH = '/reset-password';

// Sends a recovery email; the link lands on the reset page with a recovery session.
export const sendPasswordResetEmail = async (email: string): Promise<void> => {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
  });
  if (error) throw error;
};

// Updates the password of the currently signed-in user (normal or recovery session).
export const updatePassword = async (newPassword: string): Promise<void> => {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
};

// Re-authenticates with the current password; returns false if it is wrong.
export const verifyCurrentPassword = async (email: string, password: string): Promise<boolean> => {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
};

// OAuth-only accounts (e.g. Google) have no password yet, so there is nothing to verify.
export const hasEmailPassword = (user: User): boolean => {
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [];
  if (providers.length > 0) return providers.includes('email');
  return user.app_metadata?.provider === 'email';
};

// Returns a Chinese validation message, or null when the pair is valid.
export const validateNewPassword = (password: string, confirmPassword: string): string | null => {
  if (password.length < MIN_PASSWORD_LENGTH) return `密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元`;
  if (password !== confirmPassword) return '兩次輸入的密碼不一致';
  return null;
};

// Maps Supabase auth errors to user-facing Chinese messages.
export const getPasswordErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('should be different')) return '新密碼不可與目前密碼相同';
  if (message.includes('rate limit') || message.includes('security purposes')) return '操作過於頻繁，請稍後再試';
  if (message.includes('weak') || message.includes('Password should')) return '密碼強度不足，請使用更複雜的密碼';
  if (message.includes('session')) return '驗證已失效，請重新申請重設密碼';
  return '操作失敗，請稍後再試';
};
