// Which deployment the app is running in. Set at build time by vite.config.ts from Vercel's VERCEL_ENV
// (production → production, preview → staging) or overridden with VITE_APP_ENV; the dev server is development.
export type AppEnvironment = 'production' | 'staging' | 'development';

const declared = import.meta.env.VITE_APP_ENV as string | undefined;

export const APP_ENV: AppEnvironment =
  declared === 'production' || declared === 'staging' || declared === 'development'
    ? declared
    : import.meta.env.PROD
      ? 'production'
      : 'development';

// Features that are on screen but not implemented yet are hidden in production and shown greyed out elsewhere
export const SHOW_UNFINISHED_FEATURES = APP_ENV !== 'production';
