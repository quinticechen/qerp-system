# Query Agent Eval — recheck-pp-inventory

- 報告：`20261009T0543-recheck-pp-inventory`（2026-10-09T05:43:43.862Z）
- 案例：1（每案 5 次）；案例通過門檻 66%；篩選 `pp-inventory`
- 架構：router；git e80be04（有未提交的修改）

| 節點 | 模型（主 → 降級） |
|------|------------------|
| router | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:commercial | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:supply_chain | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |

## 門檻

| 門檻 | 數值 | 要求 | 結果 |
|------|------|------|------|
| 整體任務完成率 | 40% | ≥ 85% | ❌ |

## 指標（不含 known_gap 案例）

| 指標 | 數值 |
|------|------|
| 任務完成率 | 40% |
| Tool 選擇正確率 | 40% |
| Router 分派正確率 | — |
| 錯誤率 | 0% |
| 降級率 | 0% |
| 每個完成任務的花費 | US$0.00083 |
| 總花費 | US$0.00166 |
| 延遲 平均／P50／P90／最大 | 22.9s／26.7s／27.0s／27.0s |
| agent:supply_chain 延遲 P50／P90 | 25.7s／25.9s |
| router 延遲 P50／P90 | 1.0s／1.1s |
| 平均 token（輸入／輸出，含 Router） | 3284／144 |
| 類別 paraphrase | 40% |

## 與基準比較（`20261009T0540-phase1-step1-api-writes`）

- 退步（✅ → ❌）：無
- 修好（❌ → ✅）：無
- 設定差異：
  - hash.cases: 05c6b5e6 → 0756c91e

## 各案例

| 案例 | 通過 | 路由 | 呼叫的 tools |
|------|------|------|--------------|
| ❌ `pp-inventory` 改寫：庫存剩多少（顏色在前） | 2/5 | supply_chain | list_products, get_inventory_summary |

## 失敗明細

### `pp-inventory` 改寫：庫存剩多少（顏色在前）

- run 3：calls get_inventory_summary（called: list_products）；reply matches /320/
  - 回覆：我找到名為「雲朵眠 test0922」的產品，顏色為「藍0922」，產品 ID 為。請問這是您要查詢的產品嗎？
- run 4：calls get_inventory_summary（called: list_products）；reply matches /320/
  - 回覆：我找到名為「雲朵眠 test0922」的產品，顏色為「藍0922」，產品 ID 為。請問這是您要查詢的產品嗎？
- run 5：calls get_inventory_summary（called: list_products）；reply matches /320/
  - 回覆：我找到名為「雲朵眠 test0922」的產品，顏色為「藍0922」，產品 ID 為。請問這是您要查詢的產品嗎？
