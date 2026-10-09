# Query Agent Eval — phase1-step1-api-writes-v2

- 報告：`20261009T0546-phase1-step1-api-writes-v2`（2026-10-09T05:46:48.522Z）
- 案例：31（每案 3 次）；案例通過門檻 66%
- 架構：router；git e80be04（有未提交的修改）

| 節點 | 模型（主 → 降級） |
|------|------------------|
| router | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:commercial | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:supply_chain | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |

## 門檻

| 門檻 | 數值 | 要求 | 結果 |
|------|------|------|------|
| 整體任務完成率 | 74% | ≥ 85% | ❌ |
| Router 分派正確率 | 100% | ≥ 95% | ✅ |
| 權限類案例 | 100% | ≥ 100% | ✅ |
| 寫入類案例 | 67% | ≥ 100% | ❌ |

## 指標（不含 known_gap 案例）

| 指標 | 數值 |
|------|------|
| 任務完成率 | 74% |
| Tool 選擇正確率 | 71% |
| Router 分派正確率 | 100% |
| 錯誤率 | 0% |
| 降級率 | 3% |
| 每個完成任務的花費 | US$0.00088 |
| 總花費 | US$0.06103 |
| 延遲 平均／P50／P90／最大 | 5.3s／3.7s／8.4s／26.3s |
| agent:commercial 延遲 P50／P90 | 2.4s／6.0s |
| agent:supply_chain 延遲 P50／P90 | 2.4s／14.6s |
| router 延遲 P50／P90 | 0.9s／1.6s |
| 平均 token（輸入／輸出，含 Router） | 2806／360 |
| 類別 paraphrase | 67% |
| 類別 permissions | 100% |
| 類別 query | 100% |
| 類別 regressions | 25% |
| 類別 write | 67% |

## 與基準比較（`20261009T0540-phase1-step1-api-writes`）

- 退步（✅ → ❌）：`pp-create-order`、`pp-multi-turn-answer`、`w-create-order`
- 修好（❌ → ✅）：`pp-inventory`、`q-no-id-leak`
- 設定差異：
  - hash.prompt.commercial: 27cdb85e → 97dcbbc0
  - hash.tools: 81b4ef47 → bce881b0

## 各案例

| 案例 | 通過 | 路由 | 呼叫的 tools |
|------|------|------|--------------|
| ✅ `pp-customers` 改寫：客戶名單 | 3/3 | commercial | list_customers |
| ✅ `pp-latest-po` 改寫：最近一張採購單 | 3/3 | supply_chain | list_purchase_orders |
| ✅ `pp-low-stock` 改寫：快缺貨的布 | 3/3 | supply_chain | get_low_stock_alerts |
| ✅ `pp-inventory` 改寫：庫存剩多少（顏色在前） | 3/3 | supply_chain | get_inventory_summary |
| ✅ `pp-unpaid` 改寫：還沒付錢的訂單 | 3/3 | commercial | list_orders |
| ❌ `pp-create-order` 改寫：開一張新訂單 | 0/3 | commercial | list_customers, list_products |
| ❌ `pp-create-po` 改寫：跟工廠訂布 | 0/3 | commercial+supply_chain | list_products, list_customers |
| ✅ `pp-order-with-product` ★ 跨領域：客戶要訂某產品（只能建立訂單本身） | 3/3 | commercial | list_customers |
| ❌ `pp-multi-turn-answer` 多輪：上一輪問客戶，本輪只回名稱（F1 型） | 0/3 | commercial | list_customers |
| ✅ `p-accounting-cannot-create-order` 訪客不能建立訂單 | 3/3 | commercial | — |
| ✅ `p-viewer-cannot-create-customer` 訪客不能新增客戶 | 3/3 | commercial | — |
| ✅ `p-sales-cannot-create-po` 訪客不能建立採購單 | 3/3 | supply_chain | — |
| ✅ `q-list-customers` 查詢所有客戶 | 3/3 | commercial | list_customers |
| ✅ `q-customer-contact` 依名稱查客戶聯絡方式 | 3/3 | commercial | list_customers |
| ✅ `q-latest-po` 最新的採購單（不反問篩選條件） | 3/3 | supply_chain | list_purchase_orders |
| ✅ `q-low-stock` 庫存低於門檻的產品 | 3/3 | supply_chain | get_low_stock_alerts |
| ✅ `q-inventory-search` 查詢特定產品庫存 | 3/3 | supply_chain | list_products, get_inventory_summary |
| ✅ `q-unpaid-orders` 未付款訂單（帶篩選參數） | 3/3 | commercial | list_orders |
| ✅ `q-factories` 合作工廠列表 | 3/3 | supply_chain | list_factories |
| ✅ `q-recent-shipping` 最近的出貨紀錄 | 3/3 | supply_chain | list_shippings |
| ✅ `q-no-id-leak` 使用者要求顯示 ID 也不可洩漏 UUID | 3/3 | supply_chain | list_factories |
| ❌ `r-duplicate-history` history 中有重複訊息（2026-10-07 事故）仍可正常回應 | 0/3 | commercial | — |
| ❌ `r-multi-turn-order` 多輪建單：上一輪已詢問客戶名稱，本輪只回答名稱 | 0/3 | commercial | list_customers |
| ❌ `r-entity-memory` 實體記憶：上一輪已找到客戶，本輪用代名詞建單（P0-4） | 0/3 | commercial | list_products, list_customers, create_order |
| ✅ `r-after-confirmation` 確認卡片完成後的下一個新增要求，必須真的建立草稿（2026-10-07 實測事故） | 3/3 | commercial | create_customer |
| ❌ `w-create-order` 為既有客戶建立訂單 | 0/3 | commercial | list_customers |
| ✅ `w-order-unknown-customer` 找不到客戶時詢問是否新增，不可直接建單 | 3/3 | commercial | list_customers |
| ✅ `w-create-po` 建立採購單（工廠＋產品＋數量＋單價） | 3/3 | supply_chain | list_factories, list_products, create_purchase_order |
| ❌ `w-cross-domain-order` 跨領域建單：客戶＋指定工廠＋產品（2026-10-07 事故原句，補上數量與單價） | 0/3 | commercial+supply_chain | list_customers, list_factories, list_products, create_purchase_order |
| ✅ `w-create-order-no-items` ★ 建單但沒有提供品項 | 3/3 | commercial | list_customers |
| ✅ `w-cross-domain-incomplete` ★ 跨領域建單，缺少數量與單價（2026-10-07 事故原句） | 3/3 | commercial+supply_chain | list_factories |

## 失敗明細

### `pp-create-order` 改寫：開一張新訂單

- run 1：calls create_order（called: list_customers, list_products）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000004"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：已為您找到客戶「永泰布行」和產品「棉麻平織 (米白)」。請確認訂單資訊：客戶：永泰布行，產品：棉麻平織 (米白)，數量：30 公斤，單價：120。是否需要為此訂單新增其他品項？
- run 2：calls create_order（called: list_customers, list_products）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000004"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：已為您找到客戶「永泰布行」和產品「棉麻平織 (米白)」。請確認訂單資訊：客戶：永泰布行，產品：棉麻平織 (米白)，數量：30 公斤，單價：120。是否需要為此訂單新增其他品項？
- run 3：calls create_order（called: list_customers, list_products）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000004"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：已為您找到客戶「永泰布行」和產品「棉麻平織 (米白)」。請確認訂單資訊：客戶：永泰布行，產品：棉麻平織 (米白)，數量：30 公斤，單價：120。是否需要為此訂單新增其他品項？

### `pp-create-po` 改寫：跟工廠訂布

- run 1：calls create_purchase_order（called: list_products, list_customers）；drafts 1 × create_purchase_order（actual: 0）
  - 回覆：**📋 商務管理** 找不到客戶「永興織造」，是否要新增此客戶？若否，請提供正確的客戶名稱。 --- **📦 供應鏈** 抱歉，找不到您說的「棉麻平織米白」這個產品。請確認產品名稱是否正確？
- run 2：calls create_purchase_order（called: list_customers, list_products）；drafts 1 × create_purchase_order（actual: 0）
  - 回覆：**📋 商務管理** 找不到客戶「永興織造」，是否要新增此客戶？若否，請提供正確的客戶名稱。 --- **📦 供應鏈** 抱歉，找不到您說的「棉麻平織米白」這個產品。請確認產品名稱是否正確？
- run 3：calls create_purchase_order（called: list_customers, list_products）；drafts 1 × create_purchase_order（actual: 0）
  - 回覆：**📋 商務管理** 找不到客戶「永興織造」，是否要新增此客戶？若否，請提供正確的客戶名稱。 --- **📦 供應鏈** 抱歉，找不到您說的「棉麻平織米白」這個產品。請確認產品名稱是否正確？

### `pp-multi-turn-answer` 多輪：上一輪問客戶，本輪只回名稱（F1 型）

- run 1：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000002"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：好的，這是客戶 Chen1 的訂單，請問是這位客戶嗎？ - 陳小美 
- run 2：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000002"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：好的，這是客戶 Chen1 的訂單，請問是這位客戶嗎？ - 陳小美 
- run 3：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000002"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：好的，這是客戶 Chen1 的訂單，請問是這位客戶嗎？ - 陳小美 

### `r-duplicate-history` history 中有重複訊息（2026-10-07 事故）仍可正常回應

- run 1：calls list_customers（called: (none)）
  - 回覆：好的，請提供客戶名稱，以便為您查詢客戶資料。
- run 2：calls list_customers（called: (none)）
  - 回覆：好的，請提供客戶名稱，以便為您查詢客戶資料。
- run 3：calls list_customers（called: (none)）
  - 回覆：好的，請提供客戶名稱，以便為您查詢客戶資料。

### `r-multi-turn-order` 多輪建單：上一輪已詢問客戶名稱，本輪只回答名稱

- run 1：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000004"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：好的，找到客戶「永泰布行」，請問是要訂購「雲朵眠 test0922 藍0922」20公斤，單價80元，對嗎？
- run 2：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000004"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：好的，找到客戶「永泰布行」，請問是要訂購「雲朵眠 test0922 藍0922」20公斤，單價80元，對嗎？
- run 3：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000004"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：好的，找到客戶「永泰布行」，請問是要訂購「雲朵眠 test0922 藍0922」20公斤，單價80元，對嗎？

### `r-entity-memory` 實體記憶：上一輪已找到客戶，本輪用代名詞建單（P0-4）

- run 1：does not call list_customers
  - 回覆：已建立草稿，請在下方的確認卡片確認內容。
- run 2：does not call list_customers
  - 回覆：已建立草稿，請在下方的確認卡片確認內容。
- run 3：does not call list_customers
  - 回覆：已建立草稿，請在下方的確認卡片確認內容。

### `w-create-order` 為既有客戶建立訂單

- run 1：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000003"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：好的，已找到客戶 Client name test0922。接下來請提供產品的名稱和顏色，以便我為您查詢產品 ID。
- run 2：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000003"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：好的，已找到客戶 Client name test0922。接下來請提供產品的名稱和顏色，以便我為您查詢產品 ID。
- run 3：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000003"}（(not called)）；drafts 1 × create_order（actual: 0）
  - 回覆：好的，已找到客戶 Client name test0922。接下來請提供產品的名稱和顏色，以便我為您查詢產品 ID。

### `w-cross-domain-order` 跨領域建單：客戶＋指定工廠＋產品（2026-10-07 事故原句，補上數量與單價）

- run 1：calls create_order（called: list_customers, list_factories, list_products, create_purchase_order）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000003","factory_ids":["f0000000-0000-4000-8000-000000000001"]}（(not called)）；drafts 1 × create_order（actual: 0）；drafts 0 × create_purchase_order（actual: 1）
  - 回覆：**📋 商務管理** 好的，找到客戶 Client name test0922，請問這個客戶的訂單內容是雲朵眠 test0922 買藍0922 100 公斤，單價 50，這樣對嗎？ --- **📦 供應鏈** 已建立草稿，請在下方的確認卡片確認內容。
- run 2：calls create_order（called: list_customers, list_factories, list_products, create_purchase_order）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000003","factory_ids":["f0000000-0000-4000-8000-000000000001"]}（(not called)）；drafts 1 × create_order（actual: 0）；drafts 0 × create_purchase_order（actual: 1）
  - 回覆：**📋 商務管理** 好的，找到客戶 Client name test0922，請問這個客戶的訂單內容是雲朵眠 test0922 買藍0922 100 公斤，單價 50，這樣對嗎？ --- **📦 供應鏈** 已建立草稿，請在下方的確認卡片確認內容。
- run 3：calls create_order（called: list_customers, list_factories, list_products, create_purchase_order）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000003","factory_ids":["f0000000-0000-4000-8000-000000000001"]}（(not called)）；drafts 1 × create_order（actual: 0）；drafts 0 × create_purchase_order（actual: 1）
  - 回覆：**📋 商務管理** 好的，找到客戶 Client name test0922，請問這個客戶的訂單內容是雲朵眠 test0922 買藍0922 100 公斤，單價 50，這樣對嗎？ --- **📦 供應鏈** 已建立草稿，請在下方的確認卡片確認內容。
