# Dependencies

> Current-state document (2026-10-16). Versions follow `package.json`; update this document when adding or removing a package.

## 1. Frontend (`package.json`)

| Purpose | Packages |
|---------|----------|
| Framework | `react`, `react-dom` (18), `react-router-dom` (6) |
| Data | `@supabase/supabase-js` (2), `@tanstack/react-query` (5) |
| UI components | `@radix-ui/react-*` (the base of shadcn/ui), `cmdk` (search menu), `sonner` (toasts), `vaul`, `embla-carousel-react`, `react-day-picker`, `input-otp`, `react-resizable-panels`, `recharts` |
| Styling | `tailwind-merge`, `class-variance-authority`, `clsx`, `tailwindcss-animate`, `lucide-react` (icons), `next-themes` |
| Forms | `react-hook-form`, `@hookform/resolvers`, `zod` |
| Other | `date-fns`, `react-helmet-async` (page titles and SEO) |

Development: `vite`, `@vitejs/plugin-react-swc`, `typescript`, `eslint` (with react-hooks, react-refresh), `tailwindcss`, `postcss`, `autoprefixer`, `vitest`, `jsdom`, `@testing-library/*`, `lovable-tagger` (development mode only).

## 2. AI server (`mcp-server/package.json`)

| Purpose | Packages |
|---------|----------|
| HTTP | `express` (5) |
| Models | `ai` (Vercel AI SDK 4), `@openrouter/ai-sdk-provider` |
| Langfuse | `@langfuse/client`, `@langfuse/tracing`, `@langfuse/otel` (6.0.0, pinned); OpenTelemetry: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/core`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/otlp-exporter-base` (pinned). Requires Node 22 or later |
| MCP | `@modelcontextprotocol/sdk` |
| Data | `@supabase/supabase-js`, `zod` |

Development: `typescript`, `tsx`, `@types/node`, `@types/express`.

## 3. External dependencies

- The frontend depends on Supabase and the AI server; the AI server depends on Supabase and OpenRouter, and Langfuse is optional (failing to read a prompt or send a trace does not affect the reply) ([SERVICES.md](./SERVICES.md)).
- The business APIs' parameters and error codes are a contract that both the frontend and the AI tools depend on ([API.md](./API.md), [SESSION_COORDINATION.md](./SESSION_COORDINATION.md) §4).
