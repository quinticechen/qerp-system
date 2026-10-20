# Query Agent：完整套用 Langfuse 的評估功能

> 狀態：進行中（2026-10-16）。負責：AI Session。
> 接續 [QUERY_AGENT_EVAL_REDESIGN.md](./QUERY_AGENT_EVAL_REDESIGN.md)（案例、評分、prompt 標籤已完成）。參考 Langfuse 官方文件與 Langfuse skill（`langfuse/skills`）的建議做法。
> 完成後更新：[QUERY_AGENT_EVALS.md](../QUERY_AGENT_EVALS.md)、[EVALS.md](../EVALS.md)、[AGENT.md](../AGENT.md)、[SERVICES.md](../SERVICES.md)、CLAUDE.md。

## 1. 決定（使用者，2026-10-16）

| # | 問題 | 決定 |
|---|------|------|
| L1 | 繼續用自寫的 REST 上傳，或改用官方 SDK | **官方 JS/TS SDK v6**（`@langfuse/client`、`@langfuse/tracing`、`@langfuse/otel`，版本固定）。eval 改用 SDK 的 experiment runner；正式環境的 tracing 用同一套 |
| L2 | 正式環境的對話是否送 Langfuse | **送**，並加上讚／倒讚。依 E8：去個資後只送出錯的請求與 5% 抽樣；使用者按倒讚的對話事後補送。前提：使用條款涵蓋「對話紀錄用於改善服務」（使用者確認） |
| L3 | LLM 評審在哪裡執行 | **Langfuse 管理的評分器**：評審 prompt 放 Prompt Management，用標註過的校準資料集達到約 85% 一致後啟用；同時評 eval 與正式環境。需要使用者在 Langfuse 建立 LLM 連線 |
| L4 | eval 是否接 CI | **只手動觸發**：GitHub Actions 的 `workflow_dispatch`，按按鈕才跑，不擋合併 |

## 2. 設計

### 2.1 Tracing（eval 與正式環境共用）

- `src/agent/langfuse.ts`：啟動 OpenTelemetry（`NodeSDK` + `LangfuseSpanProcessor`），提供共用的 `LangfuseClient`
- Agent 的每次模型呼叫開啟 AI SDK 的 `experimental_telemetry`，Langfuse 自動記錄成 generation（模型、token、花費、輸入輸出）；metadata 帶 `langfusePrompt`，generation 連結到產生它的 prompt 版本
- 每次 `/query` 是一個 trace：`userId`、`sessionId`（Query 對話）、tags（路由到的子 Agent）、`environment`（`production`／`sdk-experiment`）
- **去個資**（正式環境）：電話、手機、傳真、Email 依格式換成 `[電話]`、`[Email]`；工具回傳的 `contact_person`、`address` 欄位換成 `[聯絡人]`、`[地址]`。公司、產品名稱與單據編號保留
  - 實作（2026-10-16）：SDK 的 `mask` 只處理 Langfuse 自己的屬性，AI SDK 的 `ai.*` 屬性（模型的輸入輸出、工具結果）不經過它，所以改在抽樣的 SpanProcessor 中遮蔽每個 span 的所有文字屬性
  - 模型會在回覆中重述聯絡人與地址（例如「陳大文 - 0912-…」），那裡沒有欄位名稱可辨識；因此一個請求結束時，收集它所有 span 中出現的 `contact_person`、`address` 值，在整個請求的 span 中一併替換（2026-10-16 以假資料的 trace 驗證：送出的 trace 不含聯絡人姓名與電話）
- **抽樣**（正式環境）：一個請求的所有 span 先暫存，請求結束時決定是否送出：出錯或降級 → 送；其餘以 trace id 決定 5% 送出。eval 全部送出
- **trace id**：由 `query_traces.id` 決定（`createTraceId`），事後補送與分數都能對到同一個 trace

### 2.2 Prompt

- `src/agent/prompts.ts` 改用 `langfuse.prompt.get(name, { label, fallback, cacheTtlSeconds })`：SDK 內建快取與備用文字，取代自寫的 REST
- 規則不變：正式環境讀 `production`；`QUERY_PROMPT_LABEL=code` 用程式內建；eval 預設程式內建，`--prompt-label` 指定標籤

### 2.3 Eval（experiment）

- `evals/run.ts` 改用 `dataset.runExperiment`（或 `langfuse.experiment.run` 搭配快照）：task 呼叫 Agent；item 評分器輸出 `rules`、`outcome`、`latency_ms`；整次執行的評分器輸出任務完成率、規則、寫入類、沒有權限類與延遲的門檻
- 本機報告、與基準比較、實驗紀錄（QUERY_AGENT_EVALS.md §5）、資料庫一致性檢查保留
- 執行前建立 **score config**（名稱以測量的東西命名），分數一律帶 config：`pass_rate`、`rules`、`outcome`（0–1：每個案例有 3 次執行，記錄通過的比例）、`passed`（Boolean）、`latency_ms`、`policy_judge`（程式內評審，0–1）；整次執行的 `task_completion`（0–1）、`gates_passed`（Boolean）；`policy-compliance`（Categorical：符合／部分符合／不符合）、`user-feedback`（Boolean）
- 每個案例一個 trace，各次執行為其中的 `run N`（輸入：情境、政策、對話；輸出：回覆、草稿），讓標註與評審以「一次回覆」為單位

### 2.4 使用者回饋（L2）

- Query 的每則回覆下方有讚／倒讚（圖示按鈕），存在 `query_messages.metadata.feedback`，並以 `user-feedback`（Boolean）分數寫到該回覆的 trace
- 倒讚的回覆若沒有被抽樣送出，由後端以 `query_traces` 與對話內容重建該 trace（去個資）後送出；重建的 trace 沒有工具結果可以找出聯絡人與地址，因此遮蔽組織內所有客戶、工廠的聯絡人與地址。Langfuse 已有該 trace 時不重建
- `query_messages` 沒有 UPDATE policy（使用者不能改訊息），`feedback` 由 `private.set_query_message_feedback()` 寫入（只限自己的 AI 回覆，`public` 為包裝函式）：migration `20261016060000_query_message_feedback.sql`，測試 `supabase/tests/query_message_feedback.test.sql`
- 後端端點：`POST /query/messages/:id/feedback`（JWT，只限自己的訊息）

### 2.5 LLM 評審（L3）

依 Langfuse 的評審校準流程：

1. 建立 score config `policy-compliance` 與標註佇列 `policy-calibration`
2. 從 eval 的回覆挑選各情境類別的代表（約 50 筆）放入標註佇列，由使用者標註
3. 校準資料集 `judge-calibration/policy-compliance`（標註結果為期望輸出）；評審 prompt 存為 `judge-calibration/policy-compliance`
4. 以 SDK experiment 執行評審 prompt，評分器 `policy-compliance-judge-output-correct` 比對；整體與各類別都達約 85% 才算可用
5. 使用者核可後，在 Langfuse 建立 LLM-as-a-Judge 評分器（需要 LLM 連線），套用到 eval 與正式環境的 trace
6. 校準完成前，`evals/judge.ts` 的評分只記錄，不計入門檻

### 2.6 CI（L4）

`.github/workflows/query-agent-eval.yml`：`workflow_dispatch`，輸入 label、prompt 標籤、runs；在 `mcp-server/` 執行測試與 eval，上傳報告為 artifact。需要的 secrets：`OPENROUTER_API_KEY`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`VERIFY_EMAIL`、`VERIFY_PASSWORD`（資料庫一致性檢查）

## 3. 步驟

| # | 工作 | 依賴 | 狀態 |
|---|------|------|------|
| 1 | 安裝 SDK（版本固定） | — | ✅ 2026-10-16 |
| 2 | `langfuse.ts`：OpenTelemetry、去個資、尾端抽樣；Agent 開啟 telemetry；prompt 改用 SDK 並連結到 generation | 1 | ✅ 2026-10-16 |
| 3 | eval 改用 SDK experiment；score config | 2 | ✅ 2026-10-16（score config 已在 Langfuse 建立） |
| 4 | 讚／倒讚：前端、端點、分數、倒讚補送 | 2 | ✅ 2026-10-16（migration 待使用者套用） |
| 5 | LLM 評審：score config、標註佇列、校準資料集、評審 prompt、校準 experiment | 3；使用者標註；LLM 連線 | 程式與評審 prompt v1（`candidate`）✅ 2026-10-16；佇列已填入 50 筆（2026-10-16）；**標註暫停**，等 [QUERY_AGENT_EVAL_REDESIGN.md](./QUERY_AGENT_EVAL_REDESIGN.md) §8 的架構調整後重新填入（2026-10-20） |
| 6 | GitHub Actions（手動觸發） | 3；GitHub secrets | ✅ 2026-10-16（secrets 待使用者設定） |
| 7 | 新基準；查清 91% → 83% 的退步（[AGENT.md](../AGENT.md)） | 3 | 新基準 `20261016T0455-sdk-baseline`：85% ✅ 2026-10-16。原因已查清（prompt、案例相同，退步來自工具定義：追問選填欄位、貨架名稱解析、多子 Agent 分派），修正另案處理 |
| 8 | 更新現況文件 | 2–7 | ✅ 2026-10-16 |

## 4. 需要使用者處理

- 在 SQL Editor 執行 `supabase/tests/run.sql`（含 migration，回滾）確認 `ALL TESTS PASSED`，再套用 `supabase/migrations/20261016060000_query_message_feedback.sql`；套用前，讚／倒讚會顯示「回饋沒有送出」
- Langfuse → Settings → LLM Connections 新增連線（例如 OpenRouter），LLM 評審才能在 Langfuse 執行
- 在標註佇列標註約 50 筆回覆（是否符合回覆政策）
- GitHub 的 repository secrets（§2.6）
- 確認使用條款涵蓋對話紀錄用於改善服務（L2 的前提）
