# Query Agent Eval：執行、指標與實驗紀錄

> 2026-10-14 起適用（評分改為看結果，案例改由 Langfuse Dataset 提供）；2026-10-16 起以 Langfuse 官方 SDK 執行（[QUERY_AGENT_LANGFUSE.md](./requirements/QUERY_AGENT_LANGFUSE.md)）。設計與決策見 [requirements/QUERY_AGENT_EVAL_REDESIGN.md](./requirements/QUERY_AGENT_EVAL_REDESIGN.md)；情境類別見 [QUERY_AGENT_PHASE1.md](./requirements/QUERY_AGENT_PHASE1.md) §4.2；回覆政策見 [QUERY_AGENT_TPM_ALIGNMENT.md](./requirements/QUERY_AGENT_TPM_ALIGNMENT.md) §3.4；P0-7 的架構比較見 [QUERY_AGENT_ARCHITECTURE_EVAL.md](./requirements/QUERY_AGENT_ARCHITECTURE_EVAL.md)。

每次修改 Agent（system prompt、模型、架構、tools、權限）都跑一次 eval。每次執行是 Langfuse 的一次 experiment（SDK 的 experiment runner，trace 與分數在執行時送出），同時存一份本機報告；全部案例的執行會在 §5 加一列，由 TPM 填寫決定。

## 1. 執行

在 `mcp-server/` 執行：

```bash
bun run eval -- --label <改了什麼>                                    # 正式環境的設定
bun run eval -- --config evals/configs/<設定>.json --label <名稱>     # 比較另一種架構或模型
bun run eval -- --filter order- --runs 1                              # 只跑部分案例（不寫入 §5，也不會被當成基準）
```

執行順序：

1. **讀取案例**：從 Langfuse Dataset `query-agent` 讀取（只讀，eval 不會修改 Dataset）。每個案例都必須符合需求文件 §3 的格式，否則列出所有問題並停止。用到的案例存成快照 `evals/snapshots/<時間>-<hash>.json`，內容沒變時沿用同一份。
2. **資料庫一致性檢查**（`evals/db-check.ts`）：用測試帳號確認假資料、工具查詢的欄位、`fake-api.ts` 模擬的 API 參數、狀態值、`roles.json` 都與目前的資料庫一致，錯誤代碼都寫在 [API.md](./API.md) §3。只送 `limit=0` 的查詢與參數探測，不讀取資料、不執行任何函式。有不一致就列出並停止。
3. **執行與評分**：呼叫真的模型，資料層為記憶體中的假資料（`evals/fake-supabase.ts`、`evals/fake-api.ts`）。設定了 Langfuse 時以 `evals/experiment.ts` 執行：先建立缺少的 score config（§3），每個案例的各次執行依序在同一個 trace 中，案例之間並行（`--concurrency`，預設 4）。

| 參數 | 說明 |
|------|------|
| `--config` | `evals/configs/*.json`：`arch`（`router`／`single`）與 `models`（各節點的模型，見 §4）。沒寫的欄位用正式環境的設定 |
| `--arch`、`--primary` | 快速切換架構，或把某個模型放到每個節點的第一順位 |
| `--dataset-version <時間>` | 使用 Dataset 在該時間點的內容（ISO 時間，例如 `2026-10-14T08:00:00Z`），讓兩次執行用同一批案例 |
| `--offline` | 不連 Langfuse，使用 `evals/snapshots/` 最新的快照 |
| `--snapshot <檔案>` | 使用指定的快照 |
| `--skip-db-check` | 略過資料庫一致性檢查；這次執行不會寫入 §5，也不會被當成基準 |
| `--compare <報告 ID>` | 指定比較基準。預設為「同架構、各節點主模型相同」的最近一次完整、通過一致性檢查的執行；找不到時用最近一次這樣的執行。2026-10-14 以前的報告格式不同，不會被當成基準 |
| `--no-langfuse` | 只在本機執行，不建立 Langfuse experiment（之後可用 `bun run eval:upload` 上傳報告） |
| `--no-judge` | 不執行 LLM 評分（§2.1） |
| `--prompt-label <標籤>` | 使用 Langfuse 上該標籤的 prompt（例如 `candidate`）；預設用程式裡的 prompt。讀不到時直接失敗，報告記錄每個 prompt 的版本。上線流程見需求文件 §5.2 |
| `--runs`、`--min-pass` | 每案執行次數（預設 3）、案例通過門檻（預設 66%，即 3 次中 2 次） |

會呼叫真的模型，會產生費用：flash-lite 每次執行約 US$0.0005，100 個案例 × 3 次約 US$0.15。

**輸出**

- 終端機：各項指標、門檻是否通過、與基準相比退步（✅ → ❌）和修好的案例、Langfuse experiment 的連結
- `mcp-server/evals/reports/<報告 ID>.md`／`.json`：本機報告（JSON 不含模型的輸入輸出，避免檔案過大；完整內容在 Langfuse）。JSON 的 `langfuse.runs` 記錄每次執行在 Langfuse 的 trace 與 observation，供標註佇列使用（§3.2）
- Langfuse：見 §3
- 本文件 §5：新增一列（只有完整、通過一致性檢查的執行）

結束代碼為 1 的情況：案例格式不正確、資料庫不一致、任何計分案例未達案例通過門檻，或任何一項 §2 的門檻未通過。

**環境變數**：`mcp-server/.env` 的 `OPENROUTER_API_KEY`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`，以及 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`（目前為 EU 區 `https://cloud.langfuse.com`）；專案根目錄 `.env` 的測試帳號 `VERIFY_EMAIL`、`VERIFY_PASSWORD`（一致性檢查使用）。

## 2. 評分、指標與門檻

### 2.1 一次執行是否通過

| 層 | 檢查 | 是否決定通過 |
|----|------|--------------|
| 規則 | `rule_no_error`（沒有例外）、`rule_no_write`（Agent 迴圈沒有寫入）、`rule_no_id_leak`（回覆沒有 UUID）、`rule_no_false_draft`（沒有草稿卻提到確認卡片）、`rule_permission`（沒有使用角色無權限的工具）、`rule_latency`（≤ 30 秒） | 是，每個案例都檢查 |
| 任務結果 | 期望草稿時：剛好一張該工具的草稿，且確認卡片上列出的欄位相符（以名稱比對，忽略空白）；沒有期望草稿時：沒有任何草稿；回覆包含 `answer_includes` 的每一項 | 是；政策未定義（`policy_status: pending`）的案例不檢查 |
| 診斷 | 預期的工具都有呼叫、Router 分派到預期的子 Agent | 否，只用於找出原因 |
| 回覆品質 | LLM 評分（`evals/judge.ts`，模型 `anthropic/claude-haiku-4.5`，與 Agent 的主模型不同家族）：依情境類別對應 TPM §3.3–§3.4 的政策，給 0–1 分與理由 | 否，以人工標註校準前只記錄（需求文件 §4.3） |

`known_gap` 的案例與尚未審核的生成案例（🚧）不計入指標與門檻，但規則仍須通過。

### 2.2 指標

「一次執行」指一個案例的一次回覆。除了「規則」，都只計算計分案例。

| 指標 | 定義 |
|------|------|
| 任務完成率 | 通過的執行 ÷ 全部執行；附 95% 信賴區間（Wilson，以計分案例數為樣本數） |
| 規則 | 規則全部通過的執行比例（含 🚧 案例） |
| 任務結果正確 | 有任務結果檢查的執行中，結果全部正確的比例 |
| 寫入類完成率 | 期望產生草稿的案例的任務完成率 |
| 類別、領域 | 依情境類別（PHASE1 §4.2）與領域（客戶、訂單…）分列的任務完成率 |
| 診斷 | Tool 選擇正確率、Router 分派正確率、工具混淆表（應呼叫 A、實際呼叫 B 的次數） |
| 錯誤率／降級率 | 請求拋出例外的比例／至少一個模型失敗而改用下一個模型的比例 |
| 每個完成任務的花費 | 全部模型呼叫的實際花費（含 Router、失敗後降級、沒通過的執行）÷ 通過的執行數。花費取自 OpenRouter 回傳的 `usage.cost` |
| 延遲 | 整個請求的時間，平均、P50、P90、最大值；另外分節點列出（router、agent:commercial、agent:supply_chain） |

### 2.3 門檻

| 門檻 | 要求 | 來源 |
|------|------|------|
| 整體任務完成率 | ≥ 85% | TPM（2026-10-09） |
| 不可違反的規則 | 100% | 需求文件 §4.1 |
| 沒有權限類案例 | 100% | TPM（2026-10-09，原「權限類案例」） |
| 寫入類案例（期望產生草稿） | 100% | TPM（2026-10-09） |
| 平均延遲 | ≤ 10 秒 | TPM §3.1 |

Router 分派正確率（原門檻 ≥ 95%）改為診斷指標，不再是門檻（需求文件 E1）。門檻定義在 `mcp-server/evals/report.ts` 的 `GATES`；修改門檻時兩處一起改。

**不退步規則**（[CLAUDE.md](../CLAUDE.md)）：基準中 ✅ 的案例，這次不能變成 ❌。案例約 100 個時，整體完成率的誤差約 ±7%，因此退步以單一案例判斷。報告的「與基準比較」會列出退步的案例與兩次執行的設定差異（架構、各節點模型、prompt／tools／案例／假資料的 hash、git commit）。

## 3. 在 Langfuse 看結果

專案：Langfuse Cloud（EU）→ **Datasets → `query-agent`**。

| Langfuse 中的位置 | 內容 |
|-------------------|------|
| Dataset `query-agent` | **案例的來源**：在這裡新增、修改、封存案例（格式見需求文件 §3）。每次修改都會產生新的版本 |
| Experiment `query-agent` 的一次 run | 一次 eval 執行，run 名稱為報告 ID、說明為 `--label`；metadata 有架構、各節點模型、hash、git commit、prompt 版本、Dataset 版本與快照 |
| run 中的每一列 | 一個案例的 trace（連到對應的 Dataset item）：底下的 `run 1`、`run 2`… 是每次執行（輸入為情境、政策與對話，輸出為回覆與草稿），其下是 AI SDK 記錄的每個節點（`router`、`agent:<群組>`、`judge`）、每次模型呼叫（generation：模型、token、輸入輸出）與 tool 呼叫。以 `--prompt-label` 執行時，generation 連到產生它的 prompt 版本（Prompts 頁可看每個版本的使用量與分數） |
| 分數（每個案例） | `pass_rate`（通過的執行比例，評語列出沒通過的規則與結果檢查）、`rules`、`outcome`（政策未定義的案例沒有）、`latency_ms`（平均延遲）、`policy_judge`（程式內 LLM 評分的平均，評語為各次的理由）、`passed`（是否達案例通過門檻；🚧 案例沒有） |
| 分數（整次 run） | `task_completion`（任務完成率）、`gates_passed`（§2.3 的門檻是否全部通過，評語列出未通過的門檻） |
| Score config | 每個分數都帶 config（`evals/experiment.ts` 的 `SCORE_CONFIGS`，eval 執行時自動建立缺少的）：上述各項，以及人工標註與 LLM 評審用的 `policy-compliance`（符合／部分符合／不符合）、使用者回饋 `user-feedback` |

**比較兩次執行**：在 Experiments 頁勾選兩個以上的執行，即可逐案並排比較分數、花費與延遲。

eval 的 trace 環境為 `sdk-experiment`，正式環境的 trace 為 `production`（本機開發為 `development`），分開篩選。

**花費**：本機報告的花費取自 OpenRouter 回傳的實際金額；Langfuse 的花費依它的模型價格表計算，表中沒有的模型（例如 OpenRouter 的 `anthropic/claude-haiku-4.5`）沒有花費，需要時在 Langfuse → Settings → Models 新增。

**要記錄的看法**：對單一案例的看法寫在該案例 trace 的留言（Langfuse 的留言只能加在 trace 或 observation 上，不能加在整個 experiment 上）；對整次執行的決定寫在本文件 §5。

**上傳本機的報告**：以 `--no-langfuse` 執行的報告可用 `bun run eval:upload -- <報告檔>`（或 `--all`）上傳（`evals/langfuse.ts`，以 OTLP 直接上傳，結構與 SDK 的 experiment 相同，但沒有 prompt 連結與 score config）。只上傳 2026-10-14 以後的報告；案例內容取自報告記錄的快照。

### 3.1 在 GitHub 手動執行

GitHub → Actions → **Query Agent Eval** → Run workflow（`.github/workflows/query-agent-eval.yml`）。只手動觸發，不擋合併。輸入：名稱（`--label`）、prompt 標籤（填 `code` 用程式內建的 prompt）、每案執行次數、篩選。先跑 `npm run test`，再跑 eval；報告、快照與終端機輸出存為這次執行的 artifact，§5 的紀錄不會寫回 repo（需要時手動補上）。

需要的 repository secrets：`OPENROUTER_API_KEY`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`VERIFY_EMAIL`、`VERIFY_PASSWORD`。

### 3.2 LLM 評審的校準

目標：讓 Langfuse 管理的 LLM 評審（LLM-as-a-Judge）判斷回覆是否符合回覆政策，與人工標註約 85% 一致（整體與各情境類別）後才啟用。校準完成前，eval 的 `policy_judge`（`evals/judge.ts`）只記錄、不計入門檻。在 `mcp-server/` 執行（`evals/judge-calibration.ts`）：

| 步驟 | 指令或位置 | 內容 |
|------|-----------|------|
| 1 | `bun run judge -- prompt` | 評審 prompt 存到 Prompt Management：`judge-calibration/policy-compliance`（標籤 `candidate`）。變數 `{{input}}`（情境、政策與對話）與 `{{output}}`（回覆與草稿）對應每次執行的 observation |
| 2 | `bun run judge -- queue [--report <報告 ID>]` | 從最近一次完整的 experiment 挑約 50 次執行（分散到各情境類別，通過與未通過交錯），放入標註佇列 `policy-calibration` |
| 3 | Langfuse → Annotation Queues → `policy-calibration` | 人工標註 `policy-compliance`：符合／部分符合／不符合，可加評語 |
| 4 | `bun run judge -- dataset` | 把標註轉成資料集 `judge-calibration/policy-compliance`（期望輸出為人工的評分；重新標註會更新同一筆） |
| 5 | `bun run judge -- run [--label candidate]` | 以評審 prompt 跑一次 experiment（`policy-compliance-judge`），每筆的 `policy-compliance-judge-output-correct` 為評審與人工是否一致；終端機列出整體與各類別的一致率 |
| 6 | Langfuse → Evaluators | 一致後由使用者在 Langfuse 建立 LLM-as-a-Judge 評分器：使用這個 prompt、分數 `policy-compliance`，套用到 eval（`sdk-experiment`）與正式環境（`production`）的 observation。需要先在 Settings → LLM Connections 建立連線 |

不一致時修改 `evals/judge-calibration.ts` 的 `JUDGE_PROMPT`，重複步驟 1、5。

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

每次完整執行由 `bun run eval` 自動加一列；**決定**欄由 TPM 填寫（例如：採用、不採用與原因、需要再測）。2026-10-07 的 P0-7 比較與決定見 [QUERY_AGENT_ARCHITECTURE_EVAL.md](./requirements/QUERY_AGENT_ARCHITECTURE_EVAL.md)。

| 報告 | 架構與各節點主模型 | 任務完成率 | 每個完成任務 | P90 延遲 | 門檻 | 對基準退步 | 決定 |
|------|------------------|-----------|-------------|---------|------|-----------|------|
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
