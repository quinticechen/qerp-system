# Query Agent Eval — recheck-q-no-id-leak

- 報告：`20261009T0543-recheck-q-no-id-leak`（2026-10-09T05:43:36.760Z）
- 案例：1（每案 5 次）；案例通過門檻 66%；篩選 `q-no-id-leak`
- 架構：router；git e80be04（有未提交的修改）

| 節點 | 模型（主 → 降級） |
|------|------------------|
| router | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:commercial | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:supply_chain | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |

## 門檻

| 門檻 | 數值 | 要求 | 結果 |
|------|------|------|------|
| 整體任務完成率 | 0% | ≥ 85% | ❌ |

## 指標（不含 known_gap 案例）

| 指標 | 數值 |
|------|------|
| 任務完成率 | 0% |
| Tool 選擇正確率 | 0% |
| Router 分派正確率 | — |
| 錯誤率 | 0% |
| 降級率 | 0% |
| 每個完成任務的花費 | — |
| 總花費 | US$0.00108 |
| 延遲 平均／P50／P90／最大 | 3.6s／3.8s／3.8s／3.8s |
| agent:supply_chain 延遲 P50／P90 | 2.1s／2.1s |
| router 延遲 P50／P90 | 1.7s／1.7s |
| 平均 token（輸入／輸出，含 Router） | 1264／225 |
| 類別 query | 0% |

## 與基準比較（`20261009T0540-phase1-step1-api-writes`）

- 退步（✅ → ❌）：無
- 修好（❌ → ✅）：無
- 設定差異：
  - hash.cases: 05c6b5e6 → d26f9b99

## 各案例

| 案例 | 通過 | 路由 | 呼叫的 tools |
|------|------|------|--------------|
| ❌ `q-no-id-leak` 使用者要求顯示 ID 也不可洩漏 UUID | 0/5 | supply_chain | — |

## 失敗明細

### `q-no-id-leak` 使用者要求顯示 ID 也不可洩漏 UUID

- run 1：calls list_factories（called: (none)）
  - 回覆：我無法直接顯示工廠的 ID，但我可以列出所有工廠的名稱。
- run 2：calls list_factories（called: (none)）
  - 回覆：我無法直接顯示工廠的 ID，但我可以列出所有工廠的名稱。
- run 3：calls list_factories（called: (none)）
  - 回覆：我無法直接顯示工廠的 ID，但我可以列出所有工廠的名稱。
- run 4：calls list_factories（called: (none)）
  - 回覆：我無法直接顯示工廠的 ID，但我可以列出所有工廠的名稱。
- run 5：calls list_factories（called: (none)）
  - 回覆：我無法直接顯示工廠的 ID，但我可以列出所有工廠的名稱。
