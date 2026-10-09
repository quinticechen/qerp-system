# 紡織業 ERP 系統（weave-flow-erp-system）

給紡織業的多組織 ERP：管理產品（產品與顏色）、客戶、工廠、貨架，並串起「訂單 → 採購 → 入庫 → 出貨」的流程與庫存；另有以中文對話查詢與建立資料的 AI 助理。

## 架構

```
┌──────────────────────────┐        ┌──────────────────────────────┐
│ 前端（React + Vite）      │        │ AI 伺服器 mcp-server          │
│ Vercel                    │──────▶ │ Cloud Run（Express + AI SDK） │──▶ OpenRouter（模型）
│ src/                      │ /query │ 路由器 + 子 Agent + tools      │
└────────────┬─────────────┘        └──────────────┬───────────────┘
             │ supabase-js（使用者 JWT）              │ supabase-js（同一位使用者的 JWT）
             ▼                                        ▼
┌──────────────────────────────────────────────────────────────────┐
│ Supabase（PostgreSQL 17、Auth、PostgREST）                         │
│ · 業務 API：PL/pgSQL 函式，檢查權限、寫入、計算進度與編號           │
│ · RLS：依組織與權限鍵限制讀寫                                       │
│ · 觸發器：出貨與入庫進度、單據編號、編輯紀錄                         │
└──────────────────────────────────────────────────────────────────┘
```

- **所有業務寫入都經過資料庫的業務 API**（`supabase.rpc`），前端與 AI 共用同一套規則；讀取直接查資料表或 view，由 RLS 限制。
- **權限在資料庫判斷**：`user_has_organization_permission()` 是唯一的判斷來源，RLS、業務 API、AI 都用它；前端只負責畫面一致。
- **AI 不直接寫入**：寫入類 tool 只產生確認卡片，使用者確認後才執行。

## 目錄

| 路徑 | 內容 |
|------|------|
| `src/` | 前端（頁面、元件、hooks、`lib/api` 業務 API 呼叫） |
| `mcp-server/` | AI 伺服器、tools、eval |
| `supabase/migrations/` | 資料庫結構與函式 |
| `supabase/tests/` | 資料庫回滾測試 |
| `scripts/` | 瀏覽器驗證腳本 |
| `docs/` | 現況文件（下表） |
| `docs/requirements/` | 開發需求、計畫與決策（[規則](./docs/requirements/README.md)） |

## 文件

現況（系統現在是什麼樣子）：

| 文件 | 內容 |
|------|------|
| [FEATURES.md](./docs/FEATURES.md) | 功能 |
| [TECH_STACK.md](./docs/TECH_STACK.md) | 技術棧與程式結構 |
| [SERVICES.md](./docs/SERVICES.md) | 選用的外部服務與環境 |
| [DEPENDENCIES.md](./docs/DEPENDENCIES.md) | 套件相依性 |
| [API.md](./docs/API.md) | 業務 API、組織與成員 RPC、AI 伺服器端點 |
| [DATABASE_TABLES.md](./docs/DATABASE_TABLES.md) | 資料表與業務邏輯 |
| [PERMISSIONS.md](./docs/PERMISSIONS.md) | 角色與權限 |
| [AGENT.md](./docs/AGENT.md) | AI 查詢助理的架構與 tools |
| [EVALS.md](./docs/EVALS.md) | AI eval 服務 |
| [SESSION_COORDINATION.md](./docs/SESSION_COORDINATION.md) | 兩個開發 Session 的分工與交接 |

需求做完時，同一次修改要更新對應的現況文件（[docs/requirements/README.md](./docs/requirements/README.md)）。

## 開發

```bash
bun run dev          # 前端，http://localhost:8080
bun run test         # 前端單元測試
bun run lint

cd mcp-server
bun run dev          # AI 伺服器，http://localhost:3100
bun run test         # tools 與權限測試
bun run eval -- --label <改了什麼>
```

- 驗證 AI 查詢畫面：`python3 scripts/verify-query-ui.py --headless`（帳號在 `.env` 的 `VERIFY_EMAIL`／`VERIFY_PASSWORD`）。
- 資料庫變更：`supabase/tests/build-run.sh <migration> -- <測試檔…>` 產生 `run.sql`，在 Supabase SQL Editor 執行通過（結果為 `ALL TESTS PASSED`，一定回滾）後，再套用 migration。
- 開發規則見 [CLAUDE.md](./CLAUDE.md)。
