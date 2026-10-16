# 相依性

> 現況文件（2026-10-16）。版本以 `package.json` 為準；新增或移除套件時更新本文件。

## 1. 前端（`package.json`）

| 用途 | 套件 |
|------|------|
| 框架 | `react`、`react-dom`（18）、`react-router-dom`（6） |
| 資料 | `@supabase/supabase-js`（2）、`@tanstack/react-query`（5） |
| UI 元件 | `@radix-ui/react-*`（shadcn/ui 的基礎）、`cmdk`（搜尋選單）、`sonner`（提示訊息）、`vaul`、`embla-carousel-react`、`react-day-picker`、`input-otp`、`react-resizable-panels`、`recharts` |
| 樣式 | `tailwind-merge`、`class-variance-authority`、`clsx`、`tailwindcss-animate`、`lucide-react`（圖示）、`next-themes` |
| 表單 | `react-hook-form`、`@hookform/resolvers`、`zod` |
| 其他 | `date-fns`、`react-helmet-async`（頁面標題與 SEO） |

開發：`vite`、`@vitejs/plugin-react-swc`、`typescript`、`eslint`（含 react-hooks、react-refresh）、`tailwindcss`、`postcss`、`autoprefixer`、`vitest`、`jsdom`、`@testing-library/*`、`lovable-tagger`（僅開發模式）。

## 2. AI 伺服器（`mcp-server/package.json`）

| 用途 | 套件 |
|------|------|
| HTTP | `express`（5） |
| 模型 | `ai`（Vercel AI SDK 4）、`@openrouter/ai-sdk-provider` |
| Langfuse | `@langfuse/client`、`@langfuse/tracing`、`@langfuse/otel`（6.0.0，版本固定）；OpenTelemetry：`@opentelemetry/api`、`@opentelemetry/sdk-node`、`@opentelemetry/sdk-trace-base`、`@opentelemetry/core`、`@opentelemetry/exporter-trace-otlp-http`、`@opentelemetry/otlp-exporter-base`（版本固定）。需要 Node 22 以上 |
| MCP | `@modelcontextprotocol/sdk` |
| 資料 | `@supabase/supabase-js`、`zod` |

開發：`typescript`、`tsx`、`@types/node`、`@types/express`。

## 3. 外部依賴

- 前端依賴 Supabase 與 AI 伺服器；AI 伺服器依賴 Supabase 與 OpenRouter，Langfuse 為選用（讀不到 prompt 或送不出 trace 都不影響回覆）（[SERVICES.md](./SERVICES.md)）。
- 業務 API 的參數與錯誤代碼是前端與 AI tools 共同依賴的契約（[API.md](./API.md)、[SESSION_COORDINATION.md](./SESSION_COORDINATION.md) §4）。
