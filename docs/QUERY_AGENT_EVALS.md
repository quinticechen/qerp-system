# Query Agent Eval: Running, Metrics and Experiment Log

> Applies from 2026-10-14 (scoring is outcome-based, and cases come from a Langfuse Dataset); from 2026-10-16 it runs on the official Langfuse SDK ([QUERY_AGENT_LANGFUSE.md](./requirements/QUERY_AGENT_LANGFUSE.md)). Design and decisions: [requirements/QUERY_AGENT_EVAL_REDESIGN.md](./requirements/QUERY_AGENT_EVAL_REDESIGN.md); situation categories: [QUERY_AGENT_PHASE1.md](./requirements/QUERY_AGENT_PHASE1.md) §4.2; reply policy: [QUERY_AGENT_TPM_ALIGNMENT.md](./requirements/QUERY_AGENT_TPM_ALIGNMENT.md) §3.4; the P0-7 architecture comparison: [QUERY_AGENT_ARCHITECTURE_EVAL.md](./requirements/QUERY_AGENT_ARCHITECTURE_EVAL.md).

Run the eval after every change to the Agent (system prompt, models, architecture, tools, permissions). Each run is one Langfuse experiment (the SDK's experiment runner; traces and scores are sent during the run), and a local report is saved too; a run over all cases adds a row to §5, where the TPM fills in the decision.

## 1. Running

From `mcp-server/`:

```bash
bun run eval -- --label <what changed>                                # production settings
bun run eval -- --config evals/configs/<config>.json --label <name>   # compare another architecture or model
bun run eval -- --filter order- --runs 1                              # run only some cases (not written to §5, never used as a baseline)
```

Order of execution:

1. **Read cases**: read from the Langfuse Dataset `query-agent` (read-only; the eval never changes the Dataset). Every case must match the format in the requirement document §3; otherwise all problems are listed and the run stops. The cases used are saved as a snapshot `evals/snapshots/<time>-<hash>.json`, reusing the same file when the content hasn't changed.
2. **Database consistency check** (`evals/db-check.ts`): using the test account, confirms that the fake data, the columns the tools query, the API parameters simulated by `fake-api.ts`, status values and `roles.json` all match the current database, and that every error code is documented in [API.md](./API.md) §3. It only sends `limit=0` queries and parameter probes; it reads no data and runs no function. Any mismatch is listed and the run stops.
3. **Run and score**: calls real models, with an in-memory fake data layer (`evals/fake-supabase.ts`, `evals/fake-api.ts`). With Langfuse configured, it runs through `evals/experiment.ts`: first it creates any missing score configs (§3); the runs of each case go in order into the same trace, and cases run in parallel (`--concurrency`, default 4).

| Option | Description |
|--------|-------------|
| `--config` | `evals/configs/*.json`: `arch` (`router` / `single`) and `models` (the models per node, see §4). Fields left out use the production settings |
| `--arch`, `--primary` | Quickly switch architecture, or put one model first at every node |
| `--dataset-version <time>` | Use the Dataset as it was at that time (ISO time, e.g. `2026-10-14T08:00:00Z`), so two runs use the same set of cases |
| `--offline` | Don't connect to Langfuse; use the latest snapshot in `evals/snapshots/` |
| `--snapshot <file>` | Use the given snapshot |
| `--skip-db-check` | Skip the database consistency check; this run won't be written to §5 or used as a baseline |
| `--compare <report ID>` | Choose the baseline. By default, the latest full run that passed the consistency check with "the same architecture and the same primary model at each node"; if none is found, the latest such run. Reports from before 2026-10-14 have a different format and are never used as a baseline |
| `--no-langfuse` | Run locally only, without creating a Langfuse experiment (the report can be uploaded later with `bun run eval:upload`) |
| `--no-judge` | Don't run the LLM scoring (§2.1) |
| `--prompt-label <label>` | Use the Langfuse prompt with that label (for example `candidate`); by default the in-code prompt is used. Fails if it can't be read; the report records each prompt's version. Release process in the requirement document §5.2 |
| `--runs`, `--min-pass` | Runs per case (default 3), case pass threshold (default 66%, i.e. 2 of 3) |

This calls real models and costs money: flash-lite is about US$0.0005 per run, so 100 cases × 3 runs is about US$0.15.

**Output**

- Terminal: every metric, whether the thresholds passed, cases that regressed (✅ → ❌) or were fixed compared with the baseline, and a link to the Langfuse experiment
- `mcp-server/evals/reports/<report ID>.md` / `.json`: the local report (the JSON leaves out model inputs and outputs to keep the file small; the full content is in Langfuse). The JSON's `langfuse.runs` records each run's trace and observation in Langfuse, for the annotation queue (§3.2)
- Langfuse: see §3
- §5 of this document: a new row (only for full runs that passed the consistency check)

The exit code is 1 when: a case's format is invalid, the database doesn't match, any scored case misses the case pass threshold, or any §2 threshold fails.

**Environment variables**: in `mcp-server/.env`, `OPENROUTER_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, plus `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (currently the EU region, `https://cloud.langfuse.com`); in the project root `.env`, the test account `VERIFY_EMAIL`, `VERIFY_PASSWORD` (used by the consistency check).

## 2. Scoring, metrics and thresholds

### 2.1 Whether one run passes

| Layer | Check | Decides pass? |
|-------|-------|---------------|
| Rules | `rule_no_error` (no exception), `rule_no_write` (the Agent loop wrote nothing), `rule_no_id_leak` (no UUID in the reply), `rule_no_false_draft` (no mention of a confirmation card without a draft), `rule_permission` (no tool the role lacks permission for), `rule_latency` (≤ 30 seconds) | Yes, checked for every case |
| Task outcome | When a draft is expected: exactly one draft from that tool, with the fields on the confirmation card matching (compared by name, ignoring whitespace); when no draft is expected: no draft at all; the reply contains every item in `answer_includes` | Yes; cases whose policy is undefined (`policy_status: pending`) are not checked |
| Diagnostics | All expected tools were called, the router dispatched to the expected sub-agent | No, only used to find causes |
| Reply quality | LLM scoring (`evals/judge.ts`, model `anthropic/claude-haiku-4.5`, a different family from the Agent's primary model): by situation category, against the policy in TPM §3.3–§3.4, giving a 0–1 score and a reason | No; recorded only until calibrated against human labels (requirement document §4.3) |

`known_gap` cases and generated cases not yet reviewed (🚧) don't count toward the metrics and thresholds, but must still pass the rules.

### 2.2 Metrics

"One run" means one reply to one case. Apart from "Rules", only scored cases count.

| Metric | Definition |
|--------|------------|
| Task completion | Passed runs ÷ all runs; with a 95% confidence interval (Wilson, using the number of scored cases as the sample size) |
| Rules | Share of runs that passed every rule (including 🚧 cases) |
| Task outcome correct | Among runs with outcome checks, the share where every outcome was correct |
| Write-case completion | Task completion for cases expected to produce a draft |
| Category, domain | Task completion broken down by situation category (PHASE1 §4.2) and domain (customers, orders…) |
| Diagnostics | Tool selection accuracy, router dispatch accuracy, tool confusion table (how often tool B was called when A should have been) |
| Error rate / fallback rate | Share of requests that threw an exception / share where at least one model failed and the next model was used |
| Cost per completed task | The actual cost of all model calls (including the router, fallbacks after failures, and runs that didn't pass) ÷ the number of passed runs. Cost comes from the `usage.cost` returned by OpenRouter |
| Latency | Time for the whole request: mean, P50, P90, max; also listed per node (router, agent:commercial, agent:supply_chain) |

### 2.3 Thresholds

| Threshold | Requirement | Source |
|-----------|-------------|--------|
| Overall task completion | ≥ 85% | TPM (2026-10-09) |
| Rules that must never be broken | 100% | Requirement document §4.1 |
| No-permission cases | 100% | TPM (2026-10-09, formerly "permission cases") |
| Write cases (expected to produce a draft) | 100% | TPM (2026-10-09) |
| Average latency | ≤ 10 seconds | TPM §3.1 |

Router dispatch accuracy (formerly a ≥ 95% threshold) is now a diagnostic metric, not a threshold (requirement document E1). The thresholds are defined in `GATES` in `mcp-server/evals/report.ts`; when changing a threshold, change both places.

**No-regression rule** ([CLAUDE.md](../CLAUDE.md)): a case that was ✅ in the baseline must not become ❌ this time. With about 100 cases, overall completion has a margin of error of about ±7%, so regressions are judged per case. The report's "comparison with baseline" lists the regressed cases and how the two runs' settings differ (architecture, models per node, hashes of prompts / tools / cases / fake data, git commit).

## 3. Viewing results in Langfuse

Project: Langfuse Cloud (EU) → **Datasets → `query-agent`**.

| Where in Langfuse | Content |
|-------------------|---------|
| Dataset `query-agent` | **The source of the cases**: add, edit and archive cases here (format in the requirement document §3). Every change creates a new version |
| One run of the experiment `query-agent` | One eval run; the run name is the report ID and the description is `--label`; the metadata holds the architecture, models per node, hashes, git commit, prompt versions, Dataset version and snapshot |
| Each row in a run | One case's trace (linked to its Dataset item): beneath it, `run 1`, `run 2`… are the individual runs (input: situation, policy and conversation; output: reply and draft), and beneath those one observation per node: `router` and `summary` (and `judge`) as chains, each sub-agent `agent:<group>` (`agent:all` for the single agent) as an agent, so Langfuse draws router → sub-agents → summary. Inside a node are its model attempts, named after the model (`<model>:ai.generateText`; a fallback shows as a second model under the same node), each provider call as a generation (model, tokens, input and output), and the node's tool calls. Traces from before 2026-10-30 lack the node observations: their attempts are named `<node>:ai.generateText` directly under the run. When run with `--prompt-label`, generations link to the prompt version that produced them (the Prompts page shows each version's usage and scores) |
| Scores (per case) | `pass_rate` (share of runs passed; the comment lists the failed rules and outcome checks), `rules`, `outcome` (absent for cases with an undefined policy), `latency_ms` (mean latency), `policy_judge` (mean of the in-code LLM scoring; the comment holds each run's reason), `passed` (whether the case met the case pass threshold; absent for 🚧 cases) |
| Scores (whole run) | `task_completion` (task completion), `gates_passed` (whether every §2.3 threshold passed; the comment lists the failed ones) |
| Score config | Every score carries a config (`SCORE_CONFIGS` in `evals/experiment.ts`; missing ones are created automatically when the eval runs): the items above, plus `policy-compliance` for human labels and the LLM judge (符合 / 部分符合 / 不符合 — compliant / partly compliant / non-compliant) and user feedback `user-feedback` |

**Comparing two runs**: tick two or more runs on the Experiments page to compare scores, cost and latency case by case, side by side.

Eval traces use the environment `sdk-experiment`, production traces use `production` (local development uses `development`), so they can be filtered separately.

**Cost**: the local report's cost is the actual amount returned by OpenRouter; Langfuse computes cost from its model price table, and models missing from it (such as OpenRouter's `anthropic/claude-haiku-4.5`) have no cost — add them under Langfuse → Settings → Models when needed.

**Recording opinions**: write an opinion about a single case as a comment on that case's trace (Langfuse comments can only be added to traces or observations, not to a whole experiment); write the decision about a whole run in §5 of this document.

**Uploading local reports**: reports run with `--no-langfuse` can be uploaded with `bun run eval:upload -- <report file>` (or `--all`) (`evals/langfuse.ts`, uploading directly over OTLP with the same structure as an SDK experiment, but without prompt links or score configs). Only reports from 2026-10-14 onwards are uploaded; case content comes from the snapshot the report recorded.

### 3.1 Running manually on GitHub

GitHub → Actions → **Query Agent Eval** → Run workflow (`.github/workflows/query-agent-eval.yml`). Manual trigger only; it never blocks merges. Inputs: name (`--label`), prompt label (enter `code` for the in-code prompt), runs per case, filter. It runs `npm run test` first, then the eval; the report, snapshot and terminal output are saved as this run's artifact, and the §5 log is not written back to the repo (add it by hand when needed).

Repository secrets needed: `OPENROUTER_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VERIFY_EMAIL`, `VERIFY_PASSWORD`.

### 3.2 Calibrating the LLM judge

Goal: a Langfuse-managed LLM judge (LLM-as-a-Judge) that decides whether a reply follows the reply policy, enabled only after it agrees with human labels about 85% of the time (overall and per situation category). Until calibration is done, the eval's `policy_judge` (`evals/judge.ts`) is recorded only and doesn't count toward the thresholds. Run from `mcp-server/` (`evals/judge-calibration.ts`):

| Step | Command or place | Content |
|------|------------------|---------|
| 1 | `bun run judge -- prompt` | Saves the judge prompt to Prompt Management: `judge-calibration/policy-compliance` (label `candidate`). The variables `{{input}}` (situation, policy and conversation) and `{{output}}` (reply and draft) map to each run's observation |
| 2 | `bun run judge -- queue [--report <report ID>]` | Picks about 50 runs from the latest full experiment (spread across situation categories, mixing passed and failed) into the annotation queue `policy-calibration` |
| 3 | Langfuse → Annotation Queues → `policy-calibration` | Human labeling of `policy-compliance`: 符合 / 部分符合 / 不符合 (compliant / partly / non-compliant), with optional comments |
| 4 | `bun run judge -- dataset` | Turns the labels into the dataset `judge-calibration/policy-compliance` (expected output is the human score; relabeling updates the same item) |
| 5 | `bun run judge -- run [--label candidate]` | Runs one experiment with the judge prompt (`policy-compliance-judge`); each item's `policy-compliance-judge-output-correct` says whether the judge agreed with the human; the terminal lists overall and per-category agreement |
| 6 | Langfuse → Evaluators | Once they agree, the user creates an LLM-as-a-Judge evaluator in Langfuse: using this prompt and the score `policy-compliance`, applied to eval (`sdk-experiment`) and production (`production`) observations. Requires a connection under Settings → LLM Connections first |

If they don't agree, change `JUDGE_PROMPT` in `evals/judge-calibration.ts` and repeat steps 1 and 5.

## 4. Comparing settings

The models per node are set by `ModelPolicy`: `router`, `agent:commercial`, `agent:supply_chain`, `agent:all` (single architecture). Each node is a list of model IDs: the first is the primary model and the rest are fallbacks in order; nodes without their own setting use `default`.

- **Production**: `MODEL_POLICY` in `mcp-server/src/agent/ai-gateway.ts`. Change it only after an eval comparison, and record the decision in §5
- **For comparisons**: `mcp-server/evals/configs/*.json`, for example `router-lite-agents-flash.json` (flash-lite for the router, flash for the sub-agents)

```json
{
  "arch": "router",
  "models": {
    "default": ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash", "anthropic/claude-haiku-4.5"],
    "agent:commercial": ["google/gemini-2.5-flash", "google/gemini-2.5-flash-lite", "anthropic/claude-haiku-4.5"]
  }
}
```

## 5. Experiment log

`bun run eval` adds a row automatically for every full run; the TPM fills in the **Decision** column (for example: adopt, don't adopt and why, needs more testing). The rows are written by the eval script (`logRow` in `mcp-server/evals/report.ts`), so their contents stay in Chinese: 無 = none, 整體任務完成率 = overall task completion, 不可違反的規則 = rules that must never be broken, 寫入類案例（應產生草稿） = write cases (expected to produce a draft). The 2026-10-07 P0-7 comparison and decision are in [QUERY_AGENT_ARCHITECTURE_EVAL.md](./requirements/QUERY_AGENT_ARCHITECTURE_EVAL.md).

| Report | Architecture and primary model per node | Task completion | Per completed task | P90 latency | Thresholds | Regressed vs baseline | Decision |
|--------|----------------------------------------|-----------------|--------------------|-------------|------------|-----------------------|----------|
| `20261008T1642-baseline-langfuse` | router；router、commercial、supply_chain: gemini-2.5-flash-lite | 86% | US$0.00050 | 14.8s | ✅ | 無 |  |
| `20261008T1646-router-lite-agents-flash` | router；router: gemini-2.5-flash-lite；commercial、supply_chain: gemini-2.5-flash | 87% | US$0.00123 | 17.9s | ✅ | `q-no-id-leak` |  |
| `20261009T0540-phase1-step1-api-writes` | router；router、commercial、supply_chain: gemini-2.5-flash-lite | 80% | US$0.00065 | 8.0s | ❌ 整體任務完成率、寫入類案例 | `pp-inventory`、`q-no-id-leak`、`r-entity-memory` |  |
| `20261009T0546-phase1-step1-api-writes-v2` | router；router、commercial、supply_chain: gemini-2.5-flash-lite | 74% | US$0.00088 | 8.4s | ❌ 整體任務完成率、寫入類案例 | `pp-create-order`、`pp-multi-turn-answer`、`w-create-order` |  |
| `20261009T0549-phase1-step1-api-writes-v3` | router；router、commercial、supply_chain: gemini-2.5-flash-lite | 83% | US$0.00064 | 10.0s | ❌ 整體任務完成率、寫入類案例 | 無 |  |
| `20261014T1502-v3-step3-rewritten-cases` | router；router、commercial、supply_chain: gemini-2.5-flash-lite | 77% | US$0.00044 | 7.6s | ❌ 整體任務完成率、寫入類案例（應產生草稿） | — |  |
| `20261014T1544-v3-step4-real-utterances` | router；router、commercial、supply_chain: gemini-2.5-flash-lite | 71% | US$0.00044 | 11.5s | ❌ 整體任務完成率、不可違反的規則、寫入類案例（應產生草稿） | 無 |  |
| `20261014T1611-phase1-all-tools` | router；router、commercial、supply_chain、warehouse、catalog、facilities: gemini-2.5-flash-lite | 67% | US$0.00339 | 14.3s | ❌ 整體任務完成率、不可違反的規則、寫入類案例（應產生草稿） | `pp-low-stock`、`q-inventory-search`、`r-entity-memory`、`real-cross-01`、`real-factory-03` |  |
| `20261014T1630-phase1-agent-fixes` | router；router、commercial、supply_chain、warehouse、catalog、facilities: gemini-2.5-flash-lite | 91% | US$0.00062 | 8.4s | ❌ 不可違反的規則、寫入類案例（應產生草稿） | `real-shipping-07` |  |
| `20261015T0047-phase1-agent-fixes-2` | router；router、commercial、supply_chain、warehouse、catalog、facilities: gemini-2.5-flash-lite | 87% | US$0.00084 | 16.2s | ❌ 不可違反的規則、寫入類案例（應產生草稿） | `pp-inventory`、`q-inventory-search`、`q-no-id-leak`、`real-inventory-08`、`real-order-04`、`real-product-03`、`real-purchase-07` |  |
| `20261015T0106-search-and-prompt-fixes` | router；router、commercial、supply_chain、warehouse、catalog、facilities: gemini-2.5-flash-lite | 84% | US$0.00086 | 16.1s | ❌ 整體任務完成率、寫入類案例（應產生草稿） | `pp-multi-turn-answer`、`r-entity-memory`、`r-multi-turn-order`、`real-cross-02`、`real-order-01`、`real-purchase-05`、`real-receiving-01`、`real-receiving-04`、`real-receiving-05` |  |
| `20261015T0119-v1-prompts-current-tools` | router；router、commercial、supply_chain、warehouse、catalog、facilities: gemini-2.5-flash-lite | 83% | US$0.00078 | 15.4s | ❌ 整體任務完成率、不可違反的規則、寫入類案例（應產生草稿） | `pp-unpaid`、`real-customer-03`、`real-customer-04`、`real-inventory-06`、`real-product-01`、`real-purchase-09`、`real-receiving-07`、`real-shelf-01` |  |
| `20261016T0455-sdk-baseline` | router；router、commercial、supply_chain、warehouse、catalog、facilities: gemini-2.5-flash-lite | 85% | US$0.00058 | 14.8s | ❌ 整體任務完成率、不可違反的規則、寫入類案例（應產生草稿） | `real-other-01`、`real-product-03`、`real-purchase-07`、`real-receiving-01` |  |
| `20261030T1006-router-summary` | router；router、commercial、supply_chain、warehouse、catalog、facilities、summary: gemini-2.5-flash-lite | 93% | US$0.00097 | 5.9s | ❌ 不可違反的規則、寫入類案例（應產生草稿） | `real-inventory-01`、`real-order-07`、`real-purchase-05`、`real-receiving-04` |  |
| `20261030T1012-single-agent` | single；all: gemini-2.5-flash-lite | 88% | US$0.00087 | 5.4s | ❌ 寫入類案例（應產生草稿） | `real-customer-03`、`real-factory-03`、`real-order-07`、`real-purchase-05` |  |
| `20261030T1454-trace-nodes-renamed-customers` | router；router、commercial、supply_chain、warehouse、catalog、facilities、summary: gemini-2.5-flash-lite | 91% | US$0.00105 | 6.0s | ❌ 不可違反的規則、寫入類案例（應產生草稿） | `real-other-03`、`real-shelf-01`、`w-cross-domain-order` |  |
