# Query Agent — Phase 0 地基設計

> 狀態：已確認（2026-10-07），實作中
> 範圍：`mcp-server/`（AI Query 後端）＋ `src/hooks/useQueryChat.ts`、`src/components/query/`（前端聊天）
> 相關文件：[ARCHITECTURE.md](./ARCHITECTURE.md)

## 1. 背景與目標

Query 目前只有 17 個 AI tools，覆蓋範圍遠小於 ERP 的 12 個業務領域（客戶、訂單、產品、採購、入庫、庫存、出貨、工廠、貨架、用戶、權限、系統設定）。之後會依業務流程逐條擴充（Phase 1）。

在擴充之前，先把「每個 tool 都會用到」的基礎設施做好，避免事後回頭改幾十個 tools。Phase 0 **不新增業務功能**，目標是：

1. Tool 只定義一次，`/query` 與 `/mcp` 共用
2. AI 權限與 UI 權限出自同一份資料
3. 寫入操作需使用者確認，且不可能被重複執行
4. 對話記憶保留查詢過的實體，跨輪不遺失
5. 有可重播的 eval 測試集，能用數據回答「agent 要不要拆」
6. 每個請求都有可追查的 trace

## 2. 現況問題

| # | 問題 | 影響 | 位置 |
|---|------|------|------|
| 1 | 兩套 tool 實作（AI SDK 17 個、MCP 16 個），描述與行為已不一致 | 修一邊漏一邊；昨天 `list_products` 缺失即為此類 | `agent/tool-registry.ts`、`tools/*.ts` |
| 2 | AI 權限 `ROLE_PERMISSIONS` 寫死，與資料庫 `organization_roles.permissions` 無關 | UI 改了角色權限，AI 不會跟著變；`/mcp` 完全沒有角色過濾 | `agent/permissions.ts` |
| 3 | 寫入的組織由 `getUserOrgId` 取「第一個組織」，前端選擇的組織沒有傳到後端 | 多組織使用者可能寫入錯誤組織 | `utils/get-org-id.ts` |
| 4 | 寫入 tool 直接執行，無確認；模型降級時整段 tool loop 重跑 | 可能重複建單 | `agent/ai-gateway.ts` |
| 5 | 對話只存純文字，不存 tool 呼叫與結果；history 由前端整段送出 | 上一輪查到的 ID 下一輪消失；history 無上限；可被竄改 | `useQueryChat.ts` |
| 6 | Router 把跨領域請求拆給兩個 sub-agent，且會改寫使用者原話 | 「新增訂單給工廠」兩邊都做不完 | `agent/router.ts` |
| 7 | 降級不分錯誤類型，任何錯誤都換模型重試 | `NoSuchToolError` 這類設計錯誤換模型也救不了，白花時間與費用 | `agent/ai-gateway.ts` |
| 8 | 後端 agent 行為沒有任何自動測試（`verify-query-ui.py` 把 `/query` mock 掉） | 改 prompt 或 tool 無法得知是否退步 | — |
| 9 | 只有 `console.log` | 出錯無法追查是哪個模型、哪個 tool 造成 | — |

## 3. 決策

| 決策 | 內容 | 狀態 |
|------|------|------|
| D1 | 業務邏輯抽成共用層：多表寫入做成 Postgres RPC（交易保證＋RLS），單表讀取維持直接查表 | ✅ 已確認 |
| D2 | Agent tool 為「任務層級」，不是逐表 CRUD；UI 與 tool 呼叫同一個 RPC | ✅ 已確認 |
| D3 | 用戶、權限、系統設定：AI 不開放寫入，僅可唯讀查詢 | ✅ 已確認 |
| D4 | Phase 1 第一條流程為訂單主流程：客戶 → 訂單（含品項、工廠）→ 採購 → 入庫 → 庫存 → 出貨 | ✅ 已確認 |
| D5 | 每條流程完成時，UI 同步改用新的 RPC，不保留兩份邏輯 | ✅ 已確認 |
| D6 | Agent 拓撲由 eval 比較決定：**維持 Router × gemini-2.5-flash-lite**（2026-10-07，見 [QUERY_AGENT_ARCHITECTURE_EVAL.md](./QUERY_AGENT_ARCHITECTURE_EVAL.md)） | ✅ 已確認 |
| D7 | `/mcp` 目前沒有外部 client，P0-2 之前先停用；之後由單一 tool 來源重新產生 | ✅ 已確認 |
| D8 | 同意建立 `query_pending_actions`、`query_traces` 與 `query_messages.kind/metadata`，於 P0-4／P0-5／P0-6 各自的步驟中建立 | ✅ 已確認 |

## 4. 設計

### 4.1 Tool 單一來源

每個 tool 只定義一次，再由 adapter 轉成 AI SDK 與 MCP 兩種格式。

```ts
// mcp-server/src/tools/types.ts
interface ToolContext {
  supabase: SupabaseClient;   // 以使用者 JWT 建立，RLS 生效
  userId: string;
  organizationId: string;     // 前端目前選擇的組織（§4.2）
  permissions: PermissionSet; // §4.2
  requestId: string;          // trace 用（§4.6）
}

interface ToolDefinition<I extends z.ZodTypeAny> {
  name: string;
  domain: 'customer' | 'order' | 'product' | 'purchase' | 'receiving'
        | 'inventory' | 'shipping' | 'factory' | 'shelf' | 'admin';
  description: string;        // 給模型看的說明（中文）
  input: I;
  kind: 'read' | 'write';     // write 走 §4.3 確認流程
  permission: PermissionKey;  // 例如 'canCreateOrders'
  execute(ctx: ToolContext, input: z.infer<I>): Promise<ToolResult>;
}
```

- 目錄：`mcp-server/src/tools/<domain>.ts`，每個檔案匯出該領域的 `ToolDefinition[]`
- Adapter：`toAiSdkTools(defs, ctx)`、`registerMcpTools(server, defs, ctx)`
- `ToolResult` 統一為 `{ ok: true, data, entities? } | { ok: false, error }`，作為內部契約（MCP、P0-5 確認流程使用）。**給模型看的格式不變**：AI adapter 成功時只回傳 data、失敗時回傳錯誤文字（原因見 §9 P0-2 的 F7）
- 遷移完成後刪除 `agent/tool-registry.ts` 中的重複實作

### 4.2 權限與組織

**權限來源改為資料庫。** 每個 tool 宣告一個 UI 已在使用的權限鍵（`canViewOrders`、`canCreateOrders`…），請求開始時：

1. 前端在 `/query` 請求中帶 `organization_id`（`/mcp` 用 `X-Organization-Id` header）
2. 後端確認使用者是該組織的有效成員（`user_organizations.is_active`）或組織擁有者，否則回 403
3. 對 tools 用到的每個權限鍵並行呼叫資料庫函式 `user_has_organization_permission()`——**RLS 用的是同一個函式**，後端不另寫判斷邏輯，避免 AI 與 UI／RLS 不一致
4. 擁有者權限來自 `organizations.owner_id`（資料庫函式的規則），不是 owner 角色上的 `canViewAll` 等鍵
5. 只把 `permission` 符合的 tools 交給模型

- `/mcp` 套用同一套過濾
- 已移除 `permissions.ts` 中寫死的 `ROLE_PERMISSIONS`，以及對 legacy 欄位 `profiles.role` 的依賴
- 所有寫入一律使用 `ctx.organizationId`，不再使用 `getUserOrgId`
- **所有讀取也一律以 `organization_id = ctx.organizationId` 篩選**（含 `get_*` 依 ID 查詢）。RLS 允許使用者讀取所屬的**每一個**組織，只靠 RLS 會讓多組織使用者看到混在一起的資料（F11）
- 寫入引用的客戶、工廠、產品、訂單必須屬於目前組織（`allInOrganization()`）
- Query 對話（`query_sessions`）依組織分開，切換組織時看到的是該組織的對話（F13）

> 注意：權限鍵目前只有 View/Create/Edit（產品另有 Delete）。若 Phase 1 需要更細的權限（例如「確認訂單」與「編輯訂單」分開），在對應流程中新增鍵，並同步更新 UI 的權限管理頁。

### 4.3 寫入安全：草稿＋確認

`kind: 'write'` 的 tool 在 agent loop 中**不寫入業務資料**，只建立草稿：

```
模型呼叫 create_order_draft(...)
  → 驗證輸入、查齊顯示用名稱
  → 寫入 query_pending_actions（status = pending）
  → 回傳草稿摘要給模型
前端顯示確認卡片（內容、確認、取消）
使用者按「確認」→ POST /query/actions/:id/confirm
  → 以 action id 作為 idempotency key 呼叫對應 RPC
  → status = confirmed，結果寫回 query_messages
```

新資料表（migration 待確認後才建立）：

| 欄位 | 說明 |
|------|------|
| `id` | uuid，同時作為 idempotency key |
| `session_id`、`user_id`、`organization_id` | 歸屬；RLS 以 `user_id` 隔離 |
| `tool`、`payload` (jsonb) | 確認時要執行的操作與參數 |
| `summary` (jsonb) | 卡片顯示用內容（名稱而非 ID） |
| `status` | `pending` / `confirmed` / `cancelled` / `expired` / `failed` |
| `result` (jsonb)、`error` | 執行結果 |
| `created_at`、`expires_at` | 草稿 15 分鐘後過期 |

好處：

- Agent loop 內沒有任何寫入，**模型降級重跑最多多產生一張草稿，不會重複寫入**，§2 問題 4 自然解決
- 確認時以 action id 去重，連點兩次確認也只執行一次
- 確認與執行不經過 LLM，結果可預期

### 4.4 對話記憶

**後端自行讀取 history。** 前端改為只送 `session_id`，後端以使用者 JWT 從 `query_messages` 讀取（RLS 保證只能讀自己的對話）。這樣可以避免 history 被竄改，也讓截斷策略集中在後端。

`query_messages` 新增欄位（migration 待確認）：

| 欄位 | 說明 |
|------|------|
| `kind` | `text` / `action`（確認卡片） |
| `metadata` (jsonb) | `action_id`、`entities`、`trace_id` 等 |

**實體記憶：** tool 回傳的 `entities`（`{ type, id, label }`，例如客戶「Client name test0922」）存入該輪 assistant 訊息的 `metadata.entities`。組 prompt 時，把最近出現的實體整理成一段系統附註，例如：

```
[對話中已確認的實體]
- 客戶：Client name test0922 (id: …)
- 工廠：Factory 092202 (id: …)
```

模型可以直接使用 ID，回覆給使用者的文字仍然不顯示 ID。

**長度上限：** 送給模型的 history 取最近 20 則（約 6–8k tokens 上限），加上實體附註。摘要機制不在 Phase 0 範圍，等 eval 顯示有需要再做。

**前端防重複送出：** `sendMessage` 在第一個 await 之前就鎖定送出狀態，避免連點或連按 Enter 送出兩次。

### 4.5 AI Gateway

- **降級規則**（P0-6 實作時依實測修正：原本「400 不降級」不成立，F4 證明 400 可能只發生在某個 provider）
  - 除下列情況外，任何失敗都換下一個模型：空白回覆（F8）、格式錯誤的工具呼叫、provider 錯誤、429、逾時、某 provider 不認得的模型 ID
  - 不降級：(1) **這次嘗試已經執行過寫入**——重跑會重複寫入，改回覆「操作已經執行…請確認結果」；(2) 401／403（所有模型共用同一把 key）；(3) 修復後仍呼叫不存在的工具（prompt／工具設計錯誤，換模型也一樣）；(4) 已超過請求期限
  - 全部失敗時回報主模型的錯誤
- **`default_api.` 前綴**：以 AI SDK 的 tool call repair 對應回原名稱，不再註冊含「.」的別名（F4）
- **逾時**：單次模型嘗試 30 秒，整個請求 90 秒；超過期限後不再開始新的嘗試
- **同模型重試**：關閉（`maxRetries: 0`）。換模型即是重試，同模型重試只會增加數秒的退避延遲
- **錯誤訊息**：記錄 provider 的 response body
- **Streaming**：不在 Phase 0 範圍

### 4.6 Trace

每個 `/query` 請求寫一筆 `query_traces`（migration 待確認），RLS 以 `organization_id` 隔離：

| 欄位 | 說明 |
|------|------|
| `id`、`session_id`、`user_id`、`organization_id` | 歸屬 |
| `model`、`fallback_from` | 實際使用的模型、是否降級 |
| `steps` (jsonb) | 每一步的 tool 名稱、參數摘要、耗時、成功與否 |
| `input_tokens`、`output_tokens`、`latency_ms` | 成本與效能 |
| `status`、`error` | 結果 |

保留 30 天：mcp-server 寫入新 trace 後，順手刪除該使用者超過 30 天的紀錄（RLS 只允許刪除自己的過期紀錄，不需 pg_cron）。`/query` 回應帶 `traceId`；P0-4 將它存入 assistant 訊息的 `metadata.trace_id`，使用者回報問題時可以直接查到。

### 4.7 Eval harness

把 2026-10-07 排查時用的「假資料層＋真模型重播」做成正式工具。

```
mcp-server/evals/
├── cases/*.json      ← 測試案例
├── fixtures/*.json   ← 假資料（客戶、工廠、產品…）
└── run.ts            ← 執行器：bun run eval
```

案例格式：

```json
{
  "name": "跨領域建單：客戶＋工廠＋產品",
  "fixtures": "order-basic",
  "history": [],
  "message": "新增一張 Client name test0922 客戶的訂單給 Factory 092202 工廠，雲朵眠 test0922 買藍0922",
  "permissions": "owner",
  "expect": {
    "tools_called": ["list_customers", "list_factories", "list_products"],
    "draft_created": "create_order_draft",
    "reply_not_matches": "[0-9a-f]{8}-[0-9a-f]{4}"
  }
}
```

- 資料層為假資料，不連 Supabase、不會寫入；模型為真實呼叫
- LLM 結果不固定，每個案例跑 N 次（預設 3），統計通過率
- 輸出指標：tool 選擇正確率、任務完成率、平均延遲、平均 token
- 初始案例約 15 個，來源為實際發生過的問題：跨領域建單、最新採購單、低庫存、找不到客戶、重複訊息的 history、無權限的角色等
- 完成後，把 `bun run eval` 加入 `CLAUDE.md` 的必跑測試（修改 `mcp-server/` 時）

**用 eval 決定 agent 拓撲（D6）：** 同一組案例分別跑「現行 Router＋兩個 sub-agent」與「單一 agent＋全部 tools」，比較四項指標後再決定。Phase 1 每完成一條流程重跑一次；tools 超過約 40 個或正確率明顯下降時，重新評估拆分或「依意圖動態載入 tools」。

## 5. 實作順序

每一步各自可以合併、可以驗證：

| 步驟 | 內容 | 驗證方式 |
|------|------|----------|
| P0-1 ✅ | Eval harness＋初始案例，對**現行架構**建立基準線 | `bun run eval` 產出基準報告 |
| P0-2 ✅ | Tool 單一來源＋adapters，17 個 tools 原樣遷移，刪除重複實作 | eval 不低於基準；`/mcp` 列出相同 tools |
| P0-3 ✅ | 權限改讀資料庫＋前端傳 `organization_id` | 各角色的 eval 案例；多組織帳號手動驗證 |
| P0-4 ✅ | 後端讀 history＋實體記憶＋前端防重複送出 | 多輪建單案例通過；`verify-query-ui.py` |
| P0-5 ✅ | 草稿＋確認流程（資料表、API、前端確認卡片） | 確認卡片 UI 驗證；重複確認只執行一次 |
| P0-6 ✅ | Gateway 錯誤分類與逾時＋trace | 模擬 429 和無效 tool 的案例 |
| P0-7 ✅ | 單一 agent 與 Router 的 eval 比較，依結果決定拓撲 | 比較報告 |

P0-1 放在最前面，是為了讓後面每一步都有數據可以比較，並在重構前保留現行架構的表現紀錄。

涉及 migration 的步驟（P0-4 的 `query_messages` 欄位、P0-5 的 `query_pending_actions`、P0-6 的 `query_traces`），會先提出 migration 內容，經確認後才套用。

## 6. 完成標準

- `/query` 與 `/mcp` 由同一份 tool 定義產生，且權限過濾一致
- 在 UI 修改角色權限後，AI 可用的 tools 立即跟著改變
- Agent loop 內沒有任何直接寫入業務資料的路徑
- 多輪對話中已確認的客戶、工廠、產品不需要重新查詢
- `bun run eval` 可執行，且有現行架構的基準報告
- Agent 拓撲已依 eval 結果做出決定，並記錄在本文件

## 7. 不在 Phase 0 範圍

- 新增任何業務領域的 tools 或 RPC（屬於 Phase 1）
- Streaming 回應
- 對話摘要與長期記憶（使用者偏好、常用客戶）
- 依意圖動態載入 tools

## 8. 確認紀錄

2026-10-07 確認：D3、D4、D5 同意；`/mcp` 無外部 client，先停用（D7）；三項 migration 同意建立（D8）。

## 9. 進度紀錄

### P0-1 Eval harness ✅（2026-10-07）

**產出**

- `mcp-server/evals/`：`run.ts`（執行器）、`fake-supabase.ts`（記憶體假資料層，套用真實的篩選條件並記錄所有寫入）、`fixtures/basic.json`、`cases/*.json`（18 個案例：查詢 9、寫入 4、權限 3、回歸 2）
- `mcp-server/src/agent/observer.ts`：`QueryObserver` 介面，串接 gateway、router、sub-agents，記錄路由決策、模型嘗試、每一步的 tool 呼叫與 token。未傳入時不影響行為，P0-6 的 trace 將建立在此介面上
- `bun run eval`；`CLAUDE.md` 已加入「不可退步」規則
- 同時完成 D7：`/mcp` 回傳 410 停用（舊的 `src/tools/*.ts` 檔案保留，P0-2 時再確認刪除）

**基準線（現行 Router＋兩個 sub-agent，每案 3 次）**：報告 `mcp-server/evals/reports/20261007T0443-baseline-router.md`

| 指標 | 數值 |
|------|------|
| 任務完成率 | 59% |
| Tool 選擇正確率 | 71% |
| 錯誤率 | 6% |
| 降級率 | 6% |
| 平均延遲 | 5.0 秒 |

**基準線發現的問題**（皆已確認為真實問題，非測試假象）

| # | 問題 | 案例 | 預計處理 |
|---|------|------|----------|
| F1 | Router 改寫 task 時丟失資訊：使用者回答「Client name test0922」，task 被改寫成「新增訂單, 客戶名稱:」 | `r-duplicate-history` | P0-7（單一 agent 不需改寫） |
| F2 | 產品搜尋把「名稱＋顏色」當成一個字串比對 `name` 或 `color`，永遠查不到（真實資料庫行為相同） | `q-inventory-search`、`w-create-po` | P0-2（搜尋改為分詞比對） |
| F3 | Prompt 指示呼叫角色沒有的 tool（業務角色的 supply_chain 沒有 `list_factories`），所有模型都失敗，正式環境會回 500 | `p-sales-cannot-create-po` | P0-3（prompt 依實際可用 tools 產生） |
| F4 | `default_api.` tool 別名含「.」，Anthropic 只接受 `[a-zA-Z0-9_-]`，**Haiku 降級在有 tools 的請求中從未成功過** | 所有降級情境 | P0-6（改用 tool call repair 去除前綴，不註冊別名） |
| F5 | 沒有建單權限的角色仍回覆「請問需要訂購什麼品項」，暗示可以建單 | `p-accounting-cannot-create-order` | P0-3（prompt 告知權限範圍） |
| F6 | 建單前先追問選填的備註，多一輪對話才建單 | `w-create-order`、`r-multi-turn-order` | P0-5（直接建立草稿，於確認卡片補充備註） |

### P0-2 Tool 單一來源 ✅（2026-10-07）

**產出**

- `mcp-server/src/tools/`：`types.ts`（`defineTool`、`ToolResult`、`PermissionKey`）、7 個領域檔案（取代舊的 MCP 版實作，內容以 AI 版為準，並保留 MCP 版才有的 `create_customer.fax`）、`index.ts`（registry，啟動時檢查 `TOOL_GROUPS` 每個 tool 都恰有一個定義）、`adapters.ts`（`toAiSdkTools`、`registerMcpTools`）、`search.ts`
- `agent/tool-registry.ts` 縮減為依權限與群組取用 registry 的薄層
- 每個 tool 已宣告 `permission`（資料庫權限鍵），P0-3 開始生效
- `mcp-server/tests/tools.test.ts`（`bun run test`，7 項）：AI 與 MCP adapter 暴露相同的 17 個 tools、MCP 唯讀標記、MCP 呼叫走共用實作、參數驗證在寫入前攔截、F2 分詞搜尋
- `/mcp` 維持停用，P0-3 加入權限過濾後再以 `registerMcpTools` 開放

**結果**：報告 `mcp-server/evals/reports/20261007T0516-p0-2-single-source-v3.md`，相對基準線無退步

| 指標 | 基準線 | P0-2 |
|------|--------|------|
| 任務完成率 | 59% | 75% |
| Tool 選擇正確率 | 71% | 82% |
| 錯誤率 | 6% | 2% |
| 平均延遲 | 5.0 秒 | 4.6 秒 |

改善的案例：`q-inventory-search`、`w-create-po`（F2 修正）、`p-sales-cannot-create-po`（2/3）。

**新發現**

| # | 問題 | 預計處理 |
|---|------|----------|
| F7 | gemini-2.5-flash-lite 對工具描述與工具結果格式極度敏感：在 4 個工具描述加上簡短說明、或把結果包成 `{ ok, data }`，就讓其他案例出現 MALFORMED_FUNCTION_CALL 或洩漏 UUID。已改回原始描述，並讓 AI adapter 拆開包裝 | 修改工具描述或 prompt 一律先跑 eval；P0-7 比較時一併評估主模型改用 gemini-2.5-flash |
| F8 | Gemini 回傳 `finish_reason: error`（MALFORMED_FUNCTION_CALL）時 AI SDK 不拋例外，回覆為空字串，**不會觸發降級**，使用者看到空白回覆 | P0-6（gateway 將此視為失敗並降級） |
| F9 | 同一設定下 3 次執行的輸出幾乎完全相同，3 次並非獨立樣本，通過率反映的是「這個設定是否可行」而非機率 | eval 報告解讀時注意；P0-7 比較時改用多組措辭相近的案例 |

### P0-3 權限與組織 ✅（2026-10-07）

**產出**

- `agent/auth-guard.ts`：確認組織成員資格，並以資料庫函式 `user_has_organization_permission()` 逐一檢查 tools 需要的權限鍵；`AccessError` 對應 400／401／403
- `agent/permissions.ts`：移除寫死的 `ROLE_PERMISSIONS` 與 `profiles.role` 依賴，只保留工具分組
- `ToolContext` 新增 `userId`、`organizationId`；建單、建客戶、建採購單一律寫入使用者選擇的組織
- `/query` 需帶 `organization_id`；`/mcp` 重新開放，以 `X-Organization-Id` header 指定組織，套用相同權限過濾
- 前端 `useQueryChat` 送出目前選擇的組織；未選擇組織時提示「請先選擇組織」
- 子 Agent prompt：帳號缺少群組內某些 tools 時，附加「權限限制」說明（F3、F5）。擁有完整權限的帳號 prompt 與先前完全相同（F7）
- 測試：`tests/auth-guard.test.ts`（8 項：各角色 tools、非成員／停用成員 403、缺少組織 400、寫入落在所選組織）；eval 改走真實的 `authGuard`，角色權限取自 `evals/fixtures/roles.json`（複製自資料庫系統角色）；`verify-query-ui.py` 新增「請求帶 organization_id」檢查

**結果**：報告 `mcp-server/evals/reports/20261007T0537-p0-3-db-permissions.md`，相對 P0-2 無退步

| 指標 | 基準線 | P0-2 | P0-3 |
|------|--------|------|------|
| 任務完成率 | 59% | 75% | 82% |
| Tool 選擇正確率 | 71% | 82% | 82% |
| 錯誤率 | 6% | 2% | 0% |

F3（`p-sales-cannot-create-po` 3/3）、F5（`p-accounting-cannot-create-order` 0/3 → 3/3）已解決。剩餘失敗為 F1（P0-7）與 F6（P0-5）。

正式環境驗證：未帶組織 400、非成員組織 403、所屬組織 200；`/mcp` 依權限列出 tools，未帶 header 回 400。

**新發現**

| # | 問題 | 建議 |
|---|------|------|
| F10 | `user_has_organization_permission`、`is_organization_owner`、`user_belongs_to_organization`、`get_user_organizations` 為 SECURITY DEFINER 且接受任意 `_user_id`，任何人（含未登入者）都能查詢**其他人**在任一組織的權限、擁有者身分與成員資格 | ✅ 已修正（下方「組織邊界強化」） |

**多組織帳號驗證（2026-10-07，`lovejoker369+test@gmail.com`：lo1 管理員、lo2 擁有者）**

| # | 問題 | 狀態 |
|---|------|------|
| F11 | 讀取 tools 沒有依組織篩選，只靠 RLS。多組織使用者在 lo2（0 位客戶）查詢客戶，得到 lo1 的 4 位客戶（`/query` 與 `/mcp` 皆是）。P0-3 之前就存在 | ✅ 已修正：所有讀取加上組織條件；寫入引用的資料須屬於目前組織 |
| F12 | `inventory_summary` 與 `inventory_summary_enhanced` 兩個 view 沒有 `security_invoker`，以擁有者身分執行而**繞過 RLS**：任何登入使用者都能讀到**所有組織**的庫存（實測可見「吉富」的庫存，AI 也曾在 lo1 的低庫存回覆中列出吉富的「1601鳥眼布」） | ✅ 已修正（下方「組織邊界強化」） |
| F13 | Query 對話清單沒有依組織篩選，切換組織後仍延續前一個組織的對話，前一個組織的內容會成為新組織請求的模型上下文 | ✅ 已修正：對話依組織分開，建立對話須有目前組織 |

**驗證**

- `tests/org-isolation.test.ts`（12 項）：fixtures 加入第二個組織，且其資料都是「最新」或「最低庫存」，漏掉篩選就會出現在結果中；涵蓋每個讀取 tool、`get_*` 依 ID 讀取他組織資料、寫入引用他組織資料。已用突變測試確認：移除 `list_customers` 的組織條件後測試會失敗
- eval 的假資料層改為依 `select` 欄位回傳（與真實資料庫一致）。先前回傳整列，曾因多出欄位改變模型行為（F7）
- eval：報告 `mcp-server/evals/reports/20261007T0632-p0-3-org-isolation-v2.md`，相對 P0-3 無退步，任務完成率 82%，0 筆跨組織資料出現在回覆中
- 正式環境：lo1 客戶 4／工廠 5／產品 8／庫存 5（不再含吉富）；lo2 全部為 0，查詢客戶回覆「找不到任何客戶」
- 瀏覽器實測：在 lo1 送出 → 經切換選單切到 lo2 → 送出，兩次請求分別帶 lo1、lo2；對話分別寫入各自組織

### 組織邊界強化 ✅（2026-10-07）

目標：組織的資料與成員資訊不跨越組織邊界，包含 AI Query 與庫存。Migration：`supabase/migrations/20261007130000_org_boundary_hardening.sql`（已套用至正式資料庫）。

**資料庫**

| 項目 | 修正 |
|------|------|
| 兩個庫存 view | 改為 `security_invoker = true`（套用查詢者的 RLS），並在最後加上 `organization_id` 供前端篩選 |
| 權限／成員判斷函式 | 新增 `can_inspect_organization()`：只回答「關於自己」或「關於自己所屬組織」的問題。所有 RLS policy 傳入的都是 `auth.uid()`，唯一查詢他人的 `transfer_organization_ownership` 呼叫時已驗證為擁有者，皆不受影響 |
| `create_default_organization_roles` | 原本任何人（含未登入）都能在任意組織插入角色；改為只供建立組織的 trigger 使用 |
| 未登入者 | 撤銷 `complete_user_invitation`、`transfer_organization_ownership`、`get_user_organizations`、`ensure_user_profile` 的執行權限（這些函式不被 RLS policy 使用） |

**前端**：`useInventoryAlerts`、`CreatePurchaseDialog` 讀取 `inventory_summary` 時加上組織條件（先前沒有任何篩選，且 view 繞過 RLS）。其餘 15 個未明確帶組織條件的查詢已逐一檢查：皆以上層紀錄（客戶、產品、訂單、貨架或剛建立的紀錄）的 ID 查詢，不會跨組織。

**AI tools**：庫存 tools 改用 view 的 `organization_id` 篩選，與其他 tools 一致。

**驗證**（以 `lovejoker369+test@gmail.com` 執行，套用前後比對）

| 項目 | 套用前 | 套用後 |
|------|--------|--------|
| 13 張資料表可見筆數 | — | 完全相同（一般存取不受影響） |
| `inventory_summary` 可見筆數 | 33（所有組織） | 8（= 可見的產品數） |
| `inventory_summary_enhanced` 可見筆數 | 6（含吉富 1 筆） | 5 |
| 查詢吉富擁有者的擁有者身分／成員資格／權限 | true | false |
| 列出吉富擁有者的組織 | 1 | 0 |
| 查詢自己組織內的擁有者、成員、權限 | true | true |
| 未登入呼叫 `create_default_organization_roles` | 409（可執行） | 401 |

- 建立組織：以登入使用者身分於交易中建立組織後回滾，trigger 正常建立 6 個預設角色，建立者為成員並具權限；未留下測試資料
- Supabase security advisor：ERROR 等級的 `security_definer_view` 已清除
- 瀏覽器：庫存頁在 lo1 收到的所有 view 資料列皆屬於 lo1（0 筆外部產品）；在 lo2 為 0 筆
- AI：lo1 低庫存回覆不再包含吉富的產品；lo2 回覆「目前所有產品庫存充足」
- 前端測試 24/24、`bun run test` 27/27、`verify-query-ui.py` 16/16；eval 無退步（`20261007T0651-org-boundary-hardening.md`），0 筆跨組織資料

**後續**

| # | 問題 | 建議 |
|---|------|------|
| F14 | 訂單、出貨、捲號、採購單號為**全域唯一**，但各組織產生下一個號碼時只看得到自己組織的號碼：兩個組織同一天可能產生相同號碼而寫入失敗 | 改為「組織內唯一」（`UNIQUE (organization_id, order_number)`）並由 RPC 產生號碼；屬 Phase 1 訂單主流程 |
| F8 | MALFORMED_FUNCTION_CALL 造成空白回覆的頻率上升（本次 eval 3 個案例各有 1 次） | 建議 P0-6 提前到 P0-4 之前 |
| — | 同一資料庫有其他人同時變更（例如 `add_delete_organization_rpc`），本機 `supabase/config.toml` 的 `project_id` 與實際使用的專案不同 | 確認 config 並協調 migration 流程 |

### P0-6 Gateway 錯誤處理與 Trace ✅（2026-10-07）

**產出**

- `agent/ai-gateway.ts`：依 §4.5 規則降級；空白回覆視為失敗（F8）；tool call repair 取代 `default_api.` 別名（F4）；單次 30 秒、整體 90 秒逾時；可注入模型清單供測試
- 寫入保護：工具執行寫入後通知子 Agent，此後的失敗不再換模型重跑，改回覆「操作已經執行…不要重複送出」
- `agent/trace.ts` 與 migration `20261007140000_add_query_traces.sql`：每個 `/query` 請求寫一筆 trace（路由、每次模型嘗試與耗時、工具呼叫、token、延遲、錯誤），連結對話；RLS：只能為自己在所屬組織寫入；本人可讀自己的紀錄，具 `canViewSystemSettings` 的成員可讀組織內全部
- `/query` 回應新增 `traceId`；前端送出 `session_id`
- `QueryObserver` 的模型嘗試帶 phase（`router`／`agent:<group>`）與耗時；router、子 Agent、gateway 改以 `QueryRun` 傳遞 observer 與期限

**驗證**

- `tests/ai-gateway.test.ts`（10 項，mock 模型、不連網路）：空白回覆降級、5xx 降級、401 不降級、全部失敗回報主模型錯誤、逾時中止、期限已過不呼叫、`default_api.` 修復、**已寫入不重跑（只產生一張訂單）**、寫入前失敗正常降級。寫入保護已做突變測試：關閉保護後測試會失敗
- 真實模型：Haiku 單獨使用工具可正常回答（先前因 F4 一律 400）；主模型故意設為無效 ID 時，降級到 Haiku 並完成工具流程
- 正式環境：`/query` 回傳 `traceId`，trace 內容完整且連結對話；以他人身分或在非所屬組織寫入 trace 皆被拒（403），看不到所屬組織以外的 trace
- `bun run test` 37/37、前端測試 24/24、`verify-query-ui.py` 16/16
- eval：報告 `20261007T0709-p0-6-gateway.md`，無退步；上次 2/3 的三個案例回到 3/3，0 筆空白回覆

F4、F8 已解決。`src/integrations/supabase/types.ts` 尚未包含 `query_traces`（前端目前沒有使用；下次完整重新產生型別時會加入）。

### P0-4 對話記憶 ✅（2026-10-07）

**產出**

- Migration `20261007150000_query_messages_kind_metadata.sql`：`query_messages` 新增 `kind`（`text`／`action`，後者供 P0-5）與 `metadata`
- `agent/memory.ts`：
  - 後端以使用者 JWT 讀取對話（目前訊息之前最近 20 則）；前端只送 `session_id` 與剛存入的 `message_id`，不再送 history。對話須屬於目前組織，否則不讀取也不寫回
  - 實體記憶：工具查到 1–3 筆特定紀錄（客戶、工廠、產品、訂單、採購單、出貨單）時記為實體，存在 assistant 回覆的 `metadata.entities`；下一輪在子 Agent 的 system prompt 列出最近 10 個實體與 ID。沒有實體時 prompt 與先前完全相同（F7）
- 後端自行儲存 assistant 回覆（含 `metadata.trace_id`、`metadata.entities`），回應帶 `messageId`；儲存失敗時為 `null`，由前端補存
- 前端 `sendMessage`：以 ref 在第一個 await 之前鎖定送出，修正連按兩次 Enter 重複送出；不再送 history
- 無 `session_id` 的呼叫者（例如 API 測試）仍可用請求中的 `history`，不會寫回

**驗證**

- `tests/memory.test.ts`（8 項）：實體擷取規則（≤ 3 筆、標籤、錯誤不計）、歷史實體合併與上限、`loadHistory` 只取目前訊息之前；以 mock 模型完整走 `handleQuery`：history 來自資料庫、請求中偽造的 history 被忽略、實體出現在 system prompt、模型直接以記住的 ID 建單、回覆連同 trace_id 存回；他組織的對話不讀取也不寫回
- eval 新增 `r-entity-memory`（3/3）：上一輪找到「永泰布行」，本輪「幫他建立一張訂單」直接以記住的 ID 建單。**對照組（移除實體）每次都會先重新呼叫 `list_customers`**，證明記憶確實省下一輪查詢
- eval：報告 `20261007T0719-p0-4-memory.md`，無退步，任務完成率 83%，0 筆空白回覆、0 筆 UUID 洩漏（即使 prompt 中有 ID）
- 瀏覽器實測（真實後端）：「查詢 Client name test0922 這位客戶」→「他有幾張訂單？」第二輪 trace 顯示直接以記住的 customer_id 呼叫 `list_orders`；連按兩次 Enter 只存一則訊息；所有回覆由後端儲存且帶 trace_id，沒有重複
- `bun run test` 45/45、前端測試 24/24、`verify-query-ui.py` 17/17（新增「請求帶 session_id＋message_id、不帶 history」）

**仍未解決**：`r-duplicate-history`（F1，Router 改寫 task 遺失資訊，P0-7）、`w-create-order`／`r-multi-turn-order`（F6，建單前追問備註，P0-5）。

### P0-5 草稿＋確認 ✅（2026-10-07）

**產出**

- Migration `20261007160000_add_query_pending_actions.sql`：狀態 `pending → executing → confirmed／failed`、`cancelled`、`expired`（15 分鐘）；RLS：只能為自己在所屬組織建立、只能讀自己的、只能推進自己尚未完成的
- 工具層：每個寫入工具必須提供 `summarize()`（驗證輸入、確認引用的紀錄屬於目前組織、以名稱而非 ID 產生卡片內容），registry 啟動時檢查。**AI 流程中寫入工具只產生草稿**：`toAiSdkTools` 的 `onDraft` 為必填，沒有任何直接寫入業務資料的路徑
- 失敗的模型嘗試所產生的草稿會被丟棄，降級重跑不會留下重複卡片；P0-6 的「寫入後不降級」因此不再需要，已移除
- `agent/actions.ts` 與 `POST /query/actions/:id/confirm|cancel`：確認時重新檢查成員資格與工具權限 → 原子地搶下 `pending → executing` → 執行與先前相同的工具實作 → 記錄結果並在對話中貼出結果訊息；重複確認回傳同一結果；取消也會貼出結果訊息
- 前端：`ActionCard`（標題、欄位、狀態、確認／取消）、`useQueryAction`、`src/lib/queryApi.ts`；`QueryChat` 將 `kind = 'action'` 的訊息顯示為卡片
- Prompt（F6）：寫入只產生草稿，選填欄位不先詢問；建立草稿後請使用者在卡片確認
- **輸出防護** `agent/output-guard.ts`：回覆一律移除 UUID。加入草稿規則後主模型開始在回覆中列出工廠 ID（F7），prompt 規則不可靠，改為確定性處理

**實測發現的問題與修正**

- **模型聲稱已建立草稿但沒有呼叫工具**（瀏覽器實測：確認第一張卡片後再要求新增客戶，模型照抄上一輪的文字「已建立…草稿，請在下方的確認卡片…」，實際上沒有任何草稿）。原因：對話紀錄沒有工具呼叫，模型模仿自己先前的回覆。比較四種呈現方式後，只有「省略介紹草稿的回覆、只保留卡片結果」能讓主模型穩定呼叫工具（3/3）。修正：
  1. `toModelHistory`：介紹草稿的回覆（`metadata.action_ids`）與卡片不給模型看；卡片結果（確認、取消、失敗）以附註呈現；連續同角色訊息合併
  2. **確定性防護**：回覆提到確認卡片或已建立草稿、但這次嘗試沒有建立任何草稿時，視為無效回覆並降級（`GatewayCall.validate`）。最終 eval 中攔下 4 次，皆由降級後的模型完成
  3. 模型建立草稿後回覆空白時，改用標準回覆而非失敗（`emptyReply`）
- eval 新增 `r-after-confirmation`（重現此事故）：修正前 3/3 聲稱草稿但沒有建立；修正後 3/3 確實建立草稿

**驗證**

- `bun run test` 62/62：`tests/actions.test.ts`（9 項：確認只執行一次並貼出結果、重複確認不重寫、**同時兩次確認只寫一次**、過期、取消、已完成不可取消、權限被移除時拒絕且保持 pending、執行失敗記錄為 failed、他人的操作 404）；原子搶占已做突變測試（移除 `status = 'pending'` 條件後同時確認測試失敗）；gateway／記憶測試更新為草稿行為，並新增假草稿攔截、空白回覆替代
- eval：報告 `20261007T0743-p0-5-drafts-final.md`，相對 P0-4 無退步，任務完成率 89%；新增預設檢查「AI 流程不寫入任何業務資料」，60 次執行 0 筆寫入；0 筆空白回覆、0 筆 UUID 洩漏
- 瀏覽器實測（真實後端，lo2）：卡片顯示「待確認」時資料庫沒有新客戶；按「確認」後建立並顯示「已完成」與結果訊息；緊接著的下一個新增要求確實產生卡片，按「取消」後未建立
- 正式環境：重複確認回傳同一結果且只有一筆客戶；取消已完成的操作、確認已取消的操作皆回 409
- 前端測試 24/24、`verify-query-ui.py` 17/17

F6 已解決（`w-create-order` 0/3 → 3/3）。測試在 lo2 建立了兩筆客戶「P0-5 測試客戶」「P0-5 測試客戶二」。

**仍未解決**：`r-duplicate-history`（F1，P0-7）；`r-multi-turn-order`：找到客戶後仍以文字詢問「是否要為這位客戶建立訂單」才建立草稿（嘗試在 prompt 加入「不要再用文字詢問是否確定」無效，已撤回）。

### P0-7 架構比較 ✅（2026-10-07）

完整內容見 [QUERY_AGENT_ARCHITECTURE_EVAL.md](./QUERY_AGENT_ARCHITECTURE_EVAL.md)。

- 新增單一 Agent 實作（`runSingleAgent`、`agent/answer.ts`），以 `QUERY_AGENT_MODE` 切換，預設 `router`；子 Agent 核心改為共用的 `runAgent`，Router 架構的 prompt 與先前逐字相同
- eval runner 新增 `--arch`、`--primary`；新增 9 個改寫案例（`evals/cases/paraphrase.json`）
- 比較 4 種設定（Router／單一 Agent × flash-lite／flash），依使用者標準（最便宜、準確率 > 85%、延遲 10 秒內）**維持 Router × flash-lite**
- `bun run test` 64/64（新增 `tests/single-agent.test.ts`）；Router 路徑相對 P0-5 無退步

**新發現**

| # | 問題 | 建議 |
|---|------|------|
| F15 | 中文產品搜尋只依空白分詞：「棉麻平織米白」（名稱＋顏色，無空白）找不到產品，四種設定皆失敗 | 搜尋加入無空白的名稱＋顏色比對 |
| F16 | flash-lite 在部分問題（例如「最新的採購單」）決定呼叫工具的第一步固定等待 12–25 秒，約 10% 的請求超過 10 秒 | 以 `query_traces` 監控正式環境延遲；必要時改用 flash |

**Phase 0 完成。**
