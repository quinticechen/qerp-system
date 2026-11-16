/**
 * A same-site path to continue to after sign-in or creating an organization, or null.
 * Only absolute paths on this site are accepted ("/checkout?plan=pro"), never "//evil.com" or a URL.
 */
export const safeNextPath = (value: string | null | undefined): string | null => {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
};
