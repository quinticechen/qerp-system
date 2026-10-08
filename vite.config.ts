import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
// Deployment environment the app shows features for (src/lib/appEnvironment.ts): VITE_APP_ENV wins,
// otherwise Vercel's VERCEL_ENV decides (production / preview → staging), otherwise the Vite mode does
const appEnvironment = (mode: string) =>
  process.env.VITE_APP_ENV ??
  (process.env.VERCEL_ENV === 'production'
    ? 'production'
    : process.env.VERCEL_ENV === 'preview'
      ? 'staging'
      : mode === 'production'
        ? 'production'
        : 'development');

export default defineConfig(({ mode }) => ({
  define: {
    'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnvironment(mode)),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
