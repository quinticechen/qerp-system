# 選用服務

> 現況文件（2026-10-09）。

| 服務 | 用途 | 設定 |
|------|------|------|
| Supabase | PostgreSQL 資料庫、Auth（Email 密碼、Google OAuth）、PostgREST API | 專案 `gyiyedvutcbwzpbcsmjc`；只有一個環境（正式），migration 直接套用到正式資料庫 |
| Vercel | 前端部署：正式（production）與預覽（preview）部署 | 環境變數 `VITE_QUERY_API_URL`（AI 伺服器網址）；建置時依 `VERCEL_ENV` 決定 `APP_ENV`：production → 正式、preview → staging（`vite.config.ts`、`src/lib/appEnvironment.ts`） |
| Google Cloud Run | AI 伺服器 `query-ai-agent`（`asia-east1`，專案 `erp-system-463209`） | 由 `mcp-server/Dockerfile` 持續部署；環境變數 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`OPENROUTER_API_KEY` |
| OpenRouter | AI 模型閘道 | 預設順序：`google/gemini-2.5-flash-lite` → `google/gemini-2.5-flash` → `anthropic/claude-haiku-4.5`（`mcp-server/src/agent/ai-gateway.ts`） |
| Langfuse | AI eval 結果的實驗紀錄與比較 | `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`（[EVALS.md](./EVALS.md)） |
| Google OAuth | 以 Google 帳號登入 | Supabase Auth 的 redirect 允許清單需包含 `http://localhost:8080/**` |

## 環境

| 環境 | 前端 | 資料庫 | 尚未實作的功能 |
|------|------|--------|----------------|
| 正式 | Vercel production | Supabase（唯一） | 不顯示 |
| Staging | Vercel preview | 同一個 Supabase | 灰底顯示 |
| 本地 | `bun run dev`（port 8080） | 同一個 Supabase | 灰底顯示 |

目前沒有獨立的測試資料庫；資料庫變更以回滾測試（`supabase/tests/run.sql`）先驗證再套用。
