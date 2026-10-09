/// <reference types="vite/client" />

interface ImportMetaEnv {
  // production | staging | development, set by vite.config.ts (src/lib/appEnvironment.ts)
  readonly VITE_APP_ENV?: string;
}
