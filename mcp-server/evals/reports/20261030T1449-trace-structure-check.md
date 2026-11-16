# Query Agent Eval — trace-structure-check

- 報告：`20261030T1449-trace-structure-check`（2026-10-30T14:49:50.393Z）
- 案例：1（每案 1 次）；案例通過門檻 66%；篩選 `real-order-01`
- Dataset：`query-agent`（最新）；快照 `20261014T1611-502aa148.json`
- 資料庫一致性檢查：通過
- Prompt：Langfuse 標籤 `candidate`（query-router v2、query-agent-commercial v2、query-agent-supply_chain v2、query-agent-warehouse v2、query-agent-catalog v2、query-agent-facilities v2、query-agent-single v1、query-summary v1）
- 架構：router；git 0ec53e6（有未提交的修改）

| 節點 | 模型（主 → 降級） |
|------|------------------|
| router | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:commercial | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:supply_chain | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:warehouse | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:catalog | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:facilities | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| summary | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |

## 門檻

| 門檻 | 數值 | 要求 | 結果 |
|------|------|------|------|
| 整體任務完成率 | 100% | ≥ 85% | ✅ |
| 不可違反的規則 | 100% | ≥ 100% | ✅ |
| 寫入類案例（應產生草稿） | 100% | ≥ 100% | ✅ |
| 平均延遲 | 6.1s | ≤ 10.0s | ✅ |

## 指標（不含 🚧 案例；規則含全部案例）

| 指標 | 數值 |
|------|------|
| 任務完成率 | 100%（95% 信賴區間 21%–100%） |
| 規則全部通過 | 100% |
| 任務結果正確 | 100% |
| 寫入類完成率 | 100% |
| 回覆品質（LLM 評分，僅記錄） | — |
| 錯誤率 | 0% |
| 降級率 | 0% |
| 每個完成任務的花費 | US$0.00196 |
| 總花費 | US$0.00196 |
| 延遲 平均／P50／P90／最大 | 6.1s／6.1s／6.1s／6.1s |
| agent:catalog 延遲 P50／P90 | 1.8s／1.8s |
| agent:commercial 延遲 P50／P90 | 3.9s／3.9s |
| router 延遲 P50／P90 | 1.3s／1.3s |
| summary 延遲 P50／P90 | 1.0s／1.0s |
| 平均 token（輸入／輸出，含 Router） | 17976／418 |
| 類別 正常 | 100% |
| 領域 order | 100% |

## 診斷（不影響是否通過）

- Tool 選擇正確率：—；Router 分派正確率：—
- 回覆品質（LLM 評分，校準前不計入門檻）：—

## 與基準比較（`20261030T1006-router-summary`）

- 退步（✅ → ❌）：無
- 修好（❌ → ✅）：無
- 設定差異：
  - hash.cases: c81901c6 → 1cf6423d
  - hash.fixtures: 253c65b3 → ea8e2ec4
  - git: bb1dd49+dirty → 0ec53e6+dirty

## 各案例

| 案例 | 類別 | 領域 | 通過 | 路由 | 呼叫的 tools |
|------|------|------|------|------|--------------|
| ✅ `real-order-01` 永泰要 20 公斤雲朵眠藍的，一公斤 80 | 正常 | order | 1/1 | commercial+catalog | list_customers, list_products, create_order |

## 失敗明細
