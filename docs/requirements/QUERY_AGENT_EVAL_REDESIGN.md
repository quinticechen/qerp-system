# Query Agent Eval Redesign

> Status: in progress (2026-10-20): §6 steps 1–5 done, the step 6 judge done; **human labeling paused** until the §8 architecture change is finished (found during labeling, 2026-10-20). Owner: AI Session.
> The current eval: [QUERY_AGENT_EVALS.md](../QUERY_AGENT_EVALS.md); situation categories and expected behavior: [QUERY_AGENT_PHASE1.md](./QUERY_AGENT_PHASE1.md) §4.2; reply policy: [QUERY_AGENT_TPM_ALIGNMENT.md](./QUERY_AGENT_TPM_ALIGNMENT.md) §3.4.
> Update on completion: `QUERY_AGENT_EVALS.md`, [EVALS.md](../EVALS.md), the "Agent Evals" section of CLAUDE.md.

## 1. Why redesign

The existing 31 cases were compiled by engineering from incidents during development, some generated automatically, and their expectations weren't based on any policy. Of the 5 failing cases in the last run on 2026-10-09 (`20261009T0549-phase1-step1-api-writes-v3`), 3 were problems with the tests themselves:

| Case | What happened | Problem |
|------|---------------|---------|
| `r-entity-memory` | The draft was completely correct; it failed only because it looked up the customer one extra time | Checked the process, not the outcome |
| `r-multi-turn-order` | After the customer name was supplied, the Agent asked again "is it this customer?" | There was no policy then (now defined: create the draft once the required fields are present) |
| `r-duplicate-history` | Required a call to `list_customers`, but the user gave no customer name that turn | The expectation itself was wrong |
| `pp-create-po` | The router treated the factory as a customer | A real failure |
| `w-cross-domain-order` | Built a purchase order and asked the user for a product ID | A real failure |

Other limits: reply quality could only be checked with regular expressions; 3 runs of the same case give nearly identical output (Phase 0 F9), so they aren't independent samples; with few cases, one case was about 3%.

## 2. Decisions

| # | Question | Decision |
|---|----------|----------|
| E1 | What decides whether a case passes | **The outcome**: the draft (type and content expressed with names), the facts in the answer, and rules that must never be broken. Tool call order and router dispatch are diagnostic metrics only (2026-10-14) |
| E2 | Where cases live | **The Langfuse Dataset is authoritative**: add and edit cases on the Langfuse website; the eval reads from Langfuse when it runs; each run exports the cases it used to the repo (`mcp-server/evals/snapshots/`) for git tracking and offline reruns (2026-10-14) |
| E3 | Where prompts live | **Langfuse Prompt Management**: production reads only the `production` label; a new version must pass the eval before it can be labeled `production`; a fallback prompt is kept in code for when Langfuse can't be reached (2026-10-14) |
| E4 | Case format | The §3 format: situation category, source, reviewer, policy status; expectations describe only outcomes and rules (2026-10-14) |
| E5 | Where cases come from | Mainly real utterances from the TPM ([QUERY_AGENT_EVAL_UTTERANCES.md](./QUERY_AGENT_EVAL_UTTERANCES.md)), with the PHASE1 §4.2 matrix filling in missing categories; LLM-generated paraphrases are added only after human review (2026-10-14) |
| E6 | Behavior when information is missing | Ask until the API's required fields are present before acting; don't proactively ask for optional fields, but include those the user mentions (TPM, 2026-10-14) |
| E7 | The eval's data layer | **Fake data** (`evals/fixtures/`, `fake-api.ts`), but before every run, check that the fake data and simulated APIs match the current database (§5.3), and stop if they don't (2026-10-14) |
| E8 | Send production traces to Langfuse? | **Send after de-identification**, only thumbs-down, failed and sampled conversations (§5.4) (2026-10-14) |
| E9 | Replies on tool or API errors | For business-rule rejections (e.g. insufficient stock), explain the Chinese reason returned by the API; only unsupported operations get 「Query 現在還沒有這個功能」 (Query can't do this yet) (TPM, 2026-10-14) |
| E11 | Sampling rate for production traces | 5%, adjusted by volume after launch (TPM, 2026-10-14) |
| E10 | Number of cases | **About 100** (TPM, 2026-10-14), covering the situations of the existing 17 tools, cross-flow and others. With 100 cases, overall completion has a margin of error of about ±7%, so regression is judged as "a single case going from pass to fail", and overall completion is reported with a confidence interval |

## 3. Case format

Each case is one item in the Langfuse Dataset `query-agent`: `input` is what's sent to the Agent, `expectedOutput` is the expectation, and `metadata` holds management fields. Case content is Chinese, as users write it: in the example below, the field labels 「客戶」 and 「品項 1」 are the confirmation card's labels (customer, line 1), and 「多輪」 is the category name for multi-turn.

```json
{
  "input": {
    "role": "editor",
    "fixtures": "basic",
    "history": [
      { "role": "user", "content": "幫永泰布行開一張訂單" },
      { "role": "assistant", "content": "好的，請問要訂哪個產品、數量和單價？" }
    ],
    "message": "雲朵眠藍色 20 公斤，一公斤 80"
  },
  "expectedOutput": {
    "draft": {
      "tool": "create_order",
      "fields": { "客戶": "永泰布行", "品項 1": "雲朵眠 test0922 - 藍0922 × 20 公斤，單價 80" }
    },
    "answer_includes": [],
    "policy": "多輪"
  },
  "metadata": {
    "id": "order-multi-turn-001",
    "category": "多輪",
    "domain": "order",
    "source": "real",
    "reviewed_by": "TPM",
    "policy_status": "defined",
    "diagnostics": { "tools": ["list_customers", "list_products", "create_order"], "route": ["commercial"] }
  }
}
```

| Field | Description |
|-------|-------------|
| `input.role` | `owner`, `admin`, `editor`, `viewer` (`evals/fixtures/roles.json`) |
| `input.fixtures` | Name of the fake data set (`evals/fixtures/<name>.json`) |
| `expectedOutput.draft` | The draft that should be produced: `tool` and the confirmation card's fields (`summary.fields`, expressed with names, not IDs); list only the fields to check |
| `expectedOutput.no_draft` | `true`: no draft may be produced |
| `expectedOutput.answer_includes` | Facts that must appear in the answer (names, number + unit) |
| `expectedOutput.policy` | The §3.4 situation; the LLM scoring picks its rubric by this |
| `metadata.category` | The PHASE1 §4.2 situation category (including the TPM's additions: security and defense, large result, cross-flow) |
| `metadata.domain` | `customer`, `factory`, `product`, `shelf`, `order`, `purchase`, `receiving`, `inventory`, `shipping`, `general` |
| `metadata.source` | `real` (real utterance), `incident` (incident), `matrix` (filled in per §4.2), `generated` (LLM paraphrase) |
| `metadata.reviewed_by` | Reviewer; `generated` cases without a reviewer don't count toward the thresholds |
| `metadata.policy_status` | `defined`; `pending` means the policy isn't defined, so only the rules that must never be broken are checked |
| `metadata.diagnostics` | Expected tools and dispatch; only feed the diagnostic report and don't affect passing |
| `metadata.known_gap` | A known gap not yet fixed; doesn't count toward the thresholds. For these cases `draft.tool` may be a business API not yet wrapped as a tool (`PLANNED_TOOLS` in `evals/cases.ts`), recording the expected behavior once the tool exists |

## 4. Scoring

### 4.1 Three layers

| Layer | Langfuse score | Judged by | Counts toward thresholds |
|-------|----------------|-----------|--------------------------|
| Rules that must never be broken | `rule_*` (e.g. `rule_no_write`, `rule_no_id_leak`, `rule_no_false_draft`, `rule_permission`) | Code; checked on every run | Always 100% |
| Task outcome | `outcome` (0 / 1) | Code compares against `expectedOutput.draft`, `no_draft`, `answer_includes` | Yes |
| Reply quality | `policy_judge` (0–1, with a reason) | Langfuse LLM-as-a-Judge (observation level; trace-level evaluators only run on Langfuse Cloud until 2026-11-16), using the §3.4 rubric matching `expectedOutput.policy` | Recorded only until calibrated (§4.3) |

`latency_ms` is also recorded: a single run over 30 seconds counts as a failure of that run; the overall average must be within 10 seconds (TPM §3.1).

### 4.2 Diagnostic metrics (don't affect passing)

- Tool confusion table: how often B was called when A was expected
- Router dispatch accuracy
- Completion broken down by `domain` and `category`
- Fallback rate, error rate, cost per completed task

### 4.3 Calibrating the LLM scoring

1. First, label about 50 replies by hand in a Langfuse annotation queue (compliant / non-compliant with the policy)
2. Compare the agreement between `policy_judge` and the human labels
3. Once agreement reaches 90% or more, the TPM decides whether `policy_judge` counts toward the thresholds

## 5. Langfuse setup

| Item | Setup |
|------|-------|
| Dataset | `query-agent` (keeping the name); old cases rewritten in the §3 format and re-imported, old items archived |
| Prompts | `query-router`, `query-agent-commercial`, `query-agent-supply-chain`, `query-agent-single`; labels `production` (production), `candidate` (awaiting eval) |
| Experiment | Run by `bun run eval` (SDK style): the whole Agent flow with tools and fake data, which the Langfuse website can't run. The metadata records prompt versions, models per node, git commit |
| Experiments on the website | Only for single calls: the router's classification (which can output structured results), tuning the LLM evaluator itself |
| Evaluators | One rubric for each §3.4 situation |
| Annotation queue | `policy-calibration`: for calibrating the LLM scoring |

### 5.1 New eval options

| Option | Description |
|--------|-------------|
| `--prompt-label <label>` | Use the Langfuse prompt with that label (default `production`) |
| `--dataset-version <time>` | Use the Dataset as it was at a point in time (Langfuse keeps item versions by time, the API's `version` parameter), so two runs compare on the same set of cases |
| `--offline`, `--snapshot <file>` | Don't connect to Langfuse; use the latest or a given snapshot in `evals/snapshots/` |
| `--skip-db-check` | Skip §5.3; the run isn't written to the experiment log and is never used as a baseline |

### 5.2 Prompt release process

The prompt text still lives in code (`router.ts`, `sub-agents.ts`) and is synced to Langfuse by `bun run prompts` (`evals/prompts-cli.ts`):

1. Change the prompt in code; `bun run eval` tests the in-code version by default
2. `bun run prompts -- push`: prompts that changed are uploaded as new versions labeled `candidate` (unchanged ones keep their version)
3. `bun run eval -- --prompt-label candidate --label <what changed>`: test the candidate on Langfuse
4. No regression and thresholds pass → `bun run prompts -- promote`: the candidate is relabeled `production`; production picks up the new version once the cache expires (60 seconds)
5. Record it in `QUERY_AGENT_EVALS.md` §5

Editing a prompt directly on the Langfuse website also creates a new version, which must go through steps 3 and 4 too; afterwards, sync the content back into code. `bun run prompts -- status` shows whether code, candidate and production agree.

Production (`src/agent/prompts.ts`): with the `LANGFUSE_*` environment variables set, it reads `production` (changeable with `QUERY_PROMPT_LABEL`), cached for 60 seconds with a 2-second timeout; if it can't read them it uses the in-code version, so replies never fail because of Langfuse. Which prompt versions each reply used is recorded in `query_traces.prompts`.

### 5.3 Database consistency check (E7)

Runs before `bun run eval` starts; any mismatch is listed and the run stops (`--skip-db-check` skips it, and that run is never used as a baseline). It compares **structure and rules**, not data content: the fake data is made-up customers and documents anyway.

| Check | Fake-data side | Database side |
|-------|----------------|---------------|
| Tables, views and columns | Tables, columns and relations in `fixtures/*.json`; the columns each tool queries (taken from `.select(...)` in `src/tools/`) | A `limit=0` query on the same columns with the test account: a missing column returns `42703`, a relation `PGRST200` |
| API parameters | The parameter names `fake-api.ts` declares for each API | Call the function with a nonexistent parameter: PostgREST can't find the function (`PGRST202`; the function doesn't run), and the hint lists the real parameters |
| Status values | Status columns in the fake data, enums in tool inputs (order, purchase order and product statuses) | A `limit=0` query filtered by that value: an enum column rejects invalid values with `22P02` |
| Role permissions | `fixtures/roles.json` | `role_permissions` |
| Error codes | Codes (HINT) raised by `fake-api.ts` | The error code tables in [API.md](../API.md) §3 |

PostgREST's OpenAPI description is only available with the service_role key, so the queries above, which read no data, are used instead. `fake-api.ts` also rejects unknown or missing required parameters just as PostgREST does, so the eval fails when a tool passes a wrong parameter name.

The first run (2026-10-14) found and fixed: `get_shipping` queried a nonexistent `inventory_rolls.grade` (it should be `quality`; looking up shipping details in production would have failed); the status filter in `list_purchase_orders` included a nonexistent `in_production` and lacked `partial_received`; the fake data had a purchase order status `in_production`.

### 5.4 Production traces (E8)

**What is sent**: replies the user thumbs down, failed or degraded replies, and a 5% sample of other replies (E11).

**De-identification** (done on the server before sending):

| Data | Handling |
|------|----------|
| Phone, mobile, fax, email | Matched by pattern and replaced with `[電話]` (phone), `[Email]` |
| Contact person, address | The `contact_person` and `address` fields returned by tools are always replaced with `[聯絡人]` (contact), `[地址]` (address); names and addresses in user messages are masked as far as matching rules allow |
| Company and product names, document numbers | Kept (business data, and needed to reproduce cases) |

**Preconditions**: thumbs up / down on replies (frontend); terms of use covering "conversation logs are used to improve the service" (TPM to confirm). The de-identification rules need deterministic tests.

## 6. Implementation steps

| # | Work | Depends on |
|---|------|------------|
| 1 | ✅ TPM fills in real utterances ([QUERY_AGENT_EVAL_UTTERANCES.md](./QUERY_AGENT_EVAL_UTTERANCES.md)) (2026-10-14) | — |
| 2 | ✅ Eval code: read §3-format cases from the Langfuse Dataset, export snapshots, new scoring (§4.1; LLM scoring is step 6) and diagnostic report (§4.2), database consistency check (§5.3) (2026-10-14) | — |
| 3 | ✅ Rewrite old cases in the §3 format, removing process checks and fixing wrong expectations (2026-10-14): 31 cases written to Langfuse (updated by ID), the no-longer-existing `p-warehouse-no-customers` archived; the confirmation card text in `fake-api.ts` now matches the database's summary functions. First run in the new format: `20261014T1502-v3-step3-rewritten-cases` | 2 |
| 4 | ✅ Turn real utterances into cases; add the customers, products and documents they mention to the fake data (2026-10-14): 71 cases (`real-*`), fake data `fixtures/real.json`; 102 cases in total. Filling in missing categories per the §4.2 matrix is left until new tools are built | 1, 2 |
| 5 | ✅ Move prompts to Langfuse: production reads by label with caching, in-code fallback prompts, `--prompt-label` (2026-10-15): v1 of 7 prompts (= the version from eval `20261014T1630-phase1-agent-fixes`) labeled `production`; Cloud Run doesn't have `LANGFUSE_*` set yet, so production still uses the in-code version until it does | — |
| 6 | 🔧 Write rubrics per §3.4, build the LLM evaluator and annotation queue: the evaluator is done (2026-10-15, `evals/judge.ts`, run by the eval code and uploaded as the `policy_judge` score; it doesn't use the evaluator on the Langfuse website, because only the eval code can run the whole Agent flow); the annotation queue `policy-calibration` holds 50 items (2026-10-16, [QUERY_AGENT_LANGFUSE.md](./QUERY_AGENT_LANGFUSE.md) §2.5). **Paused (2026-10-20)**: the replies in the queue are stitched-together sub-agent replies; refill it from a new baseline after §8 is done, and write the labeling guide first (§8.5) | 3, §8 |
| 7 | Run a new baseline with the current version so the TPM can see the gap between the current state and the policy | 3, 4, 6 |
| 8 | Update current-state documents (`QUERY_AGENT_EVALS.md`, `EVALS.md`, CLAUDE.md) | 7 |
| 9 | Production trace feedback (§5.4): thumbs up / down, de-identification, sending to Langfuse | TPM confirms the terms of use |

## 7. Open questions

None (§8.3 is decided).

## 8. Architecture change: merge sub-agent results into one reply (2026-10-20)

### 8.1 The problem found

While labeling `policy-calibration` (user, 2026-10-20), we found: the current flow is router → one or more sub-agents → reply. Each sub-agent writes its own section of the reply to the user, and when dispatched to several sub-agents, `router.ts` joins the sections directly as 「**📋 客戶與訂單** … --- **🧵 產品** …」 (customers and orders … products …). No step sees all the results before answering, so:

- No cross-flow reasoning: for example, "is there enough fabric to ship this order" needs the order and inventory results judged together, but each side now just speaks for itself
- Replies contradict each other or are redundant: one sub-agent creates a draft while another says "can't handle this request" (eval `20261016T0455-sdk-baseline` cases `real-purchase-07`, `real-receiving-01`; [AGENT.md](../AGENT.md) known issue 3)
- Labels and the LLM judge assess the stitched result: most would be judged partly or non-compliant because of the stitching; once the architecture changes, those errors disappear, and calibration would have learned errors that no longer exist

### 8.2 Target flow

```
User message
   ▼
Router: decides which sub-agents are needed and gives each one its task
   ▼
Sub-agents (in parallel): call tools to look things up and create drafts; return the facts found and drafts created, without speaking to the user directly
   ▼
Summary: sees the user's original message, the conversation history, and all sub-agent results and drafts, and writes one reply following the reply policy (TPM §3.4)
   ▼
User
```

Rules that don't change:

- Writes still only create drafts, written only when the user presses the confirmation card; the summary step has no tools and can't create or change drafts
- The summary reply can't mention drafts that don't exist (the existing `validate` rule) and shows no IDs (`redactIds`)
- When a sub-agent fails, the summary answers from the other sub-agents' results and says which part wasn't done; when all fail, it replies `AGENT_FAILURE_REPLY`
- The summary step has its own prompt (Langfuse `query-summary`), model fallback list (the `summary` node in `ModelPolicy`) and node in the trace

### 8.3 Decisions (user, 2026-10-20)

| # | Question | Decision |
|---|----------|----------|
| A1 | When the summary runs | **Only when dispatched to 2 or more sub-agents**; with just 1, that sub-agent replies directly |
| A2 | Also compare against a single Agent? | **Compare**: run the eval on both router + summary and a single Agent (one Agent with every authorized tool), and decide by completion, latency and cost |
| A3 | Sub-agents' return format | **Structured**: the part it handled, the report (facts found, missing required fields), drafts created (confirmation card content, collected by code), errors returned by tools (collected by code) |

Implementation (2026-10-20): `mcp-server/src/agent/summary.ts` (prompt `query-summary`, model node `summary`); when work is split, the sub-agent prompt gets `FOR_SUMMARY_NOTE` (`sub-agents.ts`) and reports by "facts found / missing required fields / errors". When every summary model fails, it shows each sub-agent's report instead (the old stitching), keeping drafts already created.

### 8.4 Verification

- `bun run test`: deterministic tests for the summary (several sub-agent results combined into one reply, a sub-agent failing, no claiming nonexistent drafts)
- Eval: compare with the baseline `20261016T0455-sdk-baseline`; multi-sub-agent cases are expected to improve, with no regressions; thresholds as in §4
- `verify-query-ui.py` (the `/query` response format is unchanged)

### 8.5 Resuming step 6 afterwards

1. Run a new baseline with the new architecture
2. Write a labeling guide: for each situation category, explain how to judge 符合 / 部分符合 / 不符合 (compliant / partly / non-compliant), with examples from the new baseline's replies for each; written in [QUERY_AGENT_EVALS.md](../QUERY_AGENT_EVALS.md) §3.2
3. Clear the old architecture's 50 items from `policy-calibration` and refill from the new baseline
4. The user labels following the guide, then calibration proceeds ([QUERY_AGENT_LANGFUSE.md](./QUERY_AGENT_LANGFUSE.md) §2.5)

### 8.6 Steps

| # | Work | Depends on |
|---|------|------------|
| 1 | ✅ User decides A1–A3 (2026-10-20) | — |
| 2 | ✅ Sub-agents now return results; added the summary step, the `query-summary` prompt, the `summary` model node and trace (2026-10-20) | 1 |
| 3 | Deterministic tests; eval comparison (both architectures run, per A2) | 2 |
| 4 | Update current-state documents ([AGENT.md](../AGENT.md), [QUERY_AGENT_EVALS.md](../QUERY_AGENT_EVALS.md)) | 3 |
| 5 | §8.5 | 4 |
