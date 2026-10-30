# Eval Service

> Current-state document (2026-10-16), maintained by the **AI Session**. For full instructions, metrics and the experiment log, see [QUERY_AGENT_EVALS.md](./QUERY_AGENT_EVALS.md).

| Item | Description |
|------|-------------|
| Purpose | Rerun after every change to the Agent (prompt, model, architecture, tools, permissions) to confirm nothing regressed |
| Running | In `mcp-server/`: `bun run eval -- --label <what changed>`; `--config evals/configs/<config>.json` to compare other architectures or models |
| Cases | Langfuse Dataset `query-agent` (the source of the cases, editable on the web); each run saves a snapshot to `mcp-server/evals/snapshots/` |
| Data | Runs against an in-memory fake database (`evals/fake-supabase.ts`) and calls real models; before running, it checks that the fake data and simulated APIs match the database (`evals/db-check.ts`) |
| Reports | Each run is one Langfuse experiment (the official SDK's experiment runner), and every score carries a score config; a local report is also saved to `mcp-server/evals/reports/` |
| GitHub | The "Query Agent Eval" Action, triggered manually only; it does not block merges (`.github/workflows/query-agent-eval.yml`) |
| LLM judge | Calibrated against human labels (annotation queue `policy-calibration`, dataset and prompt `judge-calibration/policy-compliance`, `bun run judge`); once agreement reaches about 85%, a Langfuse-managed evaluator scores the eval and production. Until calibrated, its score is recorded only |
| Scoring | Based on outcomes: the draft and the facts in the reply, plus rules that must never be broken; which tools were called is diagnostic only |
| Pass bar | No regression: cases that passed in the previous full run must still pass (CLAUDE.md); thresholds in QUERY_AGENT_EVALS.md §2.3 |
| Deterministic tests | `bun run test`: tests that need no model, such as tools, permissions and organization isolation |
