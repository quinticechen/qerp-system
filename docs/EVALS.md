# Eval 服務

> 現況文件（2026-10-16），由 **AI Session** 維護。完整的執行方式、指標與實驗紀錄見 [QUERY_AGENT_EVALS.md](./QUERY_AGENT_EVALS.md)。

| 項目 | 說明 |
|------|------|
| 目的 | 每次修改 Agent（prompt、模型、架構、tools、權限）都重跑，確認沒有退步 |
| 執行 | 在 `mcp-server/`：`bun run eval -- --label <改了什麼>`；`--config evals/configs/<設定>.json` 比較其他架構或模型 |
| 案例 | Langfuse Dataset `query-agent`（案例的來源，可在網頁上編輯）；每次執行存一份快照到 `mcp-server/evals/snapshots/` |
| 資料 | 以記憶體中的假資料庫（`evals/fake-supabase.ts`）執行，呼叫真的模型；執行前先檢查假資料與模擬的 API 是否與資料庫一致（`evals/db-check.ts`） |
| 報告 | 每次執行是 Langfuse 的一次 experiment（官方 SDK 的 experiment runner），分數都帶 score config；`mcp-server/evals/reports/` 另存本機報告 |
| GitHub | Actions 的「Query Agent Eval」，只手動觸發，不擋合併（`.github/workflows/query-agent-eval.yml`） |
| LLM 評審 | 以人工標註校準（標註佇列 `policy-calibration`、資料集與 prompt `judge-calibration/policy-compliance`，`bun run judge`）；約 85% 一致後由 Langfuse 管理的評分器評 eval 與正式環境。校準前只記錄 |
| 評分 | 看結果：草稿與回答中的事實，加上不可違反的規則；呼叫了哪些工具只作為診斷 |
| 通過標準 | 不退步：上一次完整執行中通過的案例必須仍通過（CLAUDE.md）；門檻見 QUERY_AGENT_EVALS.md §2.3 |
| 確定性測試 | `bun run test`：tools、權限、組織隔離等不需模型的測試 |
