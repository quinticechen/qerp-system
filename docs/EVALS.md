# Eval 服務

> 現況文件（2026-10-09），由 **AI Session** 維護。完整的執行方式、指標與實驗紀錄見 [QUERY_AGENT_EVALS.md](./QUERY_AGENT_EVALS.md)。

| 項目 | 說明 |
|------|------|
| 目的 | 每次修改 Agent（prompt、模型、架構、tools、權限）都重跑，確認沒有退步 |
| 執行 | 在 `mcp-server/`：`bun run eval -- --label <改了什麼>`；`--config evals/configs/<設定>.json` 比較其他架構或模型 |
| 案例 | `mcp-server/evals/cases/*.json`：查詢、改寫說法、權限、寫入、回歸 |
| 資料 | 以記憶體中的假資料庫（`evals/fake-supabase.ts`）執行，呼叫真的模型；不會經過正式資料庫與 RLS |
| 報告 | `mcp-server/evals/reports/` 存本機報告；`bun run eval:upload` 上傳到 Langfuse 比較實驗 |
| 通過標準 | 不退步：上一次完整執行中通過的案例必須仍通過（CLAUDE.md） |
| 確定性測試 | `bun run test`：tools、權限、組織隔離等不需模型的測試 |
