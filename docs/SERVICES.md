# 選用服務

> 現況文件（2026-10-16）。

| 服務 | 用途 | 設定 |
|------|------|------|
| Supabase | PostgreSQL 資料庫、Auth（Email 密碼、Google OAuth）、PostgREST API | 專案 `gyiyedvutcbwzpbcsmjc`；只有一個環境（正式），migration 直接套用到正式資料庫 |
| Vercel | 前端部署：正式（production）與預覽（preview）部署 | 環境變數 `VITE_QUERY_API_URL`（AI 伺服器網址）；建置時依 `VERCEL_ENV` 決定 `APP_ENV`：production → 正式、preview → staging（`vite.config.ts`、`src/lib/appEnvironment.ts`） |
| Google Cloud Run | AI 伺服器 `query-ai-agent`（`asia-south1`，專案 `erp-system-463209`） | 由 `mcp-server/Dockerfile` 持續部署；環境變數 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`OPENROUTER_API_KEY`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`（選用 `LANGFUSE_SAMPLE_RATE`，預設 0.05）。trace 在回覆後送出；CPU 只在處理請求時分配時，送出可能延到下一個請求，停機（SIGTERM）前會送完 |
| OpenRouter | AI 模型閘道 | 預設順序：`google/gemini-2.5-flash-lite` → `google/gemini-2.5-flash` → `anthropic/claude-haiku-4.5`（`mcp-server/src/agent/ai-gateway.ts`） |
| Langfuse | Langfuse Cloud（EU），以官方 SDK v6 使用：AI eval 的案例（Dataset `query-agent`）與 experiment；Query Agent 的 system prompt 版本（Prompt Management，正式環境讀 `production` 標籤，讀不到時用程式內建的版本）；正式環境的 trace（去個資、抽樣 5%，[AGENT.md](./AGENT.md)）與使用者的讚／倒讚；score config、標註佇列與 LLM 評審的校準 | `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`（[EVALS.md](./EVALS.md)）。LLM 評審在 Langfuse 執行需要在 Settings → LLM Connections 建立連線 |
| GitHub Actions | `Query Agent Eval`（手動觸發的 eval）、`Keep Supabase Active` | eval 需要的 repository secrets 見 [QUERY_AGENT_EVALS.md](./QUERY_AGENT_EVALS.md) §3.1 |
| Google OAuth | 以 Google 帳號登入 | Supabase Auth 的 redirect 允許清單需包含 `http://localhost:8080/**` |

## 環境

| 環境 | 前端 | 資料庫 | 尚未實作的功能 |
|------|------|--------|----------------|
| 正式 | Vercel production | Supabase（唯一） | 不顯示 |
| Staging | Vercel preview | 同一個 Supabase | 灰底顯示 |
| 本地 | `bun run dev`（port 8080） | 同一個 Supabase | 灰底顯示 |

目前沒有獨立的測試資料庫；資料庫變更以回滾測試（`supabase/tests/run.sql`）先驗證再套用。
