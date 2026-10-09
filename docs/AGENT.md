# AI 查詢助理（Query Agent）

> 現況文件（2026-10-09），由 **AI Session** 維護（[SESSION_COORDINATION.md](./SESSION_COORDINATION.md) §1）。本文件是摘要；設計與規劃見 [QUERY_AGENT_PHASE0.md](./QUERY_AGENT_PHASE0.md)、[QUERY_AGENT_PHASE1.md](./QUERY_AGENT_PHASE1.md)、[QUERY_AGENT_ARCHITECTURE_EVAL.md](./QUERY_AGENT_ARCHITECTURE_EVAL.md)、[QUERY_AGENT_TPM_ALIGNMENT.md](./QUERY_AGENT_TPM_ALIGNMENT.md)。

## 1. 架構

```
前端 Query 按鈕（src/components/query/）
   │ POST /query（Supabase JWT、organization_id）
   ▼
mcp-server（Cloud Run）
   ├─ auth-guard：確認使用者有效屬於該組織，依 user_has_organization_permission() 決定可用的 tools
   ├─ router：判斷意圖，分派給子 Agent
   │    ├─ commercial：客戶、訂單、產品
   │    └─ supply_chain：庫存、採購、出貨、工廠
   ├─ tools：以使用者的 JWT 查詢 Supabase，一律限定目前組織
   ├─ 寫入類 tools：只建立待確認的動作（query_pending_actions），使用者確認後才執行
   └─ trace：每次回覆的模型、工具呼叫、耗時寫入 query_traces
```

模型經 OpenRouter 呼叫，依序降級（[SERVICES.md](./SERVICES.md)）。

## 2. Tools

| 範圍 | 查詢 | 寫入（需確認） |
|------|------|----------------|
| 客戶 | `list_customers`、`get_customer` | `create_customer` |
| 工廠 | `list_factories` | — |
| 產品 | `list_products`、`get_product` | — |
| 庫存 | `get_inventory_summary`、`get_low_stock_alerts` | — |
| 訂單 | `list_orders`、`get_order` | `create_order`、`update_order_status` |
| 採購 | `list_purchase_orders`、`get_purchase_order` | `create_purchase_order` |
| 出貨 | `list_shippings`、`get_shipping` | — |

Phase 1 的規劃是把業務 API（[API.md](./API.md) §3）包成 tools，以 `p_dry_run` 產生確認卡片（[QUERY_AGENT_PHASE1.md](./QUERY_AGENT_PHASE1.md) §2–3）。目前寫入類 tools 仍有幾個直接寫表。

## 3. 資料

`query_sessions`（對話）、`query_messages`（訊息）、`query_pending_actions`（待確認的寫入）、`query_traces`（除錯紀錄，只有本人可看）。
