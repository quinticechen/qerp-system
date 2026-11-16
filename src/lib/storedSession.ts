/**
 * Whether this browser holds a saved Supabase session (default key `sb-<project-ref>-auth-token`).
 * Read synchronously so `/` can pick between the Home page and the signed-in redirect on first paint,
 * before supabase.auth.getSession() settles.
 */
export const hasStoredSession = (): boolean => {
  try {
    return Object.keys(window.localStorage).some((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
  } catch {
    return false;
  }
};
