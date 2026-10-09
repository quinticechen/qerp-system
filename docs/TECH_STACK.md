# 技術棧

> 現況文件（2026-10-09）。外部服務見 [SERVICES.md](./SERVICES.md)，套件版本見 [DEPENDENCIES.md](./DEPENDENCIES.md)。

## 1. 前端（`src/`）

| 項目 | 選用 |
|------|------|
| 語言與框架 | TypeScript、React 18 |
| 建置 | Vite 5（開發伺服器 port 8080） |
| UI | shadcn/ui（Radix UI）＋ Tailwind CSS 3；圖示 lucide-react |
| 路由 | React Router 6 |
| 伺服器狀態 | TanStack Query（React Query） |
| 表單與驗證 | react-hook-form、zod |
| 資料存取 | `@supabase/supabase-js`；業務寫入包在 `src/lib/api/*.ts` |
| 測試 | Vitest、Testing Library（jsdom）；`scripts/verify-query-ui.py`（Playwright）驗證 AI 查詢畫面 |
| 套件管理 | Bun |

結構：

```
src/
├── pages/           路由頁面
├── components/      依功能分資料夾（order、purchase、inventory、shipping、product…）；ui/ 為 shadcn/ui
├── hooks/           資料讀取與權限（useProductCatalog、usePermissions…）
├── lib/api/         業務 API 呼叫（callApi、ApiError）
├── lib/             共用邏輯（日期、環境、權限標籤、編輯紀錄標籤）
└── integrations/supabase/  Supabase client 與資料庫型別（types.ts）
```

## 2. 資料庫與後端邏輯（`supabase/`）

| 項目 | 做法 |
|------|------|
| 資料庫 | Supabase PostgreSQL 17 |
| 商業邏輯 | PL/pgSQL 函式（業務 API）：實作在不公開的 `private` schema（`SECURITY DEFINER`），`public` 的同名包裝函式經 PostgREST 以 RPC 呼叫；錯誤以 `api_fail()` 回報 4xx（[API.md](./API.md) §2.3） |
| 權限 | RLS 依權限鍵（[PERMISSIONS.md](./PERMISSIONS.md)） |
| 衍生資料 | 觸發器重算出貨、入庫進度與單據編號；`record_audit_logs` 觸發器記錄編輯紀錄 |
| 結構變更 | `supabase/migrations/*.sql`，在 Supabase SQL Editor 套用 |
| 測試 | `supabase/tests/*.test.sql`：交易內執行、最後一定回滾；`build-run.sh` 組成 `run.sql` 在 SQL Editor 執行 |

## 3. AI 伺服器（`mcp-server/`）

| 項目 | 選用 |
|------|------|
| 執行環境 | Node.js（TypeScript），Express 5 |
| 模型呼叫 | Vercel AI SDK（`ai`）＋ OpenRouter provider |
| 協定 | Model Context Protocol（`@modelcontextprotocol/sdk`） |
| 測試 | `bun run test`（node:test）；`bun run eval` 以假資料庫重播案例 |

細節見 [AGENT.md](./AGENT.md)、[EVALS.md](./EVALS.md)。
