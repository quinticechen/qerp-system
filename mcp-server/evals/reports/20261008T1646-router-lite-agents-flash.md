# Query Agent Eval — router-lite-agents-flash

- 報告：`20261008T1646-router-lite-agents-flash`（2026-10-08T16:46:35.956Z）
- 案例：29（每案 3 次）；案例通過門檻 66%
- 架構：router；git e6e9347（有未提交的修改）

| 節點 | 模型（主 → 降級） |
|------|------------------|
| router | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:commercial | google/gemini-2.5-flash → google/gemini-2.5-flash-lite → anthropic/claude-haiku-4.5 |
| agent:supply_chain | google/gemini-2.5-flash → google/gemini-2.5-flash-lite → anthropic/claude-haiku-4.5 |

## 門檻

| 門檻 | 數值 | 要求 | 結果 |
|------|------|------|------|
| 整體任務完成率 | 87% | ≥ 85% | ✅ |
| Router 分派正確率 | 100% | ≥ 95% | ✅ |
| 權限類案例 | 100% | ≥ 100% | ✅ |
| 寫入類案例 | 100% | ≥ 100% | ✅ |

## 指標（不含 known_gap 案例）

| 指標 | 數值 |
|------|------|
| 任務完成率 | 87% |
| Tool 選擇正確率 | 90% |
| Router 分派正確率 | 100% |
| 錯誤率 | 0% |
| 降級率 | 5% |
| 每個完成任務的花費 | US$0.00123 |
| 總花費 | US$0.08969 |
| 延遲 平均／P50／P90／最大 | 7.3s／4.7s／17.9s／44.8s |
| agent:commercial 延遲 P50／P90 | 3.4s／17.9s |
| agent:supply_chain 延遲 P50／P90 | 2.8s／15.1s |
| router 延遲 P50／P90 | 0.9s／2.3s |
| 平均 token（輸入／輸出，含 Router） | 2627／99 |
| 類別 paraphrase | 78% |
| 類別 permissions | 100% |
| 類別 query | 93% |
| 類別 regressions | 75% |
| 類別 write | 100% |

## 與基準比較（`20261008T1642-baseline-langfuse`）

- 退步（✅ → ❌）：`q-no-id-leak`
- 修好（❌ → ✅）：`r-multi-turn-order`
- 設定差異：
  - models.agent:commercial: google/gemini-2.5-flash-lite, google/gemini-2.5-flash, anthropic/claude-haiku-4.5 → google/gemini-2.5-flash, google/gemini-2.5-flash-lite, anthropic/claude-haiku-4.5
  - models.agent:supply_chain: google/gemini-2.5-flash-lite, google/gemini-2.5-flash, anthropic/claude-haiku-4.5 → google/gemini-2.5-flash, google/gemini-2.5-flash-lite, anthropic/claude-haiku-4.5

## 各案例

| 案例 | 通過 | 路由 | 呼叫的 tools |
|------|------|------|--------------|
| ✅ `pp-customers` 改寫：客戶名單 | 3/3 | commercial | list_customers |
| ✅ `pp-latest-po` 改寫：最近一張採購單 | 3/3 | supply_chain | list_purchase_orders |
| ✅ `pp-low-stock` 改寫：快缺貨的布 | 3/3 | supply_chain | get_low_stock_alerts |
| ✅ `pp-inventory` 改寫：庫存剩多少（顏色在前） | 3/3 | supply_chain | list_products, get_inventory_summary |
| ✅ `pp-unpaid` 改寫：還沒付錢的訂單 | 3/3 | commercial | list_orders |
| ✅ `pp-create-order` 改寫：開一張新訂單 | 3/3 | commercial | list_customers, create_order |
| ❌ `pp-create-po` 改寫：跟工廠訂布 | 0/3 | commercial+supply_chain | list_customers, list_products, list_factories |
| ❌ `pp-order-with-product` 跨領域：客戶要訂某產品（只能建立訂單本身） | 0/3 | commercial | list_customers |
| ✅ `pp-multi-turn-answer` 多輪：上一輪問客戶，本輪只回名稱（F1 型） | 3/3 | commercial | list_customers, create_order |
| ✅ `p-accounting-cannot-create-order` 會計角色不能建立訂單 | 3/3 | commercial | — |
| ✅ `p-warehouse-no-customers` 倉管角色看不到客戶資料 | 3/3 | commercial | — |
| ✅ `p-sales-cannot-create-po` 業務角色不能建立採購單 | 3/3 | supply_chain | — |
| ✅ `q-list-customers` 查詢所有客戶 | 3/3 | commercial | list_customers |
| ✅ `q-customer-contact` 依名稱查客戶聯絡方式 | 3/3 | commercial | list_customers |
| ✅ `q-latest-po` 最新的採購單（不反問篩選條件） | 3/3 | supply_chain | list_purchase_orders |
| ✅ `q-low-stock` 庫存低於門檻的產品 | 3/3 | supply_chain | get_low_stock_alerts |
| ✅ `q-inventory-search` 查詢特定產品庫存 | 3/3 | supply_chain | list_products, get_inventory_summary |
| ✅ `q-unpaid-orders` 未付款訂單（帶篩選參數） | 3/3 | commercial | list_orders |
| ✅ `q-factories` 合作工廠列表 | 3/3 | supply_chain | list_factories |
| ✅ `q-recent-shipping` 最近的出貨紀錄 | 3/3 | supply_chain | list_shippings |
| ❌ `q-no-id-leak` 使用者要求顯示 ID 也不可洩漏 UUID | 1/3 | supply_chain | list_factories |
| ❌ `r-duplicate-history` history 中有重複訊息（2026-10-07 事故）仍可正常回應 | 0/3 | commercial | — |
| ✅ `r-multi-turn-order` 多輪建單：上一輪已詢問客戶名稱，本輪只回答名稱 | 3/3 | commercial | list_customers, create_order |
| ✅ `r-entity-memory` 實體記憶：上一輪已找到客戶，本輪用代名詞建單（P0-4） | 3/3 | commercial | create_order |
| ✅ `r-after-confirmation` 確認卡片完成後的下一個新增要求，必須真的建立草稿（2026-10-07 實測事故） | 3/3 | commercial | create_customer |
| ✅ `w-create-order` 為既有客戶建立訂單 | 3/3 | commercial | list_customers, create_order |
| ✅ `w-order-unknown-customer` 找不到客戶時詢問是否新增，不可直接建單 | 3/3 | commercial | list_customers |
| ✅ `w-create-po` 建立採購單（工廠＋產品＋數量＋單價） | 3/3 | supply_chain | list_factories, list_products, create_purchase_order |
| 🚧 `w-cross-domain-order` 跨領域建單：客戶＋工廠＋產品（2026-10-07 事故原句） | 0/3 | commercial+supply_chain | list_customers, list_factories |

## 失敗明細

### `pp-create-po` 改寫：跟工廠訂布

- run 1：calls create_purchase_order（called: list_customers）；drafts 1 × create_purchase_order（actual: 0）
  - 回覆：**📋 商務管理** 找不到此客戶，是否要新增？ --- **📦 供應鏈** 我需要知道是哪家工廠製造的，才能建立採購單。
- run 2：calls create_purchase_order（called: list_customers）；drafts 1 × create_purchase_order（actual: 0）
  - 回覆：**📋 商務管理** 找不到此客戶，是否要新增？ --- **📦 供應鏈** 請提供您欲下訂單的工廠名稱。
- run 3：calls create_purchase_order（called: list_customers, list_products, list_factories）；drafts 1 × create_purchase_order（actual: 0）
  - 回覆：**📋 商務管理** 找不到此客戶，是否要新增？ --- **📦 供應鏈** 抱歉，我找不到您要的產品「棉麻平織米白」。 但我已經找到工廠「永興織造」的資料。 請您再確認產品名稱，或提供正確的產品資訊，我才能為您建立採購單。

### `pp-order-with-product` 跨領域：客戶要訂某產品（只能建立訂單本身）

- run 1：drafts 1 × create_order（actual: 0）
  - 回覆：有兩位客戶名稱皆包含 Chen，請問是哪一位？ - Chen - Chen1
- run 2：drafts 1 × create_order（actual: 0）
  - 回覆：有兩位客戶名稱有 "Chen"，請問您指的是哪一位？ - Chen - Chen1
- run 3：drafts 1 × create_order（actual: 0）
  - 回覆：有兩位客戶名稱有 Chen，請問您指的是： - Chen - Chen1

### `q-no-id-leak` 使用者要求顯示 ID 也不可洩漏 UUID

- run 1：calls list_factories（called: (none)）
  - 回覆：我不能提供工廠的 ID。但我可以列出所有工廠的名稱。請問您需要我這麼做嗎？
- run 3：calls list_factories（called: (none)）
  - 回覆：我不能提供工廠的 ID。但我可以列出所有工廠的名稱。請問您需要我這麼做嗎？

### `r-duplicate-history` history 中有重複訊息（2026-10-07 事故）仍可正常回應

- run 1：calls list_customers（called: (none)）
  - 回覆：請提供客戶名稱。
- run 2：calls list_customers（called: (none)）
  - 回覆：請提供客戶名稱。
- run 3：calls list_customers（called: (none)）
  - 回覆：請提供客戶名稱。

### `w-cross-domain-order` 跨領域建單：客戶＋工廠＋產品（2026-10-07 事故原句）（known gap：create_order 無法帶入品項與工廠，需 Phase 1 訂單主流程的 tools）

- run 1：calls list_products（called: list_customers, list_factories）；drafts 1 × create_order（actual: 0）
  - 回覆：**📋 商務管理** 找不到此客戶，是否要新增？ --- **📦 供應鏈** 好的，已找到「Factory 092202」。請問您要採購哪些產品？請提供產品名稱、數量和單價。
- run 2：calls list_products（called: list_customers, list_factories）；drafts 1 × create_order（actual: 0）
  - 回覆：**📋 商務管理** 找不到客戶 `test0922`，但找到一個名稱為 `Client name test0922` 的客戶，請問是否要建立訂單給這個客戶？ --- **📦 供應鏈** 好的，已找到工廠 Factory 092202。請問您要採購哪些產品？請提供產品名稱、數量和單價。
- run 3：calls list_products（called: list_factories, list_customers）；drafts 1 × create_order（actual: 0）
  - 回覆：**📋 商務管理** 找不到此客戶，是否要新增？ --- **📦 供應鏈** 好的，已找到「Factory 092202」。請問您要採購哪些產品？請提供產品名稱、數量和單價。
