# Query Agent Eval — recheck-r-entity-memory

- 報告：`20261009T0544-recheck-r-entity-memory`（2026-10-09T05:44:27.636Z）
- 案例：1（每案 5 次）；案例通過門檻 66%；篩選 `r-entity-memory`
- 架構：router；git e80be04（有未提交的修改）

| 節點 | 模型（主 → 降級） |
|------|------------------|
| router | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:commercial | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:supply_chain | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |

## 門檻

| 門檻 | 數值 | 要求 | 結果 |
|------|------|------|------|
| 整體任務完成率 | 20% | ≥ 85% | ❌ |

## 指標（不含 known_gap 案例）

| 指標 | 數值 |
|------|------|
| 任務完成率 | 20% |
| Tool 選擇正確率 | 20% |
| Router 分派正確率 | — |
| 錯誤率 | 0% |
| 降級率 | 20% |
| 每個完成任務的花費 | US$0.00376 |
| 總花費 | US$0.00376 |
| 延遲 平均／P50／P90／最大 | 7.1s／7.2s／8.6s／8.6s |
| agent:commercial 延遲 P50／P90 | 5.9s／6.5s |
| router 延遲 P50／P90 | 1.2s／2.7s |
| 平均 token（輸入／輸出，含 Router） | 4929／709 |
| 類別 regressions | 20% |

## 與基準比較（`20261009T0540-phase1-step1-api-writes`）

- 退步（✅ → ❌）：無
- 修好（❌ → ✅）：無
- 設定差異：
  - hash.cases: 05c6b5e6 → 44a04257

## 各案例

| 案例 | 通過 | 路由 | 呼叫的 tools |
|------|------|------|--------------|
| ❌ `r-entity-memory` 實體記憶：上一輪已找到客戶，本輪用代名詞建單（P0-4） | 1/5 | commercial | list_products, list_customers, create_order |

## 失敗明細

### `r-entity-memory` 實體記憶：上一輪已找到客戶，本輪用代名詞建單（P0-4）

- run 1：does not call list_customers
  - 回覆：已建立待確認的草稿（建立訂單）：客戶：永泰布行；品項 1：雲朵眠 test0922 - 藍0922 × 20 公斤，單價 80。使用者在確認卡片上按「確認」後才會寫入。
- run 2：does not call list_customers
  - 回覆：已建立待確認的草稿（建立訂單）：客戶：永泰布行；品項 1：雲朵眠 test0922 - 藍0922 × 20 公斤，單價 80。使用者在確認卡片上按「確認」後才會寫入。
- run 4：does not call list_customers
  - 回覆：已建立待確認的草稿（建立訂單）：客戶：永泰布行；品項 1：雲朵眠 test0922 - 藍0922 × 20 公斤，單價 80。使用者在確認卡片上按「確認」後才會寫入。
- run 5：does not call list_customers
  - 回覆：已建立待確認的草稿（建立訂單）：客戶：永泰布行；品項 1：雲朵眠 test0922 - 藍0922 × 20 公斤，單價 80。使用者在確認卡片上按「確認」後才會寫入。
