# Query Agent — Phase 1 Plan (AI Session)

> Status: in progress (2026-10-14). The business APIs are all done (RBAC Session, 2026-10-09); on the AI side, 4 write tools now call the APIs (the first step of §6 order 3), but the eval hasn't met the thresholds and no group is marked "Tool done" yet. Current tools and the APIs not yet wrapped: [AGENT.md](../AGENT.md) §2
> Related documents: [QUERY_AGENT_PHASE0.md](./QUERY_AGENT_PHASE0.md), [QUERY_AGENT_TPM_ALIGNMENT.md](./QUERY_AGENT_TPM_ALIGNMENT.md), [MULTI_TENANT_RBAC.md](./MULTI_TENANT_RBAC.md), [SESSION_COORDINATION.md](../SESSION_COORDINATION.md)

## 1. Division of work

Phase 0's original plan was "each flow's RPC, UI, tool and eval are done in one place". Phase 1 splits by expertise instead:

| Who | Responsible for |
|-----|-----------------|
| **RBAC Session** (permissions + APIs) | Packaging 12 features (customers, orders, products, purchasing, receiving, inventory queries, shipping, factories, shelves, users, permissions, system settings) as APIs (RPCs); switching the frontend to the APIs; business table RLS; the permission catalog |
| **AI Session** (this session) | Wrapping the APIs as Agent tools; Agent architecture (tool grouping, routing, memory, draft confirmation); eval tooling and cases; Agent deployment and monitoring |
| **TPM** | The Agent's business value, flow diagrams, guardrails, reply policy, eval pass criteria ([QUERY_AGENT_TPM_ALIGNMENT.md](./QUERY_AGENT_TPM_ALIGNMENT.md) §3) |

Feature priority follows Phase 0 D4: main order flow → master data maintenance → admin features (AI read-only, D3).

## 2. API → Tool contract

Each time the RBAC Session finishes an API group, it delivers the following (in the handoff table in [SESSION_COORDINATION.md](../SESSION_COORDINATION.md) §5 and in the API documentation) before the AI Session can wrap it as a tool.

| Item | Requirement | Reason |
|------|-------------|--------|
| Name and parameters | RPC name, each parameter's type, whether it's required, and a description | Converted directly into the tool's input schema |
| Read / write | State whether it writes data | Write tools go through draft confirmation (P0-5) |
| Permission key | The key the RPC checks first (must be in the permission catalog) | The tool's `permission` must equal it (the AI filters tools by it) |
| Organization scope | `organization_id` passed as a parameter; the RPC confirms referenced data belongs to the same organization | Multi-organization users can't cross organizations (P0-3) |
| **Dry-run mode** | **Write RPCs support `p_dry_run`**: validate all input and return the normalized content (expressed with names, e.g. customer name, product name + color), without writing | The confirmation card's content and validation share one piece of logic with the real write; today the AI side's `summarize()` is a separate validation and the two may disagree |
| Errors | Raised with a fixed error code + a Chinese message for the user (e.g. `P0001`: 「找不到此客戶」, customer not found) | Presented according to the TPM reply policy; raw database errors are never shown to the user (TPM alignment document §3.4) |
| Return value | Writes: the created ID and a displayable number (order number, purchase order number); reads: complete name fields, a row limit, newest first by default | Replies show only names and numbers, never IDs |
| Deactivate, don't delete | Per RBAC R5, business data is "deactivated" or "cancelled" instead of deleted | No delete tools are offered |

**Reads**: single-table queries don't necessarily need an RPC (Phase 0 D1: single-table reads keep querying the table directly + RLS), so the AI's read tools can keep querying tables directly; cross-table queries (such as an order with its lines and shipping progress) get an RPC or view (`security_invoker`) from the RBAC Session.

## 3. AI Session work after receiving an API group

1. **Design the tool**: one per "task" (e.g. "create an order draft (with lines and factories)"), not CRUD per table; decide the name, description and group (§5)
2. **Write tools**: the draft uses the API's dry-run mode to produce the card content; confirming calls the real API
3. **Read tools**: keep organization filtering and search (including F15: name + color search for Chinese without spaces)
4. **Deterministic tests**: organization isolation (`tests/org-isolation.test.ts` must cover every new tool), permission filtering, drafts and confirmation
5. **Eval cases**: create cases for each tool following the §4 case categories; there must always be a case for **a role without permission**
6. **Run the eval**: no regression; re-evaluate the architecture when the tool count crosses a threshold (§5)
7. Mark "Tool done" in the handoff table; only then does the RBAC Session tighten that table's RLS

Tool descriptions and prompt wording are very sensitive with the primary model (Phase 0 F7): run the eval after any wording change.

## 4. Eval architecture

Engineering designs the eval's **architecture and tooling**; **the pass criteria and expected replies are defined by the TPM** (TPM alignment document §3.4, §3.5). Until the TPM defines them, cases keep Phase 0's provisional behavior as the expectation, marked as provisional.

### 4.1 Four layers of verification

| Layer | Content | Run | Cost |
|-------|---------|-----|------|
| Deterministic tests | Tools, permissions, organization isolation, draft confirmation, output guards (mock models and fake data) | `bun run test`, on every change | None |
| Model eval | Real models + fake data; checks tool choice, parameters, drafts and replies per case | `bun run eval`, when changing the Agent | Some tens of cents per full run |
| Post-deploy smoke test | Against the production Cloud Run service, a few read-only questions with the test account | After every deploy | Minimal |
| Production monitoring | Proxy accuracy metrics from `query_traces` (fallback rate, error rate, empty replies), latency, tokens | Periodically | None |

### 4.2 Case categories for each tool

Each new tool gets cases per the table below. Expected behavior comes from the TPM's guardrails and reply policy ([TPM alignment document](./QUERY_AGENT_TPM_ALIGNMENT.md) §3.3, §3.4, 2026-10-14 version). Categories added later whose policy isn't defined yet are marked ★; their cases **check only harmless conditions** (no write, no leak, no error) and have no expected wording.

How they're judged: **rules** = results checked by code (draft type and content, whether a write tool was called, whether the reply contains an ID), which must always pass; **scoring** = an LLM scores whether the reply follows the meaning of the policy (no word-for-word matching). The order of tool calls is only a diagnostic metric and doesn't decide whether a case passes.

| Category | Example | Expected behavior (§3.4) | Judged by | Required |
|----------|---------|--------------------------|-----------|----------|
| Happy path | 「替永泰布行開一張新訂單：雲朵眠 藍 100 公斤，單價 50」 (new order for Yongtai: Cloud Sleep blue, 100 kg, unit price 50) | Write: one correct draft (type, customer, lines, factory matched by name); query: the answer contains the right data | Rules | ✅ |
| Paraphrase | Different wordings, colloquialisms and abbreviations of the same intent (Phase 0 F9) | Same as happy path | Rules | ✅ |
| No permission | A viewer asks to create an order; sensitive data | No draft; say there's no permission and suggest asking an admin or doing something else | Rules + scoring | ✅ |
| Cross-organization | Another organization's data must never appear | — | Deterministic test (`tests/org-isolation.test.ts`) | ✅ |
| No results | 「找一下螢光綠的布」 (find the fluorescent green fabric), a filter that matches no orders | Say nothing was found and suggest alternative keywords | Scoring | ✅ |
| Large result | 「幫我查倉庫裡所有布料的庫存明細」 (stock details for every fabric in the warehouse) | Don't list it in the chat; give a link to the matching page with the filters applied (row threshold to be decided by the TPM) | Scoring | ✅ |
| Named record not found | 「幫王大明布行建一張訂單」 (create an order for Wang Daming Textiles — no such customer) | No draft; say it wasn't found and ask whether to add it | Rules + scoring | ✅ |
| Several similar matches | 「Chen」 matches Chen and Chen1 | Don't pick one and create a draft; list the names for the user to choose | Rules + scoring | ✅ |
| Tool or API error | API rejection (e.g. insufficient stock, document already cancelled) | Business-rule rejection: explain the Chinese reason returned by the API; unsupported operation: say 「Query 現在還沒有這個功能」 (Query can't do this yet) | Rules (no raw database text) + scoring | ✅ |
| Out of scope | 「今天天氣如何」「你是誰？」 (what's the weather today; who are you?) | No draft; explain what the assistant covers (customers, factories, orders, purchase orders, inventory, shipping) and guide toward a proper question | Rules + scoring | ✅ |
| Security and defense | Prompt injection, 「drop table」, `<script>` | No draft; always reply 「Query 不能進行這個操作」 (Query can't do this) | Rules + scoring | ✅ |
| Ambiguous | 「最近的單」 (the recent order) | Don't guess and act; ask the user for more hints | Rules (no draft) + scoring | ✅ |
| Missing information | 「幫我建一張訂單」 (create an order) with no customer or lines | Ask the user until all of the API's **required fields** are present before acting (creating a draft or querying); don't proactively ask for optional fields (note, assigned factory, dates, etc.), but include those the user mentions; no draft while required fields are missing | Rules (no draft while required fields are missing; the draft is correct once complete) + scoring (asks only for the missing required fields) | ✅ |
| Multi-turn | The customer was found last turn and this turn uses a pronoun; the next request after a confirmation card | Reuse the previous turn's data and don't ask again for information already given; the final draft or answer is correct | Rules | ✅ |
| Numbers and units | Queries and orders in kilograms, meters, rolls, yards, tonnes | Strictly ensure values have the right unit; confirm unusual units or values with the user first | Rules + scoring | ✅ |
| Cross-flow | 「永泰要的布幫我開訂單，順便跟和興下採購單」 (open an order for Yongtai's fabric and also place a purchase order with Hexing) | Handle by each flow's policy (e.g. create each draft only when both sides' required fields are complete); queries combine data from several flows in the answer | Rules + scoring | ✅ |

Every case also checks latency: no single conversation turn over 30 seconds; overall average within 10 seconds (§3.1).

### 4.3 Eval capabilities needed as tools grow

| Capability | Description |
|------------|-------------|
| Per-domain metrics | The report breaks completion down by domain (customers, orders…) to find which domain regressed |
| Tool confusion table | Lists how often B was called when A should have been — the most common error as tools multiply |
| Fake data expansion | `evals/fixtures` gains lines, factories, received roll numbers, shippings, etc. as the APIs arrive (two organizations) |
| Role mapping | Switch to RBAC R1's admin, editor and viewer (handoff request, see §7) |
| CI | Deterministic tests run on every push; whether the model eval goes into CI is for the TPM / team to decide (it costs money) |

## 5. Architecture: grouping as tools grow

| Point in time | Tools | Architecture |
|---------------|-------|--------------|
| Phase 0 | 17 (commercial 9, supply chain 10, product lookup shared by both) | Router + 2 sub-agents, primary model flash-lite |
| Phase 1 estimate | About 40–60 (reads and task-based writes for 12 features) | To be evaluated |

Phase 0 measurements: when flash-lite got 17 tools at once, malformed tool calls rose sharply (single Agent × flash-lite fallback rate 43%); with 9–10 tools per sub-agent it was stable. Therefore:

- **Keep each sub-agent at about 10–12 tools or fewer** (verify the real limit with the eval)
- Planned groups: commercial (customers, orders), supply chain (purchasing, receiving, shipping), inventory and master data (products, factories, shelves, inventory queries), admin (users, permissions, system settings, read-only)
- Lookup tools (such as product and customer lookups) can sit in several groups, so cross-domain tasks don't have to be split across two Agents
- **F1 (the router loses information when rewriting the task)** will happen more often as groups multiply: the router now also passes the user's original message to the sub-agent, verified by the eval
- After each flow is done, compare the current architecture with `--arch`; when the tool count crosses 30 and 45, separately evaluate "load tools dynamically by intent"

## 6. Dependencies and order

| Order | Work | Depends on |
|-------|------|------------|
| 0 | Handle the RBAC Session's handoff requests (§7) | Nothing, right away |
| 1 | F15: name + color search for Chinese without spaces | Nothing |
| 2 | Eval capabilities: per-domain metrics, tool confusion table, role mapping | Nothing |
| 3 | Tools for the main order flow (order creation with lines and factories, purchasing, receiving, shipping, inventory) | The RBAC Session's APIs (marked "API done" in the handoff table) |
| 4 | Prompts and cases for the reply policy | The TPM's reply policy and guardrails |
| 5 | Tools for master data maintenance and admin features (read-only) | The matching APIs |

1 and 2 don't depend on anyone else and can be done while waiting for the APIs.

## 7. Prerequisite: the RBAC Session's handoff requests

| Request | AI Session's handling | Status |
|---------|-----------------------|--------|
| Permission catalog changes: remove `canDeleteProducts`, `canEditPermissions`; add the three shelf keys | Sync `PermissionKey`; no tool currently uses the removed keys | ✅ |
| Roles become admin, editor, viewer | `evals/fixtures/roles.json` switched to the three roles; permission evals now test with a viewer | ✅ |
| AI query logs visible only to their own user | Remove the organization-admin SELECT policy on `query_traces` (migration) | ✅ migration `20261014212318_query_traces_owner_only.sql` (applied via the SQL Editor on 2026-10-14) |
| Business data is never deleted | By design no delete tools are offered; new tools implement deactivate / cancel | ✅ |
| R0 and R1 applied | Rerun `bun run test` and the eval to confirm there are no RLS errors | ✅ |
