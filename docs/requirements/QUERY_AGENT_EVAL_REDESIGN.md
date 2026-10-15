# Query Agent Eval 重新設計

> 狀態：進行中（2026-10-15）：§6 步驟 1–5 完成，步驟 6 的評分器完成（校準待人工標註）。負責：AI Session。
> 現況的 eval 見 [QUERY_AGENT_EVALS.md](../QUERY_AGENT_EVALS.md)；情境類別與期望行為見 [QUERY_AGENT_PHASE1.md](./QUERY_AGENT_PHASE1.md) §4.2；回覆政策見 [QUERY_AGENT_TPM_ALIGNMENT.md](./QUERY_AGENT_TPM_ALIGNMENT.md) §3.4。
> 完成後更新：`QUERY_AGENT_EVALS.md`、[EVALS.md](../EVALS.md)、CLAUDE.md 的「Agent Evals」段落。

## 1. 為什麼要重新設計

現有的 31 個案例由工程在開發時從事故整理、部分自動產生，期望值沒有依據的政策。2026-10-09 最後一次執行（`20261009T0549-phase1-step1-api-writes-v3`）的 5 個失敗案例中，3 個是測試本身的問題：

| 案例 | 實際發生 | 問題 |
|------|----------|------|
| `r-entity-memory` | 草稿完全正確，只因多查了一次客戶而失敗 | 檢查過程，而非結果 |
| `r-multi-turn-order` | 補上客戶名稱後，Agent 再問「是這個客戶嗎？」 | 當時沒有政策（現已定義：必填齊全就產生草稿） |
| `r-duplicate-history` | 規定要呼叫 `list_customers`，但這一輪使用者沒有給客戶名稱 | 期望值本身錯誤 |
| `pp-create-po` | Router 把工廠當成客戶 | 真的失敗 |
| `w-cross-domain-order` | 建成採購單，並向使用者要產品 ID | 真的失敗 |

其他限制：回覆品質只能用正規表達式檢查；同一案例跑 3 次輸出幾乎相同（Phase 0 F9），不是獨立樣本；案例少，一個案例約占 3%。

## 2. 決策

| # | 問題 | 決定 |
|---|------|------|
| E1 | 案例是否通過看什麼 | **看結果**：草稿（類型與以名稱表示的內容）、回答中的事實、不可違反的規則。工具呼叫順序、Router 分派只作為診斷指標（2026-10-14） |
| E2 | 案例存放在哪裡 | **Langfuse Dataset 為準**：在 Langfuse 網頁新增、修改案例；eval 執行時從 Langfuse 讀取；每次執行把用到的案例匯出到 repo（`mcp-server/evals/snapshots/`），供 git 追蹤與離線重跑（2026-10-14） |
| E3 | Prompt 放在哪裡 | **Langfuse Prompt Management**：正式環境只讀 `production` 標籤；新版本必須 eval 通過才能標為 `production`；程式內保留一份備用 prompt，Langfuse 無法連線時使用（2026-10-14） |
| E4 | 案例格式 | §3 的格式：情境類別、來源、審核者、政策狀態；期望只寫結果與規則（2026-10-14） |
| E5 | 案例來源 | 以 TPM 提供的真實語句為主（[QUERY_AGENT_EVAL_UTTERANCES.md](./QUERY_AGENT_EVAL_UTTERANCES.md)），PHASE1 §4.2 的矩陣補齊缺少的類別；LLM 生成的改寫須經人工審核才加入（2026-10-14） |
| E6 | 資訊不足時的行為 | 追問到 API 的必填欄位齊全才行動；選填欄位不主動追問，使用者提到的要帶入（TPM，2026-10-14） |
| E7 | Eval 的資料層 | **假資料**（`evals/fixtures/`、`fake-api.ts`），但每次執行前先檢查假資料與模擬的 API 是否符合目前的資料庫（§5.3），不符合就停止（2026-10-14） |
| E8 | 正式環境的 trace 是否送到 Langfuse | **去個資後送**，只送倒讚、出錯與抽樣的對話（§5.4）（2026-10-14） |
| E9 | 工具或 API 錯誤時的回覆 | 業務規則的拒絕（例如庫存不足）說明 API 回傳的中文原因；只有不支援的操作才說「Query 現在還沒有這個功能」（TPM，2026-10-14） |
| E11 | 正式環境 trace 的抽樣比例 | 5%，上線後依量調整（TPM，2026-10-14） |
| E10 | 案例數量 | **約 100 個**（TPM，2026-10-14），涵蓋現有 17 個工具的適用情境、跨流程與其他。100 個案例時整體完成率的誤差約 ±7%，因此是否退步以「單一案例由通過變失敗」判斷，整體完成率的報告附上信賴區間 |

## 3. 案例格式

每個案例是 Langfuse Dataset `query-agent` 的一個 item：`input` 是要送給 Agent 的內容，`expectedOutput` 是期望，`metadata` 是管理用的欄位。

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

| 欄位 | 說明 |
|------|------|
| `input.role` | `owner`、`admin`、`editor`、`viewer`（`evals/fixtures/roles.json`） |
| `input.fixtures` | 假資料集名稱（`evals/fixtures/<名稱>.json`） |
| `expectedOutput.draft` | 應產生的草稿：`tool` 與確認卡片的欄位（`summary.fields`，以名稱表示，不用 ID）；只列要檢查的欄位 |
| `expectedOutput.no_draft` | `true`：不可產生任何草稿 |
| `expectedOutput.answer_includes` | 回答中必須出現的事實（名稱、數字＋單位） |
| `expectedOutput.policy` | 對應 §3.4 的情境，LLM 評分依此選擇評分標準 |
| `metadata.category` | PHASE1 §4.2 的情境類別（含 TPM 新增的安全性與防禦、大量資料查詢、跨流程） |
| `metadata.domain` | `customer`、`factory`、`product`、`shelf`、`order`、`purchase`、`receiving`、`inventory`、`shipping`、`general` |
| `metadata.source` | `real`（真實語句）、`incident`（事故）、`matrix`（依 §4.2 補齊）、`generated`（LLM 改寫） |
| `metadata.reviewed_by` | 審核者；`generated` 案例沒有審核者時不納入門檻 |
| `metadata.policy_status` | `defined`；`pending` 表示政策未定義，只檢查不可違反的規則 |
| `metadata.diagnostics` | 預期的工具與分派，只進診斷報表，不影響是否通過 |
| `metadata.known_gap` | 已知但尚未修的缺口；不計入門檻。這類案例的 `draft.tool` 可以是尚未包成工具的業務 API（`evals/cases.ts` 的 `PLANNED_TOOLS`），記錄工具建立後的期望行為 |

## 4. 評分

### 4.1 三層

| 層 | Langfuse 分數 | 判斷 | 計入門檻 |
|----|---------------|------|----------|
| 不可違反的規則 | `rule_*`（例如 `rule_no_write`、`rule_no_id_leak`、`rule_no_false_draft`、`rule_permission`） | 程式；每次執行都檢查 | 一律 100% |
| 任務結果 | `outcome`（0／1） | 程式比對 `expectedOutput.draft`、`no_draft`、`answer_includes` | 是 |
| 回覆品質 | `policy_judge`（0–1，附理由） | Langfuse LLM-as-a-Judge（observation 層級；trace 層級的評分器在 Langfuse Cloud 只運作到 2026-11-16），依 `expectedOutput.policy` 對應的 §3.4 評分標準 | 校準前只記錄（§4.3） |

另外記錄 `latency_ms`：單次超過 30 秒視為該次失敗；整體平均須在 10 秒內（TPM §3.1）。

### 4.2 診斷指標（不影響通過）

- 工具混淆表：預期 A、實際呼叫 B 的次數
- Router 分派正確率
- 依 `domain`、`category` 分列的完成率
- 降級率、錯誤率、每個完成任務的花費

### 4.3 LLM 評分的校準

1. 先以人工在 Langfuse 標註佇列中標註約 50 筆回覆（符合／不符合政策）
2. 比較 `policy_judge` 與人工標註的一致率
3. 一致率達 90% 以上，再由 TPM 決定是否把 `policy_judge` 納入門檻

## 5. Langfuse 的設定

| 項目 | 設定 |
|------|------|
| Dataset | `query-agent`（沿用名稱）；舊案例改寫為 §3 格式後重新匯入，舊 item 封存 |
| Prompt | `query-router`、`query-agent-commercial`、`query-agent-supply-chain`、`query-agent-single`；標籤 `production`（正式環境）、`candidate`（待 eval） |
| Experiment | 由 `bun run eval` 執行（SDK 方式）：整段 Agent 流程含工具與假資料，Langfuse 網頁無法執行。metadata 記錄 prompt 版本、各節點模型、git commit |
| 網頁上的實驗 | 只適用單一呼叫：Router 的分類（可輸出結構化結果）、LLM 評分器本身的調整 |
| 評分器 | 依 §3.4 的每個情境各一份評分標準 |
| 標註佇列 | `policy-calibration`：校準 LLM 評分用 |

### 5.1 Eval 程式的新參數

| 參數 | 說明 |
|------|------|
| `--prompt-label <標籤>` | 使用 Langfuse 上該標籤的 prompt（預設 `production`） |
| `--dataset-version <時間>` | 使用某個時間點的 Dataset 內容（Langfuse 依時間保存 item 的版本，API 的 `version` 參數），讓兩次執行用同一批案例比較 |
| `--offline`、`--snapshot <檔案>` | 不連 Langfuse，改用 `evals/snapshots/` 最新的或指定的快照 |
| `--skip-db-check` | 略過 §5.3；該次執行不寫入實驗紀錄，也不會被當成基準 |

### 5.2 Prompt 上線流程

prompt 的原文仍寫在程式裡（`router.ts`、`sub-agents.ts`），由 `bun run prompts`（`evals/prompts-cli.ts`）同步到 Langfuse：

1. 修改程式裡的 prompt；`bun run eval` 預設就測程式裡的版本
2. `bun run prompts -- push`：有變更的 prompt 上傳為新版本並標 `candidate`（沒變更的沿用原版本）
3. `bun run eval -- --prompt-label candidate --label <改了什麼>`：測 Langfuse 上的 candidate
4. 沒有退步且通過門檻 → `bun run prompts -- promote`：candidate 改標 `production`；正式環境在快取到期後（60 秒）讀到新版本
5. 在 `QUERY_AGENT_EVALS.md` §5 記錄

在 Langfuse 網頁上直接修改 prompt 也會產生新版本，同樣要經過步驟 3、4；之後應把內容同步回程式。`bun run prompts -- status` 列出程式、candidate、production 是否一致。

正式環境（`src/agent/prompts.ts`）：有 `LANGFUSE_*` 環境變數時讀 `production`（`QUERY_PROMPT_LABEL` 可改），快取 60 秒、逾時 2 秒；讀不到時用程式內建的版本，回覆不會因 Langfuse 失敗。每次回覆用了哪些 prompt 版本記在 `query_traces.prompts`。

### 5.3 資料庫一致性檢查（E7）

`bun run eval` 開始前先執行，有任何不一致就列出差異並停止（`--skip-db-check` 可略過，該次執行不會被當成基準）。比對的是**結構與規則**，不是資料內容：假資料本來就是虛構的客戶與單據。

| 檢查 | 假資料側 | 資料庫側 |
|------|----------|----------|
| 資料表、view 與欄位 | `fixtures/*.json` 的資料表、欄位與關聯；各工具查詢的欄位（從 `src/tools/` 的 `.select(...)` 取出） | 以測試帳號送出同樣欄位的 `limit=0` 查詢：不存在的欄位回 `42703`、關聯回 `PGRST200` |
| API 的參數 | `fake-api.ts` 為每個 API 宣告的參數名稱 | 帶一個不存在的參數呼叫該函式：PostgREST 找不到函式（`PGRST202`，函式不會執行），提示中列出真正的參數 |
| 狀態值 | 假資料中的狀態欄位、工具輸入的 enum（訂單、採購單、產品的狀態） | 以該值篩選的 `limit=0` 查詢：enum 欄位不接受的值回 `22P02` |
| 角色權限 | `fixtures/roles.json` | `role_permissions` |
| 錯誤代碼 | `fake-api.ts` 拋出的代碼（HINT） | [API.md](../API.md) §3 的錯誤代碼表 |

PostgREST 的 OpenAPI 說明只開放給 service_role 金鑰，因此改用上述不讀取資料的查詢。`fake-api.ts` 也和 PostgREST 一樣拒絕未知或缺少必填的參數，工具傳錯參數名稱時 eval 會失敗。

第一次執行（2026-10-14）找到並修正：`get_shipping` 查詢不存在的 `inventory_rolls.grade`（應為 `quality`，正式環境查出貨明細會失敗）；`list_purchase_orders` 的狀態篩選含不存在的 `in_production`、缺少 `partial_received`；假資料的採購單狀態 `in_production`。

### 5.4 正式環境的 trace（E8）

**送出的範圍**：使用者按倒讚的回覆、出錯或降級的回覆，以及其他回覆抽樣 5%（E11）。

**去個資**（送出前在伺服器處理）：

| 資料 | 處理 |
|------|------|
| 電話、手機、傳真、Email | 依格式比對，換成 `[電話]`、`[Email]` |
| 聯絡人、地址 | 工具回傳的 `contact_person`、`address` 欄位一律換成 `[聯絡人]`、`[地址]`；使用者訊息中的姓名與地址以比對規則盡量遮蔽 |
| 公司、產品名稱、單據編號 | 保留（商業資料，且重現案例需要） |

**前置**：回覆的讚／倒讚（前端）；使用條款涵蓋「對話紀錄用於改善服務」（TPM 確認）。去個資的規則要有確定性測試。

## 6. 實作步驟

| # | 工作 | 依賴 |
|---|------|------|
| 1 | ✅ TPM 填寫真實語句（[QUERY_AGENT_EVAL_UTTERANCES.md](./QUERY_AGENT_EVAL_UTTERANCES.md)）（2026-10-14） | — |
| 2 | ✅ Eval 程式：從 Langfuse Dataset 讀取 §3 格式的案例、匯出快照、新的評分（§4.1，LLM 評分屬步驟 6）與診斷報表（§4.2）、資料庫一致性檢查（§5.3）（2026-10-14） | — |
| 3 | ✅ 舊案例改寫為 §3 格式，刪除檢查過程的條件，修正錯誤的期望值（2026-10-14）：31 個案例寫入 Langfuse（同 ID 更新），已不存在的 `p-warehouse-no-customers` 封存；`fake-api.ts` 的確認卡片文字改為與資料庫的 summary 函式一致。新格式的第一次執行：`20261014T1502-v3-step3-rewritten-cases` | 2 |
| 4 | ✅ 把真實語句轉為案例；假資料補上語句提到的客戶、產品、單據（2026-10-14）：71 個案例（`real-*`）、假資料 `fixtures/real.json`；合計 102 個案例。依 §4.2 矩陣補齊缺少的類別留待新工具建立時進行 | 1、2 |
| 5 | ✅ Prompt 搬到 Langfuse：正式環境依標籤讀取並快取、程式內的備用 prompt、`--prompt-label`（2026-10-15）：7 個 prompt 的 v1（= eval `20261014T1630-phase1-agent-fixes` 的版本）已標為 `production`；Cloud Run 尚未設定 `LANGFUSE_*`，設定前正式環境仍用程式內建的版本 | — |
| 6 | 🔧 依 §3.4 撰寫評分標準，建立 LLM 評分器與標註佇列：評分器已完成（2026-10-15，`evals/judge.ts`，由 eval 程式執行並上傳為 `policy_judge` 分數，不用 Langfuse 網頁上的評分器，因為整段 Agent 流程只能由 eval 程式執行）；標註佇列與校準待人工標註 | 3 |
| 7 | 以目前的版本跑一次新的基準線，讓 TPM 看到現況與政策的差距 | 3、4、6 |
| 8 | 更新現況文件（`QUERY_AGENT_EVALS.md`、`EVALS.md`、CLAUDE.md） | 7 |
| 9 | 正式環境 trace 回流（§5.4）：讚／倒讚、去個資、送出到 Langfuse | TPM 確認使用條款 |

## 7. 待決

無。
