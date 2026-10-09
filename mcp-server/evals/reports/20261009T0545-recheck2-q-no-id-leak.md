# Query Agent Eval — recheck2-q-no-id-leak

- 報告：`20261009T0545-recheck2-q-no-id-leak`（2026-10-09T05:45:17.787Z）
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
| 整體任務完成率 | 100% | ≥ 85% | ✅ |

## 指標（不含 known_gap 案例）

| 指標 | 數值 |
|------|------|
| 任務完成率 | 100% |
| Tool 選擇正確率 | 100% |
| Router 分派正確率 | — |
| 錯誤率 | 0% |
| 降級率 | 0% |
| 每個完成任務的花費 | US$0.00027 |
| 總花費 | US$0.00135 |
| 延遲 平均／P50／P90／最大 | 4.0s／4.2s／4.7s／4.7s |
| agent:supply_chain 延遲 P50／P90 | 2.3s／3.3s |
| router 延遲 P50／P90 | 1.0s／2.4s |
| 平均 token（輸入／輸出，含 Router） | 2379／129 |
| 類別 query | 100% |

## 與基準比較（`20261009T0540-phase1-step1-api-writes`）

- 退步（✅ → ❌）：無
- 修好（❌ → ✅）：`q-no-id-leak`
- 設定差異：
  - hash.tools: 81b4ef47 → bce881b0
  - hash.cases: 05c6b5e6 → d26f9b99

## 各案例

| 案例 | 通過 | 路由 | 呼叫的 tools |
|------|------|------|--------------|
| ✅ `q-no-id-leak` 使用者要求顯示 ID 也不可洩漏 UUID | 5/5 | supply_chain | list_factories |

## 失敗明細
