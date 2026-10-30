# AI Query Assistant (Query Agent)

> Current-state document (2026-10-16), maintained by the **AI Session** ([SESSION_COORDINATION.md](./SESSION_COORDINATION.md) §1). This document is a summary; for design and planning see [QUERY_AGENT_PHASE0.md](./requirements/QUERY_AGENT_PHASE0.md), [QUERY_AGENT_PHASE1.md](./requirements/QUERY_AGENT_PHASE1.md), [QUERY_AGENT_ARCHITECTURE_EVAL.md](./requirements/QUERY_AGENT_ARCHITECTURE_EVAL.md), [QUERY_AGENT_TPM_ALIGNMENT.md](./requirements/QUERY_AGENT_TPM_ALIGNMENT.md).

## 1. Architecture

```
Frontend Query button (src/components/query/)
   │ POST /query (Supabase JWT, organization_id)
   ▼
mcp-server (Cloud Run)
   ├─ auth-guard: confirms the user is an active member of the organization; user_has_organization_permission() decides which tools are available
   ├─ input-guard: at most 6 requests per user per minute ("讓 Query 休息一下", let Query take a break); abusive input never reaches the model, reply "Query 不能進行這個操作" (Query can't do this)
   ├─ router: detects intent and dispatches to one or more sub-agents
   │    ├─ commercial (📋 customers and orders)
   │    ├─ supply_chain (🏭 purchasing and receiving)
   │    ├─ warehouse (📦 inventory and shipping)
   │    ├─ catalog (🧵 products)
   │    └─ facilities (🗄️ factories and shelves)
   ├─ tools: query Supabase with the user's JWT, always limited to the current organization
   ├─ write tools: only create pending actions (query_pending_actions), which run after the user confirms
   ├─ gateway: falls back through models in order when one fails (an attempt is limited to 30 seconds, 8 for the router; 90 seconds for the whole request); when a model calls a tool it doesn't have, replies "沒有權限" (no permission) or "Query 現在還沒有這個功能" (Query can't do this yet) (TPM §3.4) instead of failing the request
   ├─ on failure: an Agent error never returns 500; it replies with a friendly Chinese message and records the error in the trace (TPM §3.4)
   ├─ trace: each reply's models, tool calls and latency are written to query_traces
   └─ Langfuse: a trace of the same request (PII removed, sampled; see below)
```

Models are called through OpenRouter and fall back in order ([SERVICES.md](./SERVICES.md)). The router and sub-agent system prompts are read from the `production` label in Prompt Management through the Langfuse SDK (cached for 60 seconds), falling back to the in-code version when they can't be read; for the release process see [requirements/QUERY_AGENT_EVAL_REDESIGN.md](./requirements/QUERY_AGENT_EVAL_REDESIGN.md) §5.2.

**Langfuse tracing** (`mcp-server/src/agent/langfuse.ts`, [QUERY_AGENT_LANGFUSE.md](./requirements/QUERY_AGENT_LANGFUSE.md)): each `/query` is one trace (user; the Query conversation as the session; nodes as tags), and the trace id is derived from `query_traces.id`. Each node is one observation (`router` and `summary` as chains, each sub-agent `agent:<group>` as an agent; `ai-gateway.ts`), so Langfuse draws router → sub-agents → summary; inside it, each model attempt is named after its model and each call is recorded as a generation by the AI SDK's telemetry, linked to the prompt version that produced it. Production content is de-identified first: phone numbers and emails become `[電話]` and `[Email]`, `contact_person` and `address` in tool results become `[聯絡人]` and `[地址]`, and the same values are also replaced wherever they appear in replies within the same request. Sampling: every failed or degraded request is sent, and 5% of the rest by trace id (adjustable with `LANGFUSE_SAMPLE_RATE`). Without Langfuse configured, it doesn't start and replies are unaffected.

**Thumbs up / down**: icon buttons under each reply (`MessageFeedback`); `POST /query/messages/:id/feedback` stores it in `query_messages.metadata.feedback` and writes a `user-feedback` score to that reply's trace. If a thumbs-down reply was not sampled, the backend rebuilds its trace from `query_traces` and the conversation (also de-identified, masking the contact persons and addresses of every customer and factory in the organization; no model inputs or outputs).

## 2. Tools

44 in total; all Phase 1 business APIs ([API.md](./API.md) §3) are wrapped as tools (2026-10-15). Grouping is in `mcp-server/src/agent/permissions.ts`: each sub-agent has about 8–12 tools, and lookups a flow needs (such as `list_products` to get a product_id) are repeated in the groups that need them.

Read tools query tables or views directly, always filtered to the current organization; when a search that joins name and color (such as 「雲朵眠藍」) finds nothing by field, it falls back to matching "name + color" (F15). Write tools all call the business API of the same name: the draft calls it with `p_dry_run = true` to produce the confirmation card, and after the user confirms it writes with the same parameters and `p_dry_run = false` (`mcp-server/src/tools/api.ts`). The only one with a different name is `update_order_status` → `update_order` (status and payment status only; shipping status is computed from shippings). Tools that change a document's line items (`update_order`, `update_purchase_order`, `update_shipping`) read the current lines, merge the model's changes, and send the complete list.

| Sub-agent | Read | Write (needs confirmation) |
|-----------|------|----------------------------|
| commercial: customers and orders | `list_customers`, `get_customer`, `list_orders`, `get_order`, `list_products` | `create_customer`, `update_customer`, `set_customer_active`, `create_order`, `update_order_status`, `update_order`, `cancel_order` |
| supply_chain: purchasing and receiving | `list_purchase_orders`, `get_purchase_order`, `list_receivings`, `list_factories`, `list_products`, `list_shelves`, `list_orders` | `create_purchase_order`, `update_purchase_order`, `cancel_purchase_order`, `receive_inventory`, `update_inventory` |
| warehouse: inventory and shipping | `get_inventory_summary`, `get_low_stock_alerts`, `list_inventory_rolls`, `list_shippings`, `get_shipping`, `list_orders`, `list_products`, `list_shelves` | `update_inventory_roll`, `create_shipping`, `update_shipping`, `cancel_shipping` |
| catalog: products | `list_products`, `get_product` | `create_product`, `update_product`, `set_product_active`, `add_product_color`, `update_product_color`, `set_product_color_active` |
| facilities: factories and shelves | `list_factories`, `list_shelves` | `create_factory`, `update_factory`, `set_factory_active`, `create_shelf`, `update_shelf`, `set_shelf_active` |

Admin features (users, permissions, system settings) have no tools (Phase 0 D3).

### Known issues

Latest eval (`20261016T0455-sdk-baseline`, 102 cases, Langfuse prompt `production` v1): overall task completion 85% (95% confidence interval 77%–91%), rules 99% (3 replies took over 30 seconds), write cases 80% — these two and the overall completion threshold did not pass; no-permission cases 100% and average latency 5.4 seconds passed.

Compared with 91% on 2026-10-14 (`20261014T1630-phase1-agent-fixes`), the prompts and cases were the same and only the tool definitions and fake data differed: 11 regressed, 3 were fixed. Main causes:

1. **Asking about optional fields**: after `create_product` and `add_product_color` gained the optional color code and safety stock, the model started asking "what safety stock?" and "what color code?" instead of creating the draft, violating "only ask about required fields" (E6)
2. **Shelf names**: 「A區-01」 was split into name 「01」 and location 「A區」 (`create_shelf`); even when the receiving message said 「放 A區-01」 (put it on A區-01), the model still asked which shelf to use (`receive_inventory` requires `warehouse_id` on every roll)
3. When one sentence is dispatched to several sub-agents, the other sub-agents reply "can't handle this" or produce extra content (cross-flow purchasing, receiving)

Still failing: batch voiding creates cancel drafts directly; cross-flow order creation still creates a draft when the unit price is missing; 「永泰訂單改 100」 (change Yongtai's order to 100) doesn't list the orders to choose from.

LLM scoring (recorded only) has not yet been calibrated against human labels ([QUERY_AGENT_EVALS.md](./QUERY_AGENT_EVALS.md) §3.2).

## 3. Data

`query_sessions` (conversations), `query_messages` (messages; `metadata.feedback` holds thumbs up/down, written by `set_query_message_feedback()`), `query_pending_actions` (writes awaiting confirmation), `query_traces` (debug records, visible only to their own user).
