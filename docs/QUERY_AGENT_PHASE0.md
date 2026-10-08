# Query Agent — Phase 0 Foundation Design

> Status: Confirmed (2026-10-07), In Implementation
> Scope: `mcp-server/` (AI Query Backend) + `src/hooks/useQueryChat.ts`, `src/components/query/` (Frontend Chat)
> Related Documents: [ARCHITECTURE.md](https://www.google.com/search?q=./ARCHITECTURE.md)

## 1. Background and Objectives

Query currently has only 17 AI tools, which covers a scope much smaller than the ERP's 12 business domains (customers, orders, products, purchases, receiving, inventory, shipping, factories, shelves, users, permissions, system settings). We will expand these step-by-step according to business workflows later (Phase 1).

Before expanding, we need to establish the infrastructure that "every tool will use" to avoid coming back later to refactor dozens of tools. Phase 0 **introduces no new business features**, with the following goals:

1. Define each tool only once, shared between `/query` and `/mcp`.
2. AI permissions and UI permissions stem from the same data.
3. Write operations require user confirmation and cannot be executed repeatedly.
4. Conversation memory retains queried entities without losing them across turns.
5. Provide a replayable eval test suite to answer "whether the agent should be split" using data.
6. Every request has a trackable trace.

---

## 2. Current Issues

| # | Issue | Impact | Location |
| --- | --- | --- | --- |
| 1 | Two sets of tool implementations (17 in AI SDK, 16 in MCP); descriptions and behaviors are already inconsistent. | Fixing one side leaves bugs on the other; yesterday's missing `list_products` was an example. | `agent/tool-registry.ts`, `tools/*.ts` |
| 2 | AI permissions `ROLE_PERMISSIONS` are hardcoded and unrelated to database `organization_roles.permissions`. | Changing role permissions in the UI does not affect the AI; `/mcp` has zero role filtering. | `agent/permissions.ts` |
| 3 | The write organization uses `getUserOrgId` to take the "first organization"; the organization selected in the frontend is not passed to the backend. | Multi-organization users might write to the wrong organization. | `utils/get-org-id.ts` |
| 4 | Write tools execute directly without confirmation; the entire tool loop reruns when models fall back. | May cause duplicate order creation. | `agent/ai-gateway.ts` |
| 5 | Conversations only store plain text, not tool calls and results; history is sent entirely by the frontend. | IDs found in the previous turn disappear in the next turn; history has no upper limit; can be tampered with. | `useQueryChat.ts` |
| 6 | The Router splits cross-domain requests between two sub-agents and rewrites the user's original phrasing. | "Create an order for the factory" cannot be fully handled by either side. | `agent/router.ts` |
| 7 | Fallbacks do not distinguish error types; any error triggers a model switch and retry. | Design errors like `NoSuchToolError` cannot be fixed by switching models, wasting time and costs. | `agent/ai-gateway.ts` |
| 8 | Backend agent behavior lacks automated tests (`verify-query-ui.py` mocks `/query`). | Modifying prompts or tools provides no way to know if a regression occurred. | — |
| 9 | Only `console.log` is used. | Errors cannot be traced to see which model or tool caused them. | — |

---

## 3. Decisions

| Decision | Content | Status |
| --- | --- | --- |
| D1 | Extract business logic into a shared layer: multi-table writes implemented as Postgres RPCs (transaction guarantees + RLS), single-table reads remain direct queries. | ✅ Confirmed |
| D2 | Agent tools operate at the "task level," not per-table CRUD; UI and tool calls use the same RPC. | ✅ Confirmed |
| D3 | Users, permissions, and system settings: AI is not allowed write access, only read-only queries. | ✅ Confirmed |
| D4 | Phase 1's first workflow is the core order workflow: Customer → Order (including items, factory) → Purchase → Receiving → Inventory → Shipping. | ✅ Confirmed |
| D5 | Upon completion of each workflow, the UI simultaneously switches to use the new RPC, leaving no dual logic. | ✅ Confirmed |
| D6 | Agent topology is decided by eval comparison: **Maintain Router × gemini-2.5-flash-lite** (2026-10-07, see [QUERY_AGENT_ARCHITECTURE_EVAL.md](https://www.google.com/search?q=./QUERY_AGENT_ARCHITECTURE_EVAL.md)). | ✅ Confirmed |
| D7 | `/mcp` currently has no external clients and will be disabled prior to P0-2; it will be regenerated from a single tool source later. | ✅ Confirmed |
| D8 | Approved creation of `query_pending_actions`, `query_traces`, and `query_messages.kind/metadata`, to be created in their respective steps (P0-4 / P0-5 / P0-6). | ✅ Confirmed |

---

## 4. Design

### 4.1 Single Source of Truth for Tools

Each tool is defined only once, and adapters convert it into both AI SDK and MCP formats.

```ts
// mcp-server/src/tools/types.ts
interface ToolContext {
  supabase: SupabaseClient;   // Created with user JWT, RLS applies
  userId: string;
  organizationId: string;     // Organization currently selected in frontend (§4.2)
  permissions: PermissionSet; // §4.2
  requestId: string;          // For tracing (§4.6)
}

interface ToolDefinition<I extends z.ZodTypeAny> {
  name: string;
  domain: 'customer' | 'order' | 'product' | 'purchase' | 'receiving'
        | 'inventory' | 'shipping' | 'factory' | 'shelf' | 'admin';
  description: string;        // Description for the model (in Chinese)
  input: I;
  kind: 'read' | 'write';     // Writes go through §4.3 confirmation flow
  permission: PermissionKey;  // e.g., 'canCreateOrders'
  execute(ctx: ToolContext, input: z.infer<I>): Promise<ToolResult>;
}

```

* Directory: `mcp-server/src/tools/<domain>.ts`, each file exports `ToolDefinition[]` for that domain.
* Adapters: `toAiSdkTools(defs, ctx)`, `registerMcpTools(server, defs, ctx)`.
* `ToolResult` is standardized as `{ ok: true, data, entities? } | { ok: false, error }`, serving as an internal contract (used by MCP and the P0-5 confirmation flow). **The format shown to the model remains unchanged**: the AI adapter returns only data on success, and error text on failure (see §9 P0-2 F7 for reasons).
* Delete duplicate implementations in `agent/tool-registry.ts` after migration is complete.

### 4.2 Permissions and Organization

**Permission sources are shifted to the database.** Each tool declares a permission key already used by the UI (`canViewOrders`, `canCreateOrders`, etc.). At request start:

1. The frontend passes `organization_id` in `/query` requests (using the `X-Organization-Id` header for `/mcp`).
2. The backend verifies that the user is an active member of that organization (`user_organizations.is_active`) or the organization owner, otherwise returning 403.
3. For each permission key used by the tools, call the database function `user_has_organization_permission()` in parallel—**RLS uses this exact same function**, so the backend writes no separate evaluation logic, preventing AI and UI/RLS discrepancies.
4. Owner permissions come from `organizations.owner_id` (database function rules), not keys like `canViewAll` on the owner role.
5. Only tools matching the user's `permission` are passed to the model.

* `/mcp` applies this exact same filtering.
* Hardcoded `ROLE_PERMISSIONS` in `permissions.ts` and the dependency on the legacy `profiles.role` column have been removed.
* All writes uniformly use `ctx.organizationId`, eliminating `getUserOrgId`.
* **All reads are also uniformly filtered by `organization_id = ctx.organizationId**` (including `get_*` queries by ID). RLS allows users to read **every** organization they belong to, and relying solely on RLS would cause multi-organization users to see mixed data (F11).
* Customers, factories, products, and orders referenced in writes must belong to the current organization (`allInOrganization()`).
* Query conversations (`query_sessions`) are separated by organization; switching organizations shows that organization's conversations (F13).

> Note: Permission keys currently only include View/Create/Edit (products also have Delete). If Phase 1 requires finer-grained permissions (e.g., separating "Confirm Order" and "Edit Order"), add keys in the corresponding workflow and update the UI's permission management page accordingly.

### 4.3 Write Security: Drafts + Confirmation

Tools with `kind: 'write'` **do not write business data** within the agent loop; they only create drafts:

```
Model calls create_order_draft(...)
  → Validates input, fetches display names
  → Writes to query_pending_actions (status = pending)
  → Returns draft summary to the model
Frontend displays confirmation card (content, confirm, cancel)
User clicks "Confirm" → POST /query/actions/:id/confirm
  → Calls corresponding RPC using action id as idempotency key
  → status = confirmed, results written back to query_messages

```

New database tables (migrations to be created after confirmation):

| Column | Description |
| --- | --- |
| `id` | uuid, also acts as idempotency key |
| `session_id`, `user_id`, `organization_id` | Ownership; RLS isolates by `user_id` |
| `tool`, `payload` (jsonb) | Operations and parameters to execute upon confirmation |
| `summary` (jsonb) | Content for card display (names instead of IDs) |
| `status` | `pending` / `confirmed` / `cancelled` / `expired` / `failed` |
| `result` (jsonb), `error` | Execution result |
| `created_at`, `expires_at` | Draft expires after 15 minutes |

Benefits:

* No writes occur inside the agent loop; **if the model falls back and retries, it at most generates an extra draft without duplicate writes**, naturally resolving §2 Issue 4.
* Deduplication by action id during confirmation ensures clicking confirm twice only executes once.
* Confirmation and execution bypass the LLM, making results predictable.

### 4.4 Conversation Memory

**The backend reads history independently.** The frontend is modified to send only `session_id`, and the backend reads from `query_messages` using the user's JWT (RLS ensures users can only read their own conversations). This avoids history tampering and centralizes truncation strategies on the backend.

New columns added to `query_messages` (pending confirmation):

| Column | Description |
| --- | --- |
| `kind` | `text` / `action` (confirmation card) |
| `metadata` (jsonb) | `action_id`, `entities`, `trace_id`, etc. |

**Entity Memory:** Entities returned by tools (`{ type, id, label }`, e.g., customer "Client name test0922") are stored in `metadata.entities` of the assistant's message for that turn. When constructing prompts, recently seen entities are organized into a system note, such as:

```
[Confirmed entities in conversation]
- Customer: Client name test0922 (id: …)
- Factory: Factory 092202 (id: …)

```

The model can use IDs directly, while the text returned to the user still conceals IDs.

**Length Limit:** History sent to the model takes the most recent 20 messages (approx. 6–8k tokens limit), plus entity notes. Summarization mechanisms are out of Phase 0 scope and will be built if evals show a need.

**Frontend Anti-Double-Submission:** `sendMessage` locks submission status before the first await, preventing double-clicks or rapid Enter presses from sending twice.

### 4.5 AI Gateway

* **Fallback Rules** (Adjusted based on empirical testing during P0-6 implementation: the original assumption that "400 does not fall back" was incorrect, as F4 proved 400 can occur due to specific provider issues)
* Except for the following cases, any failure switches to the next model: empty responses (F8), malformed tool calls, provider errors, 429s, timeouts, model IDs unrecognized by a provider.
* No fallback for: (1) **This attempt has already executed a write**—retrying would cause duplicate writes, so reply instead with "The operation has already been executed... please check the results"; (2) 401/403 (all models share the same key); (3) Calling non-existent tools even after fixes (prompt/tool design error, model switches cannot fix this); (4) Request deadline exceeded.
* Report the primary model's error if all fail.


* **`default_api.` prefix**: Uses AI SDK's tool call repair to map back to original names, avoiding registration of aliases containing "." (F4).
* **Timeouts**: 30 seconds per model attempt, 90 seconds for the entire request; no new attempts are started after the deadline.
* **Same-Model Retries**: Disabled (`maxRetries: 0`). Switching models acts as the retry; retrying the same model only adds seconds of backoff delay.
* **Error Messages**: Records the provider's response body.
* **Streaming**: Out of Phase 0 scope.

### 4.6 Trace

Each `/query` request writes one row to `query_traces` (migration pending confirmation), isolated by `organization_id` via RLS:

| Column | Description |
| --- | --- |
| `id`, `session_id`, `user_id`, `organization_id` | Ownership |
| `model`, `fallback_from` | Actual model used, whether fallback occurred |
| `steps` (jsonb) | Tool name, parameter summary, duration, success status per step |
| `input_tokens`, `output_tokens`, `latency_ms` | Cost and performance |
| `status`, `error` | Result |

Retention for 30 days: When mcp-server writes a new trace, it deletes records older than 30 days for that user (RLS only allows deleting one's own expired records, eliminating the need for `pg_cron`). `/query` responses include `traceId`; P0-4 stores it in the assistant message's `metadata.trace_id` so users reporting issues can reference it directly.

### 4.7 Eval Harness

Formalizes the "fake data layer + real model replay" approach used during the 2026-10-07 debugging session into an official tool.

```
mcp-server/evals/
├── cases/*.json      ← Test cases
├── fixtures/*.json   ← Fake data (customers, factories, products...)
└── run.ts            ← Runner: bun run eval

```

Case format:

```json
{
  "name": "Cross-domain order creation: customer + factory + product",
  "fixtures": "order-basic",
  "history": [],
  "message": "Create an order for customer Client name test0922 to factory Factory 092202, Cloud Sleep test0922 buy blue0922",
  "permissions": "owner",
  "expect": {
    "tools_called": ["list_customers", "list_factories", "list_products"],
    "draft_created": "create_order_draft",
    "reply_not_matches": "[0-9a-f]{8}-[0-9a-f]{4}"
  }
}

```

* Data layer uses fake data; does not connect to Supabase and performs no writes. Models are called for real.
* LLM outputs fluctuate, so each case runs $N$ times (default 3) to calculate pass rates.
* Output metrics: tool selection accuracy, task completion rate, average latency, average tokens.
* Initial cases approx. 15, derived from actual past incidents: cross-domain order creation, latest PO, low stock, customer not found, duplicate message history, unauthorized roles, etc.
* Once complete, add `bun run eval` to mandatory tests in `CLAUDE.md` (when modifying `mcp-server/`).

**Using eval to decide agent topology (D6):** Run the same set of cases under "Current Router + two sub-agents" versus "Single agent + all tools", compare four metrics, and decide. Re-run after completing each workflow in Phase 1; re-evaluate splitting or "dynamic tool loading by intent" when tools exceed ~40 or accuracy drops significantly.

---

## 5. Implementation Sequence

Each step is individually mergeable and verifiable:

| Step | Content | Verification Method |
| --- | --- | --- |
| P0-1 ✅ | Eval harness + initial cases, establishing a baseline for the **current architecture** | `bun run eval` generates baseline report |
| P0-2 ✅ | Single source of truth for tools + adapters, migrate 17 tools as-is, delete duplicate implementations | Eval matches or exceeds baseline; `/mcp` lists identical tools |
| P0-3 ✅ | Shift permissions to read DB + frontend passes `organization_id` | Role-specific eval cases; manual verification for multi-org accounts |
| P0-4 ✅ | Backend reads history + entity memory + frontend anti-double-submission | Multi-turn order creation cases pass; `verify-query-ui.py` |
| P0-5 ✅ | Draft + confirmation flow (table, API, frontend confirmation card) | Confirmation card UI verification; duplicate confirmations execute only once |
| P0-6 ✅ | Gateway error classification & timeouts + trace | Simulated 429 and invalid tool cases |
| P0-7 ✅ | Eval comparison between single agent and Router, deciding topology based on results | Comparison report |

P0-1 is placed first to provide comparative data for every subsequent step and preserve performance records of the current architecture prior to refactoring.

Steps involving migrations (`query_messages` columns in P0-4, `query_pending_actions` in P0-5, `query_traces` in P0-6) will present migration contents for confirmation before application.

---

## 6. Definition of Done

* `/query` and `/mcp` are generated from the same tool definitions with consistent permission filtering.
* Modifying role permissions in the UI instantly updates the AI's available tools.
* No direct paths to write business data exist within the agent loop.
* Confirmed customers, factories, and products in multi-turn conversations do not need to be re-queried.
* `bun run eval` is executable with a baseline report for the current architecture.
* Agent topology decision is made based on eval results and recorded in this document.

---

## 7. Out of Phase 0 Scope

* Adding tools or RPCs for any new business domains (belongs to Phase 1)
* Streaming responses
* Conversation summarization and long-term memory (user preferences, frequent customers)
* Dynamic tool loading by intent

---

## 8. Confirmation Records

Confirmed on 2026-10-07: D3, D4, D5 approved; `/mcp` has no external clients and is temporarily disabled (D7); three migrations approved for creation (D8).

---

## 9. Progress Records

### P0-1 Eval Harness ✅ (2026-10-07)

**Outputs**

* `mcp-server/evals/`: `run.ts` (runner), `fake-supabase.ts` (in-memory fake data layer applying real filters and logging writes), `fixtures/basic.json`, `cases/*.json` (18 cases: 9 queries, 4 writes, 3 permissions, 2 regressions).
* `mcp-server/src/agent/observer.ts`: `QueryObserver` interface integrating gateway, router, and sub-agents to record routing decisions, model attempts, tool calls per step, and tokens. Behavior remains unaffected when omitted; P0-6 traces will build on this interface.
* `bun run eval`; `CLAUDE.md` updated with "no regression" rules.
* Completed D7 simultaneously: `/mcp` returns 410 to disable (old `src/tools/*.ts` files retained, confirmed for deletion during P0-2).

**Baseline (Current Router + two sub-agents, 3 runs per case)**: Report `mcp-server/evals/reports/20261007T0443-baseline-router.md`

| Metric | Value |
| --- | --- |
| Task Completion Rate | 59% |
| Tool Selection Accuracy | 71% |
| Error Rate | 6% |
| Fallback Rate | 6% |
| Average Latency | 5.0 seconds |

**Issues Discovered in Baseline** (Confirmed as real issues, not test artifacts)

| # | Issue | Case | Planned Handling |
| --- | --- | --- | --- |
| F1 | Router rewrites tasks and loses info: user replies "Client name test0922", task rewritten to "Add order, customer name:" | `r-duplicate-history` | P0-7 (Single agent requires no rewriting) |
| F2 | Product search matches "name + color" as a single string against `name` or `color`, always failing (same as actual DB behavior) | `q-inventory-search`, `w-create-po` | P0-2 (Change search to tokenized matching) |
| F3 | Prompt instructs calling tools not owned by the role (supply_chain role lacks `list_factories`), causing all models to fail and returning 500 in production | `p-sales-cannot-create-po` | P0-3 (Generate prompts based on actually available tools) |
| F4 | `default_api.` tool alias contains ".", but Anthropic only accepts `[a-zA-Z0-9_-]`, **Haiku fallbacks never succeed in requests with tools** | All fallback scenarios | P0-6 (Remove prefix via tool call repair, drop alias registration) |
| F5 | Unauthorized roles still reply "What items would you like to order?", implying order creation is possible | `p-accounting-cannot-create-order` | P0-3 (Inform prompt of permission limits) |
| F6 | Asking for optional notes before creating orders, adding an extra turn | `w-create-order`, `r-multi-turn-order` | P0-5 (Create drafts directly, collect notes via confirmation cards) |

### P0-2 Single Source of Truth for Tools ✅ (2026-10-07)

**Outputs**

* `mcp-server/src/tools/`: `types.ts` (`defineTool`, `ToolResult`, `PermissionKey`), 7 domain files (replacing old MCP implementations, content based on AI versions while preserving MCP's `create_customer.fax`), `index.ts` (registry, checks at startup that every tool in `TOOL_GROUPS` has exactly one definition), `adapters.ts` (`toAiSdkTools`, `registerMcpTools`), `search.ts`.
* `agent/tool-registry.ts` slimmed down into a thin layer fetching from registry by permission and group.
* Each tool declares `permission` (DB permission key), effective starting P0-3.
* `mcp-server/tests/tools.test.ts` (`bun run test`, 7 items): AI and MCP adapters expose the exact same 17 tools, MCP read-only flags, MCP calls route through shared implementations, parameter validation intercepts before writes, F2 tokenized search.
* `/mcp` remains disabled, to be re-enabled using `registerMcpTools` after adding permission filtering in P0-3.

**Results**: Report `mcp-server/evals/reports/20261007T0516-p0-2-single-source-v3.md`, no regression compared to baseline.

| Metric | Baseline | P0-2 |
| --- | --- | --- |
| Task Completion Rate | 59% | 75% |
| Tool Selection Accuracy | 71% | 82% |
| Error Rate | 6% | 2% |
| Average Latency | 5.0 seconds | 4.6 seconds |

Improved cases: `q-inventory-search`, `w-create-po` (F2 fixed), `p-sales-cannot-create-po` (2/3).

**New Findings**

| # | Issue | Planned Handling |
| --- | --- | --- |
| F7 | gemini-2.5-flash-lite is extremely sensitive to tool descriptions and result formats: adding brief notes to 4 tool descriptions or wrapping results in `{ ok, data }` caused MALFORMED_FUNCTION_CALL or UUID leaks in other cases. Reverted to original descriptions and split wrapping in AI adapter | Always run eval when modifying tool descriptions or prompts; evaluate switching primary model to gemini-2.5-flash during P0-7 comparison |
| F8 | When Gemini returns `finish_reason: error` (MALFORMED_FUNCTION_CALL), AI SDK throws no exception, returns empty string, **and fails to trigger fallback**, leaving the user with a blank response | P0-6 (Treat this as failure in gateway and fallback) |
| F9 | Outputs across 3 runs with identical settings are nearly identical; they are not independent samples, so pass rates reflect "feasibility of this setting" rather than probability | Account for this when reading eval reports; use multi-phrased case sets during P0-7 comparisons |

### P0-3 Permissions and Organization ✅ (2026-10-07)

**Outputs**

* `agent/auth-guard.ts`: Verifies organization membership and checks permission keys required by tools using the DB function `user_has_organization_permission()`; `AccessError` maps to 400/401/403.
* `agent/permissions.ts`: Removes hardcoded `ROLE_PERMISSIONS` and `profiles.role` dependency, keeping only tool groupings.
* `ToolContext` gains `userId`, `organizationId`; order, customer, and purchase creation uniformly write to the user-selected organization.
* `/query` requires `organization_id`; `/mcp` re-enabled, specifying organization via `X-Organization-Id` header and applying identical permission filtering.
* Frontend `useQueryChat` transmits the currently selected organization; prompts user to "Please select an organization first" if none selected.
* Sub-agent prompts: Append "Permission limits" explanations when accounts lack certain tools in a group (F3, F5). Prompts for fully privileged accounts remain identical to prior versions (F7).
* Tests: `tests/auth-guard.test.ts` (8 items: role-specific tools, non-member/inactive member 403, missing org 400, writes land in selected org); eval routes through real `authGuard`, role permissions pulled from `evals/fixtures/roles.json` (copied from DB system roles); `verify-query-ui.py` adds `organization_id` request check.

**Results**: Report `mcp-server/evals/reports/20261007T0537-p0-3-db-permissions.md`, no regression compared to P0-2.

| Metric | Baseline | P0-2 | P0-3 |
| --- | --- | --- | --- |
| Task Completion Rate | 59% | 75% | 82% |
| Tool Selection Accuracy | 71% | 82% | 82% |
| Error Rate | 6% | 2% | 0% |

F3 (`p-sales-cannot-create-po` 3/3) and F5 (`p-accounting-cannot-create-order` 0/3 → 3/3) resolved. Remaining failures are F1 (P0-7) and F6 (P0-5).

Production verification: Missing org returns 400, non-member org returns 403, belonging org returns 200; `/mcp` lists tools by permission, returning 400 when header is omitted.

**New Findings**

| # | Issue | Recommendation |
| --- | --- | --- |
| F10 | `user_has_organization_permission`, `is_organization_owner`, `user_belongs_to_organization`, and `get_user_organizations` are SECURITY DEFINER and accept arbitrary `_user_id` parameters, allowing anyone (including unauthenticated users) to query **other users'** permissions, ownership, and memberships across any organization | ✅ Fixed (see "Organization Boundary Hardening" below) |

**Multi-Organization Account Verification (2026-10-07, `lovejoker369+test@gmail.com`: lo1 admin, lo2 owner)**

| # | Issue | Status |
| --- | --- | --- |
| F11 | Read tools lacked organization filtering, relying solely on RLS. Multi-org users querying customers in lo2 (0 customers) retrieved lo1's 4 customers (applies to both `/query` and `/mcp`). Existed prior to P0-3 | ✅ Fixed: All reads include organization conditions; writes referencing data must belong to the current organization |
| F12 | Views `inventory_summary` and `inventory_summary_enhanced` lacked `security_invoker`, executing as the owner and **bypassing RLS**: any logged-in user could read inventory across **all organizations** (observed inventory for "Jifu", and AI previously listed Jifu's "1601 bird's eye fabric" in lo1 low-stock replies) | ✅ Fixed (see "Organization Boundary Hardening" below) |
| F13 | Query conversation lists lacked organization filtering, continuing previous org conversations after switching organizations, leaking previous org content into new org model context | ✅ Fixed: Conversations separated by organization; creating conversations requires a current organization |

**Verification**

* `tests/org-isolation.test.ts` (12 items): Fixtures include a second organization whose data consists exclusively of "latest" or "low stock" items, ensuring missing filters surface in results; covers every read tool, `get_*` ID-based cross-org reads, and cross-org write references. Mutation testing confirmed removing organization filters from `list_customers` causes tests to fail.
* Eval fake data layer adjusted to return data based on `select` fields (matching the real DB). Previous behavior returning full rows changed model behavior due to extra columns (F7).
* Eval report `mcp-server/evals/reports/20261007T0632-p0-3-org-isolation-v2.md`, no regression from P0-3, task completion rate 82%, zero cross-org data in replies.
* Production: lo1 has 4 customers / 5 factories / 8 products / 5 inventory items (excluding Jifu); lo2 has 0 across the board, customer queries reply "No customers found".
* Browser test: Sent in lo1 → switched via menu to lo2 → sent, requests correctly carried lo1 and lo2 respectively; conversations stored separately per organization.

### Organization Boundary Hardening ✅ (2026-10-07)

Goal: Ensure organizational data and member info do not cross organizational boundaries, covering AI Query and inventory. Migration: `supabase/migrations/20261007130000_org_boundary_hardening.sql` (applied to production database).

**Database**

| Item | Correction |
| --- | --- |
| Two inventory views | Switched to `security_invoker = true` (applying queryer's RLS), appending `organization_id` at the end for frontend filtering. |
| Permission/membership functions | Added `can_inspect_organization()`: answers only questions "about oneself" or "about one's own organization". All RLS policies pass `auth.uid()`, and the only cross-user query (`transfer_organization_ownership`) validates ownership upon call, remaining unaffected. |
| `create_default_organization_roles` | Restricted from allowing arbitrary insertion (including unauthenticated users) to being usable solely by organization creation triggers. |
| Unauthenticated users | Revoked execution rights for `complete_user_invitation`, `transfer_organization_ownership`, `get_user_organizations`, and `ensure_user_profile` (functions not utilized by RLS policies). |

**Frontend**: `useInventoryAlerts` and `CreatePurchaseDialog` added organization filtering when reading `inventory_summary` (previously lacking filters while views bypassed RLS). The remaining 15 queries lacking explicit organization conditions were audited individually: all query via upper-level record IDs (customers, products, orders, shelves, or newly created records) preventing cross-org leakage.

**AI tools**: Inventory tools updated to filter by view `organization_id`, aligning with other tools.

**Verification** (Executed via `lovejoker369+test@gmail.com`, comparing pre- and post-application)

| Item | Pre-application | Post-application |
| --- | --- | --- |
| Visible rows across 13 tables | — | Identical (general access unaffected) |
| Visible rows in `inventory_summary` | 33 (all organizations) | 8 (= visible products count) |
| Visible rows in `inventory_summary_enhanced` | 6 (including 1 Jifu record) | 5 |
| Querying Jifu owner's ownership/membership/permissions | true | false |
| Listing Jifu owner's organizations | 1 | 0 |
| Querying own organization's owner, members, permissions | true | true |
| Unauthenticated call to `create_default_organization_roles` | 409 (executable) | 401 |

* Organization creation: Rolled back after creating an organization in a transaction as a logged-in user; triggers successfully created 6 default roles, making the creator a member with permissions; left no test data.
* Supabase security advisor: `security_definer_view` ERRORs cleared.
* Browser: All inventory view rows received in lo1 belong to lo1 (0 external products); 0 rows in lo2.
* AI: lo1 low-stock replies no longer include Jifu products; lo2 replies "All product inventories are currently sufficient."
* Frontend tests 24/24, `bun run test` 27/27, `verify-query-ui.py` 16/16; eval showed no regression (`20261007T0651-org-boundary-hardening.md`), 0 cross-org data rows.

**Follow-ups**

| # | Issue | Recommendation |
| --- | --- | --- |
| F14 | Order, shipment, roll number, and purchase order numbers are **globally unique**, but organizations generate next numbers by looking only at their own records: two organizations might generate identical numbers on the same day causing write failures | Change to "unique within organization" (`UNIQUE (organization_id, order_number)`) generated via RPC; belongs to Phase 1 order core workflow |
| F8 | Frequency of blank responses caused by MALFORMED_FUNCTION_CALL increased (3 cases each had 1 instance in this eval) | Recommend moving P0-6 ahead of P0-4 |
| — | Concurrent changes by others in the same DB (e.g., `add_delete_organization_rpc`), local `supabase/config.toml` `project_id` differs from active project | Verify config and coordinate migration workflows |

### P0-6 Gateway Error Handling & Trace ✅ (2026-10-07)

**Outputs**

* `agent/ai-gateway.ts`: Fallback rules per §4.5; blank responses treated as failures (F8); tool call repair replaces `default_api.` aliases (F4); 30s single attempt, 90s total timeout; supports injecting model lists for testing.
* Write protection: After a tool executes a write, sub-agents are notified, and subsequent failures stop model fallback retries, replying instead with "The operation has already been executed... do not submit repeatedly".
* `agent/trace.ts` and migration `20261007140000_add_query_traces.sql`: Writes one trace per `/query` request (routing, model attempts and durations, tool calls, tokens, latency, errors), linking to conversations; RLS: users can write for themselves in their organization, read their own records, and members with `canViewSystemSettings` can read all organization records.
* `/query` response includes `traceId`; frontend passes `session_id`.
* `QueryObserver` model attempts carry phase (`router` / `agent:<group>`) and duration; router, sub-agents, and gateway pass observer and deadlines via `QueryRun`.

**Verification**

* `tests/ai-gateway.test.ts` (10 items, mocked models, network-free): Blank response fallback, 5xx fallback, 401 no fallback, all fail reports primary model error, timeout aborts, expired deadlines skip calls, `default_api.` repair, **already written skips re-execution (generates only one order)**, pre-write failures fallback normally. Mutation testing confirmed disabling write protection causes tests to fail.
* Real models: Haiku successfully answers when used independently for tools (previously 400ed due to F4); when primary model intentionally set to an invalid ID, fallbacks to Haiku and completes tool flow.
* Production: `/query` returns `traceId`, trace content is complete and linked to conversation; attempts to write traces as other users or in non-belonging organizations are denied (403), unable to see out-of-organization traces.
* `bun run test` 37/37, frontend tests 24/24, `verify-query-ui.py` 16/16.
* Eval: Report `20261007T0709-p0-6-gateway.md`, no regression; three previously 2/3 cases returned to 3/3, 0 blank responses.

F4 and F8 resolved. `src/integrations/supabase/types.ts` does not yet contain `query_traces` (currently unused by frontend; will be included upon the next full type regeneration).

### P0-4 Conversation Memory ✅ (2026-10-07)

**Outputs**

* Migration `20261007150000_query_messages_kind_metadata.sql`: `query_messages` gains `kind` (`text` / `action`, latter for P0-5) and `metadata`.
* `agent/memory.ts`:
* Backend reads conversations using user JWT (most recent 20 messages prior to current message); frontend sends only `session_id` and newly saved `message_id`, no longer sending history. Conversations must belong to the current organization, otherwise neither read nor written back.
* Entity memory: When tools find 1–3 specific records (customer, factory, product, order, purchase order, shipment), they are recorded as entities and stored in assistant response `metadata.entities`; the next turn lists recent 10 entities and IDs in the sub-agent's system prompt. Prompts without entities remain completely identical to previous versions (F7).


* Backend saves assistant responses independently (including `metadata.trace_id`, `metadata.entities`), responses carry `messageId`; if saving fails, returns `null` for frontend fallback storage.
* Frontend `sendMessage`: Uses a ref to lock submission before the first await, fixing double Enter presses sending duplicates; no longer sends history.
* Callers without `session_id` (e.g., API tests) can still use `history` in requests without write-back.

**Verification**

* `tests/memory.test.ts` (8 items): Entity extraction rules (≤ 3 records, labels, errors excluded), historical entity merging and limits, `loadHistory` fetches only prior to current message; full `handleQuery` flow with mocked model: history loaded from DB, forged history in requests ignored, entities appear in system prompt, model builds orders directly using remembered IDs, responses stored back with trace_id; other organizations' conversations are neither read nor written back.
* Eval added `r-entity-memory` (3/3): Previous turn found "Yongtai Fabric Store", current turn "Help him create an order" directly uses remembered ID to build order. **Control group (entities removed) invariably re-calls `list_customers**`, proving memory saves a query turn.
* Eval report `mcp-server/evals/reports/20261007T0719-p0-4-memory.md`, no regression, task completion rate 83%, 0 blank responses, 0 UUID leaks (even when IDs are present in prompts).
* Browser test (real backend): "Query customer Client name test0922" → "How many orders does he have?" Second turn trace shows direct call to `list_orders` using remembered customer_id; double Enter presses store only 1 message; all responses saved by backend with trace_id, no duplicates.
* `bun run test` 45/45, frontend tests 24/24, `verify-query-ui.py` 17/17 (added check for requests carrying `session_id` + `message_id` without `history`).

**Unresolved**: `r-duplicate-history` (F1, Router task rewriting loses info, P0-7); `w-create-order` / `r-multi-turn-order` (F6, asking for notes before creating orders, P0-5).

### P0-5 Drafts + Confirmation ✅ (2026-10-07)

**Outputs**

* Migration `20261007160000_add_query_pending_actions.sql`: States `pending → executing → confirmed / failed`, `cancelled`, `expired` (15 mins); RLS: users can only create for themselves in their organization, read their own, and advance their own uncompleted actions.
* Tool layer: Each write tool must provide `summarize()` (validate inputs, verify referenced records belong to current organization, generate card content using names instead of IDs), checked at registry startup. **Write tools in AI flows generate drafts only**: `toAiSdkTools` requires `onDraft`, leaving no direct paths to write business data.
* Drafts generated by failed model attempts are discarded, so fallback retries leave no duplicate cards; P0-6's "no fallback after writes" is thus no longer needed and has been removed.
* `agent/actions.ts` and `POST /query/actions/:id/confirm|cancel`: Re-verifies membership and tool permissions upon confirmation → atomically claims `pending → executing` → executes previous tool implementations → records results and posts result messages in conversation; duplicate confirmations return the same result; cancellations also post result messages.
* Frontend: `ActionCard` (title, fields, status, confirm/cancel), `useQueryAction`, `src/lib/queryApi.ts`; `QueryChat` renders messages with `kind = 'action'` as cards.
* Prompt (F6): Writes generate drafts only, do not prompt for optional fields beforehand; instruct users to confirm via cards after draft creation.
* **Output Guard** `agent/output-guard.ts`: Strips UUIDs from all responses. After adding draft rules, the primary model started listing factory IDs in responses (F7); since prompt rules proved unreliable, this was shifted to deterministic handling.

**Issues Discovered and Fixed During Implementation**

* **Model claims draft created but calls no tools** (Browser test: after confirming the first card, asking to add a new customer causes the model to parrot previous text "Draft created... please check the confirmation card below" without generating any actual drafts). Cause: Conversation history lacked tool calls, so the model imitated its previous response. Comparing four presentation styles showed only "omitting draft introduction replies, keeping only card results" stably induced primary model tool calls (3/3). Fixes:
1. `toModelHistory`: Hide draft introduction replies (`metadata.action_ids`) and cards from the model; present card results (confirm, cancel, failure) as notes; merge consecutive same-role messages.
2. **Deterministic Guard**: When replies mention confirmation cards or draft creation but the current attempt created no drafts, treat it as an invalid response and fallback (`GatewayCall.validate`). Final eval intercepted 4 such instances, all completed successfully by fallback models.
3. Use standard replies instead of failures when models reply blank after creating drafts (`emptyReply`).


* Eval added `r-after-confirmation` (reproducing this incident): 3/3 claimed drafts without creating them before fix; 3/3 successfully created drafts after fix.

**Verification**

* `bun run test` 62/62: `tests/actions.test.ts` (9 items: confirmation executes once and posts result, duplicate confirmation rewrites nothing, **concurrent double confirmations write only once**, expiration, cancellation, completed actions uncancelable, rejected and held pending if permissions removed, execution failures recorded as failed, other users' actions return 404); atomic claiming verified via mutation testing (removing `status = 'pending'` condition caused concurrent confirmation tests to fail); gateway/memory tests updated for draft behaviors, adding fake draft interceptions and blank response replacements.
* Eval report `mcp-server/evals/reports/20261007T0743-p0-5-drafts-final.md`, no regression from P0-4, task completion rate 89%; added default check "AI flows write zero business data", 60 runs with 0 writes; 0 blank responses, 0 UUID leaks.
* Browser test (real backend, lo2): When cards show "Pending Confirmation", DB has no new customer; clicking "Confirm" creates the customer, updates status to "Completed", and posts result messages; immediate subsequent add requests successfully generate cards, and clicking "Cancel" prevents creation.
* Production: Duplicate confirmations return the same result with only one customer created; canceling completed actions or confirming canceled actions returns 409.
* Frontend tests 24/24, `verify-query-ui.py` 17/17.

F6 resolved (`w-create-order` 0/3 → 3/3). Two test customers created in lo2: "P0-5 測試客戶" and "P0-5 測試客戶二".

**Unresolved**: `r-duplicate-history` (F1, P0-7); `r-multi-turn-order`: still replies with text asking "Would you like to create an order for this customer?" before creating drafts (attempts to add prompt rules saying "Do not ask via text if confirmed" were ineffective and reverted).

### P0-7 Architecture Comparison ✅ (2026-10-07)

See [QUERY_AGENT_ARCHITECTURE_EVAL.md](https://www.google.com/search?q=./QUERY_AGENT_ARCHITECTURE_EVAL.md) for full details.

* Added single agent implementation (`runSingleAgent`, `agent/answer.ts`), switchable via `QUERY_AGENT_MODE` (default `router`); sub-agent core refactored into shared `runAgent`, keeping Router architecture prompts word-for-word identical.
* Eval runner gains `--arch`, `--primary`; added 9 paraphrase cases (`evals/cases/paraphrase.json`).
* Compared 4 configurations (Router / Single Agent × flash-lite / flash), **maintaining Router × flash-lite** based on user criteria (cheapest, accuracy > 85%, latency under 10s).
* `bun run test` 64/64 (added `tests/single-agent.test.ts`); Router path shows no regression from P0-5.

**New Findings**

| # | Issue | Recommendation |
| --- | --- | --- |
| F15 | Chinese product searches rely purely on whitespace tokenization: "棉麻平织米白" (name + color, no spaces) fails to find products, failing across all 4 configurations | Add non-whitespace name + color matching to search |
| F16 | flash-lite consistently waits 12–25 seconds on the first step of deciding to call tools for certain queries (e.g., "latest purchase order"), causing ~10% of requests to exceed 10s | Monitor production latency via `query_traces`; switch to flash if necessary |

**Phase 0 complete.**