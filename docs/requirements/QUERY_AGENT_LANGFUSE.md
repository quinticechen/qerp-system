# Query Agent: Full Use of Langfuse's Evaluation Features

> Status: in progress (2026-10-16). Owner: AI Session.
> Follows [QUERY_AGENT_EVAL_REDESIGN.md](./QUERY_AGENT_EVAL_REDESIGN.md) (cases, scoring and prompt labels are done). Based on the recommended practices in Langfuse's official docs and the Langfuse skill (`langfuse/skills`).
> Update on completion: [QUERY_AGENT_EVALS.md](../QUERY_AGENT_EVALS.md), [EVALS.md](../EVALS.md), [AGENT.md](../AGENT.md), [SERVICES.md](../SERVICES.md), CLAUDE.md.

## 1. Decisions (user, 2026-10-16)

| # | Question | Decision |
|---|----------|----------|
| L1 | Keep our own REST upload, or switch to the official SDK | **Official JS/TS SDK v6** (`@langfuse/client`, `@langfuse/tracing`, `@langfuse/otel`, pinned). The eval moves to the SDK's experiment runner; production tracing uses the same stack |
| L2 | Send production conversations to Langfuse? | **Yes**, with thumbs up/down added. Per E8: after de-identification, send only failed requests and a 5% sample; conversations the user thumbs down are sent afterwards. Precondition: the terms of use cover "conversation logs are used to improve the service" (user to confirm) |
| L3 | Where the LLM judge runs | **A Langfuse-managed evaluator**: the judge prompt lives in Prompt Management and is enabled once it reaches about 85% agreement on a labeled calibration dataset; it scores both the eval and production. The user needs to create an LLM connection in Langfuse |
| L4 | Hook the eval into CI? | **Manual trigger only**: GitHub Actions `workflow_dispatch`, runs only when the button is pressed, never blocks merges |

## 2. Design

### 2.1 Tracing (shared by the eval and production)

- `src/agent/langfuse.ts`: starts OpenTelemetry (`NodeSDK` + `LangfuseSpanProcessor`) and provides a shared `LangfuseClient`
- Every model call by the Agent turns on the AI SDK's `experimental_telemetry`, which Langfuse records automatically as a generation (model, tokens, cost, input and output); the metadata carries `langfusePrompt`, linking the generation to the prompt version that produced it
- Each `/query` is one trace: `userId`, `sessionId` (the Query conversation), tags (the sub-agents routed to), `environment` (`production` / `sdk-experiment`)
- **De-identification** (production): phone, mobile, fax and email are replaced by pattern with `[電話]` and `[Email]`; the `contact_person` and `address` fields returned by tools become `[聯絡人]` and `[地址]`. Company names, product names and document numbers are kept
  - Implementation (2026-10-16): the SDK's `mask` only handles Langfuse's own attributes, and the AI SDK's `ai.*` attributes (model input/output, tool results) don't pass through it, so masking happens instead in the sampling SpanProcessor, over every text attribute of every span
  - The model restates contact persons and addresses in its replies (for example 「陳大文 - 0912-…」), where there is no field name to recognize; so when a request ends, all `contact_person` and `address` values seen in its spans are collected and replaced across all of that request's spans (verified on 2026-10-16 with traces from fake data: the sent trace contained no contact names or phone numbers)
- **Sampling** (production): all of a request's spans are buffered, and when the request ends it decides whether to send: failed or degraded → send; otherwise 5% by trace id. The eval sends everything
- **Trace id**: derived from `query_traces.id` (`createTraceId`), so later backfills and scores land on the same trace

### 2.2 Prompts

- `src/agent/prompts.ts` switches to `langfuse.prompt.get(name, { label, fallback, cacheTtlSeconds })`: the SDK's built-in cache and fallback text replace our own REST code
- The rules are unchanged: production reads `production`; `QUERY_PROMPT_LABEL=code` uses the in-code text; the eval defaults to the in-code text, and `--prompt-label` picks a label

### 2.3 Eval (experiment)

- `evals/run.ts` switches to `dataset.runExperiment` (or `langfuse.experiment.run` with the snapshot): the task calls the Agent; item evaluators output `rules`, `outcome`, `latency_ms`; run-level evaluators output the thresholds for task completion, rules, write cases, no-permission cases and latency
- The local report, baseline comparison, experiment log (QUERY_AGENT_EVALS.md §5) and database consistency check are kept
- Create **score configs** before running (named after what they measure), and every score carries a config: `pass_rate`, `rules`, `outcome` (0–1: each case has 3 runs, recording the fraction passed), `passed` (Boolean), `latency_ms`, `policy_judge` (in-code judge, 0–1); run-level `task_completion` (0–1), `gates_passed` (Boolean); `policy-compliance` (Categorical: 符合 / 部分符合 / 不符合 — compliant / partly compliant / non-compliant), `user-feedback` (Boolean)
- One trace per case, with each run as `run N` inside it (input: situation, policy, conversation; output: reply, draft), so labeling and judging work on "one reply" at a time

### 2.4 User feedback (L2)

- Each Query reply has thumbs up / down beneath it (icon buttons), stored in `query_messages.metadata.feedback` and written to that reply's trace as a `user-feedback` (Boolean) score
- If a thumbs-down reply was not sampled, the backend rebuilds its trace from `query_traces` and the conversation (de-identified) and sends it; a rebuilt trace has no tool results from which to find contact persons and addresses, so it masks the contact persons and addresses of every customer and factory in the organization. If Langfuse already has the trace, it is not rebuilt
- `query_messages` has no UPDATE policy (users can't edit messages), so `feedback` is written by `private.set_query_message_feedback()` (only for the user's own AI replies; `public` is the wrapper): migration `20261016060000_query_message_feedback.sql`, test `supabase/tests/query_message_feedback.test.sql`
- Backend endpoint: `POST /query/messages/:id/feedback` (JWT, own messages only)

### 2.5 LLM judge (L3)

Following Langfuse's judge calibration process:

1. Create the score config `policy-compliance` and the annotation queue `policy-calibration`
2. Pick representative eval replies for each situation category (about 50) into the annotation queue, for the user to label
3. Calibration dataset `judge-calibration/policy-compliance` (labels as the expected output); the judge prompt is stored as `judge-calibration/policy-compliance`
4. Run the judge prompt as an SDK experiment, compared by the evaluator `policy-compliance-judge-output-correct`; it is usable only when both overall and every category reach about 85%
5. After the user approves, create an LLM-as-a-Judge evaluator in Langfuse (needs an LLM connection) and apply it to eval and production traces
6. Until calibration is done, `evals/judge.ts` scores are recorded only and don't count toward the thresholds

### 2.6 CI (L4)

`.github/workflows/query-agent-eval.yml`: `workflow_dispatch`, with inputs label, prompt label and runs; runs the tests and eval in `mcp-server/` and uploads the report as an artifact. Secrets needed: `OPENROUTER_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VERIFY_EMAIL`, `VERIFY_PASSWORD` (database consistency check)

## 3. Steps

| # | Work | Depends on | Status |
|---|------|------------|--------|
| 1 | Install the SDK (pinned) | — | ✅ 2026-10-16 |
| 2 | `langfuse.ts`: OpenTelemetry, de-identification, tail sampling; telemetry on in the Agent; prompts via the SDK, linked to generations | 1 | ✅ 2026-10-16 |
| 3 | Eval on SDK experiments; score configs | 2 | ✅ 2026-10-16 (score configs created in Langfuse) |
| 4 | Thumbs up/down: frontend, endpoint, score, thumbs-down backfill | 2 | ✅ 2026-10-16 (migration awaiting the user to apply) |
| 5 | LLM judge: score config, annotation queue, calibration dataset, judge prompt, calibration experiment | 3; user labels; LLM connection | Code and judge prompt v1 (`candidate`) ✅ 2026-10-16; queue filled with 50 items (2026-10-16); **labeling paused** until the architecture change in [QUERY_AGENT_EVAL_REDESIGN.md](./QUERY_AGENT_EVAL_REDESIGN.md) §8, then refilled (2026-10-20) |
| 6 | GitHub Actions (manual trigger) | 3; GitHub secrets | ✅ 2026-10-16 (secrets awaiting the user) |
| 7 | New baseline; find the cause of the 91% → 83% regression ([AGENT.md](../AGENT.md)) | 3 | New baseline `20261016T0455-sdk-baseline`: 85% ✅ 2026-10-16. Cause found (same prompts and cases; the regression came from tool definitions: asking about optional fields, shelf-name parsing, dispatch to several sub-agents); the fixes are handled separately |
| 8 | Update current-state documents | 2–7 | ✅ 2026-10-16 |

## 4. For the user to do

- Run `supabase/tests/run.sql` in the SQL Editor (includes the migration, rolled back) and confirm `ALL TESTS PASSED`, then apply `supabase/migrations/20261016060000_query_message_feedback.sql`; until it is applied, thumbs up/down shows 「回饋沒有送出」 (feedback not sent)
- Add a connection under Langfuse → Settings → LLM Connections (for example OpenRouter) so the LLM judge can run in Langfuse
- Label about 50 replies in the annotation queue (whether they follow the reply policy)
- GitHub repository secrets (§2.6)
- Confirm the terms of use cover using conversation logs to improve the service (the precondition for L2)
