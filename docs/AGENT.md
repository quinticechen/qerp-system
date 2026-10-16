# AI 查詢助理（Query Agent）

> 現況文件（2026-10-16），由 **AI Session** 維護（[SESSION_COORDINATION.md](./SESSION_COORDINATION.md) §1）。本文件是摘要；設計與規劃見 [QUERY_AGENT_PHASE0.md](./requirements/QUERY_AGENT_PHASE0.md)、[QUERY_AGENT_PHASE1.md](./requirements/QUERY_AGENT_PHASE1.md)、[QUERY_AGENT_ARCHITECTURE_EVAL.md](./requirements/QUERY_AGENT_ARCHITECTURE_EVAL.md)、[QUERY_AGENT_TPM_ALIGNMENT.md](./requirements/QUERY_AGENT_TPM_ALIGNMENT.md)。

## 1. 架構

```
前端 Query 按鈕（src/components/query/）
   │ POST /query（Supabase JWT、organization_id）
   ▼
mcp-server（Cloud Run）
   ├─ auth-guard：確認使用者有效屬於該組織，依 user_has_organization_permission() 決定可用的 tools
   ├─ input-guard：每位使用者每分鐘最多 6 次（「讓 Query 休息一下」）；攻擊性輸入不交給模型，回覆「Query 不能進行這個操作」
   ├─ router：判斷意圖，分派給一個或多個子 Agent
   │    ├─ commercial（📋 客戶與訂單）
   │    ├─ supply_chain（🏭 採購與入庫）
   │    ├─ warehouse（📦 庫存與出貨）
   │    ├─ catalog（🧵 產品）
   │    └─ facilities（🗄️ 工廠與貨架）
   ├─ tools：以使用者的 JWT 查詢 Supabase，一律限定目前組織
   ├─ 寫入類 tools：只建立待確認的動作（query_pending_actions），使用者確認後才執行
   ├─ 閘道：模型失敗時依序降級；模型呼叫了沒有的工具時，回覆「沒有權限」或「Query 現在還沒有這個功能」（TPM §3.4），不讓請求失敗
   ├─ 失敗時：Agent 出錯不回 500，回覆友善的中文提示，錯誤記在 trace（TPM §3.4）
   ├─ trace：每次回覆的模型、工具呼叫、耗時寫入 query_traces
   └─ Langfuse：同一個請求的 trace（去個資、抽樣，見下方）
```

模型經 OpenRouter 呼叫，依序降級（[SERVICES.md](./SERVICES.md)）。Router 與子 Agent 的 system prompt 以 Langfuse SDK 讀取 Prompt Management 的 `production` 標籤（快取 60 秒），讀不到時用程式內建的版本；上線流程見 [requirements/QUERY_AGENT_EVAL_REDESIGN.md](./requirements/QUERY_AGENT_EVAL_REDESIGN.md) §5.2。

**Langfuse tracing**（`mcp-server/src/agent/langfuse.ts`，[QUERY_AGENT_LANGFUSE.md](./requirements/QUERY_AGENT_LANGFUSE.md)）：每次 `/query` 是一個 trace（使用者、Query 對話為 session、節點為 tag），trace id 由 `query_traces.id` 決定；每次模型呼叫由 AI SDK 的 telemetry 記錄為 generation，並連到產生它的 prompt 版本。正式環境的內容先去個資：電話、Email 換成 `[電話]`、`[Email]`，工具結果中的 `contact_person`、`address` 換成 `[聯絡人]`、`[地址]`，同一個請求中這些值出現在回覆裡也一併替換。抽樣：出錯或降級的請求都送出，其餘依 trace id 送 5%（`LANGFUSE_SAMPLE_RATE` 可調整）。沒有設定 Langfuse 時不啟動，不影響回覆。

**讚／倒讚**：每則回覆下方的圖示按鈕（`MessageFeedback`），`POST /query/messages/:id/feedback` 存到 `query_messages.metadata.feedback`，並以 `user-feedback` 分數寫到該回覆的 trace。倒讚的回覆若沒有被抽樣送出，後端以 `query_traces` 與對話內容重建該 trace（同樣去個資，並遮蔽組織內所有客戶、工廠的聯絡人與地址；沒有模型的輸入輸出）。

## 2. Tools

共 44 個，Phase 1 業務 API（[API.md](./API.md) §3）全部包成工具（2026-10-15）。分組在 `mcp-server/src/agent/permissions.ts`：每個子 Agent 約 8–12 個工具，流程需要的查詢（例如取得 product_id 的 `list_products`）在需要的組重複放。

查詢類直接查資料表或 view，一律篩選目前組織；名稱與顏色連在一起的搜尋（例如「雲朵眠藍」）在欄位搜尋找不到時，改以「名稱＋顏色」比對（F15）。寫入類都呼叫同名的業務 API：草稿以 `p_dry_run = true` 產生確認卡片，使用者確認後以同樣參數、`p_dry_run = false` 寫入（`mcp-server/src/tools/api.ts`）。唯一不同名的是 `update_order_status` → `update_order`（只改狀態、付款狀態；出貨狀態由出貨單計算）。修改單據品項的工具（`update_order`、`update_purchase_order`、`update_shipping`）讀出目前的品項，合併模型給的修改後送出完整清單。

| 子 Agent | 查詢 | 寫入（需確認） |
|----------|------|----------------|
| commercial 客戶與訂單 | `list_customers`、`get_customer`、`list_orders`、`get_order`、`list_products` | `create_customer`、`update_customer`、`set_customer_active`、`create_order`、`update_order_status`、`update_order`、`cancel_order` |
| supply_chain 採購與入庫 | `list_purchase_orders`、`get_purchase_order`、`list_receivings`、`list_factories`、`list_products`、`list_shelves`、`list_orders` | `create_purchase_order`、`update_purchase_order`、`cancel_purchase_order`、`receive_inventory`、`update_inventory` |
| warehouse 庫存與出貨 | `get_inventory_summary`、`get_low_stock_alerts`、`list_inventory_rolls`、`list_shippings`、`get_shipping`、`list_orders`、`list_products`、`list_shelves` | `update_inventory_roll`、`create_shipping`、`update_shipping`、`cancel_shipping` |
| catalog 產品 | `list_products`、`get_product` | `create_product`、`update_product`、`set_product_active`、`add_product_color`、`update_product_color`、`set_product_color_active` |
| facilities 工廠與貨架 | `list_factories`、`list_shelves` | `create_factory`、`update_factory`、`set_factory_active`、`create_shelf`、`update_shelf`、`set_shelf_active` |

管理功能（用戶、權限、系統設定）不提供工具（Phase 0 D3）。

### 已知問題

最近一次 eval（`20261016T0455-sdk-baseline`，102 個案例，Langfuse prompt `production` v1）：整體任務完成率 85%（95% 信賴區間 77%–91%），規則 99%（3 次回覆超過 30 秒）、寫入類案例 80%，這兩項與整體完成率的門檻未通過；沒有權限類 100%、平均延遲 5.4 秒通過。

與 2026-10-14 的 91%（`20261014T1630-phase1-agent-fixes`）相比，prompt 與案例相同，只有工具定義與假資料不同：退步 11 個、修好 3 個。主要原因：

1. **追問選填欄位**：`create_product`、`add_product_color` 新增了選填的色號、安全庫存後，模型改為先問「安全庫存要設定多少」「色號是什麼」而不建立草稿，違反「只追問必填欄位」（E6）
2. **貨架名稱**：「A區-01」被拆成名稱「01」、位置「A區」（`create_shelf`）；入庫訊息已寫「放 A區-01」，仍反問要放哪個貨架（`receive_inventory` 的每卷必填 `warehouse_id`）
3. 一句話被分派給多個子 Agent 時，其他子 Agent 回覆「無法處理」或產生多餘的內容（跨流程採購、入庫）

其餘仍未通過：批次作廢直接建立取消草稿；跨流程建單缺單價仍建立草稿；「永泰訂單改 100」沒有條列訂單供選擇。

LLM 評分（只記錄）尚未以人工標註校準（[QUERY_AGENT_EVALS.md](./QUERY_AGENT_EVALS.md) §3.2）。

## 3. 資料

`query_sessions`（對話）、`query_messages`（訊息；`metadata.feedback` 為讚／倒讚，以 `set_query_message_feedback()` 寫入）、`query_pending_actions`（待確認的寫入）、`query_traces`（除錯紀錄，只有本人可看）。
