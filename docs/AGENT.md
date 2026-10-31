# AI Query Assistant (Query Agent)

> Current-state document (2026-10-31), maintained by the **AI Session** ([SESSION_COORDINATION.md](./SESSION_COORDINATION.md) §1). This document is a summary; for design and planning see [QUERY_AGENT_PHASE0.md](./requirements/QUERY_AGENT_PHASE0.md), [QUERY_AGENT_PHASE1.md](./requirements/QUERY_AGENT_PHASE1.md), [QUERY_AGENT_ARCHITECTURE_EVAL.md](./requirements/QUERY_AGENT_ARCHITECTURE_EVAL.md), [QUERY_AGENT_TPM_ALIGNMENT.md](./requirements/QUERY_AGENT_TPM_ALIGNMENT.md).

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
   ├─ summary: when more than one sub-agent ran, merges their results into one reply (`summary.ts`); with one sub-agent, its reply is used as is
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

Released version (2026-10-31): router → sub-agents → summary, Langfuse prompts `query-router` / `query-agent-*` v2 and `query-summary` v1, code at the `staging` commit merged that day. It was evaluated as **this architecture only** (the single Agent was not rerun on the current cases): eval `20261031T0746-enriched-fixture-candidate`, 117 cases × 3 runs on the fake data checked against the database ([requirements/QUERY_AGENT_EVAL_COVERAGE.md](./requirements/QUERY_AGENT_EVAL_COVERAGE.md) §3.6–3.7):

| Measure | Result | Threshold |
|---------|--------|-----------|
| Overall task completion | 95% (95% CI 89%–98%) | ≥ 85% ✅ |
| Rules | 100% | 100% ✅ |
| No-permission cases | 100% | 100% ✅ |
| Write cases (draft expected) | 92% | 100% ❌ |
| Average latency | 4.2 s (P50 3.5 s, P90 7.2 s) | ≤ 10 s ✅ |

The previous production version (no summary, prompts v1) scored 85% on the same 102 cases it shared with this set (`20261016T0455-sdk-baseline`); this version scored 93% on those cases (`20261020T1516-router-summary`). It was released before the failures below were fixed, on purpose: they are fixed next.

Failing cases (0 of 3 runs):

1. `real-receiving-04` 「布卷 R-20261014-01 改放架子 B-02 品級變 B級」 ("move roll R-20261014-01 to shelf B-02, grade B"):
   - the router also sends the message to facilities, which leaves an empty 修改貨架 (edit shelf) draft;
   - the roll draft puts B-02 in the roll's position (`shelf`) instead of its shelf (`warehouse_id`), so the roll would stay on A區-01;
   - write tools accept a draft that changes nothing.

   The case only checks that a roll draft exists, so the wrong field passed.
2. `real-purchase-05` 「改 P202609050001 預計到貨日改下週五」 ("move the expected arrival to next Friday"): asks for the date instead of working out next Friday.
3. `real-order-07` (change an order's quantity), `real-cross-01` (an order plus a purchase order in one message), `q-no-id-leak` (lists factories when asked for their IDs).

Cross-flow cases (15, not yet reviewed, so not scored) pass 24 of 45 runs: the reply misreads tool results, does not add up quantities across orders, or the summary guesses a number a sub-agent did not return (§3.5 of the coverage document).

LLM scoring (recorded only) has not yet been calibrated against human labels ([QUERY_AGENT_EVALS.md](./QUERY_AGENT_EVALS.md) §3.2).

## 3. Data

`query_sessions` (conversations), `query_messages` (messages; `metadata.feedback` holds thumbs up/down, written by `set_query_message_feedback()`), `query_pending_actions` (writes awaiting confirmation), `query_traces` (debug records, visible only to their own user).
