# Query Agent Eval：執行、指標與實驗紀錄

> 2026-10-09 起適用。eval harness 的設計見 [QUERY_AGENT_PHASE0.md](./QUERY_AGENT_PHASE0.md) §4.7；P0-7 的架構比較見 [QUERY_AGENT_ARCHITECTURE_EVAL.md](./QUERY_AGENT_ARCHITECTURE_EVAL.md)；TPM 決定的項目見 [QUERY_AGENT_TPM_ALIGNMENT.md](./QUERY_AGENT_TPM_ALIGNMENT.md) §3.5。

每次修改 Agent（system prompt、模型、架構、tools、權限）都跑一次 eval。結果會存在本機報告，同時上傳到 Langfuse 供比較；全部案例的執行會在 §5 加一列，由 TPM 填寫決定。

## 1. 執行

在 `mcp-server/` 執行：

```bash
bun run eval -- --label <改了什麼>                                    # 正式環境的設定
bun run eval -- --config evals/configs/<設定>.json --label <名稱>     # 比較另一種架構或模型
bun run eval -- --filter q- --runs 1                                  # 只跑部分案例（不寫入 §5，也不會被當成基準）
```

| 參數 | 說明 |
|------|------|
| `--config` | `evals/configs/*.json`：`arch`（`router`／`single`）與 `models`（各節點的模型，見 §4）。沒寫的欄位用正式環境的設定 |
| `--arch`、`--primary` | 快速切換架構，或把某個模型放到每個節點的第一順位 |
| `--compare <報告 ID>` | 指定比較基準。預設為「同架構、各節點主模型相同」的最近一次完整執行；找不到時用最近一次完整執行 |
| `--no-langfuse` | 不上傳 Langfuse |
| `--runs`、`--min-pass` | 每案執行次數（預設 3）、案例通過門檻（預設 66%，即 3 次中 2 次） |

會呼叫真的模型，會產生費用：一次完整執行（29 案 × 3 次）在 flash-lite 約 US$0.04，在 flash 約 US$0.09。

**輸出**

- 終端機：各項指標、門檻是否通過、與基準相比退步（✅ → ❌）和修好的案例、Langfuse 連結
- `mcp-server/evals/reports/<報告 ID>.md`／`.json`：本機報告（JSON 不含模型的輸入輸出，避免檔案過大；完整內容在 Langfuse）
- Langfuse：見 §3
- 本文件 §5：新增一列（只有完整執行）

結束代碼為 1 的情況：任何非 known_gap 的案例未達案例通過門檻，或任何一項 §2 的門檻未通過。

**把舊報告上傳到 Langfuse**：`bun run eval:upload -- --all`（或指定報告檔）。2026-10-09 以前的報告沒有記錄各次模型呼叫，所以在 Langfuse 只有總 token、沒有花費和各節點的延遲。同一份報告重複上傳會更新原本的資料，不會重複。

**環境變數**（`mcp-server/.env`）：`OPENROUTER_API_KEY`，以及 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`（目前為 EU 區 `https://cloud.langfuse.com`）。沒有 Langfuse 金鑰時只寫本機報告。

## 2. 指標與門檻

### 2.1 指標

計算時不含 known_gap 案例。「一次執行」指一個案例的一次回覆。

| 指標 | 定義 |
|------|------|
| 任務完成率 | 所有檢查都通過的執行 ÷ 全部執行 |
| Tool 選擇正確率 | 有 tool 相關檢查的執行中，tool 檢查全部通過的比例 |
| Router 分派正確率 | 有「routes to」檢查的執行中，分派正確的比例（只有 router 架構） |
| 錯誤率／降級率 | 請求拋出例外的比例／至少一個模型失敗而改用下一個模型的比例 |
| 每個完成任務的花費 | 全部模型呼叫的實際花費（含 Router、失敗後降級、沒通過的執行）÷ 通過的執行數。花費取自 OpenRouter 回傳的 `usage.cost` |
| 延遲 | 整個請求的時間，平均、P50、P90、最大值；另外分節點列出（router、agent:commercial、agent:supply_chain） |
| 類別通過率 | 依案例檔分類：query、write、permissions、regressions、paraphrase |

### 2.2 門檻（TPM 決定，2026-10-09）

| 門檻 | 要求 |
|------|------|
| 整體任務完成率 | ≥ 85% |
| Router 分派正確率 | ≥ 95%（single 架構不適用） |
| 權限類案例（permissions） | 100% |
| 寫入類案例（write） | 100% |

門檻定義在 `mcp-server/evals/report.ts` 的 `GATES`；修改門檻時兩處一起改。

**不退步規則**（[CLAUDE.md](../CLAUDE.md)）：基準中 ✅ 的案例，這次不能變成 ❌。報告的「與基準比較」會列出退步的案例與兩次執行的設定差異（架構、各節點模型、prompt／tools／案例／假資料的 hash、git commit）。

## 3. 在 Langfuse 看結果

專案：Langfuse Cloud（EU）→ **Datasets → `query-agent` → Experiments**。

| Langfuse 中的位置 | 內容 |
|-------------------|------|
| Dataset `query-agent` | 與 `evals/cases/*.json` 同步的案例：輸入（訊息、對話歷史、角色、假資料）、預期結果（檢查項目） |
| Experiment | 一次 eval 執行，名稱為報告 ID；metadata 有架構、各節點模型、hash、git commit |
| Experiment 中的每一列 | 一個案例的 trace：底下有每次執行 → 每個節點的模型嘗試 → 每次模型呼叫（generation，含模型、token、花費、上游 provider、輸入輸出）與 tool 呼叫 |
| 分數 | `pass_rate`（0–1，評語列出沒通過的檢查）、`passed`（是否達案例通過門檻；known_gap 案例沒有） |

**比較兩次執行**：在 Experiments 頁勾選兩個以上的執行，即可逐案並排比較分數、花費與延遲。

eval 的 trace 環境為 `sdk-experiment`，與之後正式環境的 trace 分開篩選。

**要記錄的看法**：對單一案例的看法寫在該案例 trace 的留言（Langfuse 的留言只能加在 trace 或 observation 上，不能加在整個 experiment 上）；對整次執行的決定寫在本文件 §5。

## 4. 比較不同設定

各節點的模型由 `ModelPolicy` 決定：`router`、`agent:commercial`、`agent:supply_chain`、`agent:all`（single 架構），每個節點是一串模型 ID，第一個是主模型，其餘依序為降級模型；沒有單獨設定的節點使用 `default`。

- **正式環境**：`mcp-server/src/agent/ai-gateway.ts` 的 `MODEL_POLICY`。只在 eval 比較後修改，並在 §5 記錄決定
- **比較用**：`mcp-server/evals/configs/*.json`，例如 `router-lite-agents-flash.json`（Router 用 flash-lite、子 Agent 用 flash）

```json
{
  "arch": "router",
  "models": {
    "default": ["google/gemini-2.5-flash-lite", "google/gemini-2.5-flash", "anthropic/claude-haiku-4.5"],
    "agent:commercial": ["google/gemini-2.5-flash", "google/gemini-2.5-flash-lite", "anthropic/claude-haiku-4.5"]
  }
}
```

## 5. 實驗紀錄

每次完整執行由 `bun run eval` 自動加一列；**決定**欄由 TPM 填寫（例如：採用、不採用與原因、需要再測）。2026-10-07 的 P0-7 比較與決定見 [QUERY_AGENT_ARCHITECTURE_EVAL.md](./QUERY_AGENT_ARCHITECTURE_EVAL.md)。

| 報告 | 架構與各節點主模型 | 任務完成率 | 每個完成任務 | P90 延遲 | 門檻 | 對基準退步 | 決定 |
|------|------------------|-----------|-------------|---------|------|-----------|------|
| `20261008T1642-baseline-langfuse` | router；router、commercial、supply_chain: gemini-2.5-flash-lite | 86% | US$0.00050 | 14.8s | ✅ | 無 |  |
| `20261008T1646-router-lite-agents-flash` | router；router: gemini-2.5-flash-lite；commercial、supply_chain: gemini-2.5-flash | 87% | US$0.00123 | 17.9s | ✅ | `q-no-id-leak` |  |
| `20261009T0540-phase1-step1-api-writes` | router；router、commercial、supply_chain: gemini-2.5-flash-lite | 80% | US$0.00065 | 8.0s | ❌ 整體任務完成率、寫入類案例 | `pp-inventory`、`q-no-id-leak`、`r-entity-memory` |  |
| `20261009T0546-phase1-step1-api-writes-v2` | router；router、commercial、supply_chain: gemini-2.5-flash-lite | 74% | US$0.00088 | 8.4s | ❌ 整體任務完成率、寫入類案例 | `pp-create-order`、`pp-multi-turn-answer`、`w-create-order` |  |
| `20261009T0549-phase1-step1-api-writes-v3` | router；router、commercial、supply_chain: gemini-2.5-flash-lite | 83% | US$0.00064 | 10.0s | ❌ 整體任務完成率、寫入類案例 | 無 |  |
