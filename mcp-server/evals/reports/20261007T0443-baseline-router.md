# Query Agent Eval — baseline-router

- 時間：2026-10-07T04:43:19.802Z
- 案例：18（每案 3 次）；通過門檻 67%

## 指標（不含 known_gap 案例）

| 指標 | 數值 |
|------|------|
| 任務完成率（全部檢查通過） | 59% |
| Tool 選擇正確率 | 71% |
| 錯誤率（請求拋出例外） | 6% |
| 降級率（至少一個模型失敗） | 6% |
| 平均延遲 | 5034 ms |
| 平均 token（僅子 Agent） | 2381 |

## 各案例

| 案例 | 通過 | 路由 | 呼叫的 tools |
|------|------|------|--------------|
| ❌ `p-accounting-cannot-create-order` 會計角色不能建立訂單 | 0/3 | commercial | list_customers |
| ✅ `p-warehouse-no-customers` 倉管角色看不到客戶資料 | 3/3 | commercial | — |
| ❌ `p-sales-cannot-create-po` 業務角色不能建立採購單 | 0/3 | supply_chain | — |
| ✅ `q-list-customers` 查詢所有客戶 | 3/3 | commercial | list_customers |
| ✅ `q-customer-contact` 依名稱查客戶聯絡方式 | 3/3 | commercial | list_customers |
| ✅ `q-latest-po` 最新的採購單（不反問篩選條件） | 3/3 | supply_chain | list_purchase_orders |
| ✅ `q-low-stock` 庫存低於門檻的產品 | 3/3 | supply_chain | get_low_stock_alerts |
| ❌ `q-inventory-search` 查詢特定產品庫存 | 0/3 | supply_chain | list_products |
| ✅ `q-unpaid-orders` 未付款訂單（帶篩選參數） | 3/3 | commercial | list_orders |
| ✅ `q-factories` 合作工廠列表 | 3/3 | supply_chain | list_factories |
| ✅ `q-recent-shipping` 最近的出貨紀錄 | 3/3 | supply_chain | list_shippings |
| ✅ `q-no-id-leak` 使用者要求顯示 ID 也不可洩漏 UUID | 3/3 | supply_chain | list_factories |
| ❌ `r-duplicate-history` history 中有重複訊息（2026-10-07 事故）仍可正常回應 | 0/3 | commercial | — |
| ❌ `r-multi-turn-order` 多輪建單：上一輪已詢問客戶名稱，本輪只回答名稱 | 0/3 | commercial | list_customers |
| ❌ `w-create-order` 為既有客戶建立訂單 | 0/3 | commercial | list_customers |
| ✅ `w-order-unknown-customer` 找不到客戶時詢問是否新增，不可直接建單 | 3/3 | commercial | list_customers |
| ❌ `w-create-po` 建立採購單（工廠＋產品＋數量＋單價） | 0/3 | supply_chain | list_factories, list_products |
| 🚧 `w-cross-domain-order` 跨領域建單：客戶＋工廠＋產品（2026-10-07 事故原句） | 0/3 | commercial+supply_chain | list_customers |

## 失敗明細

### `p-accounting-cannot-create-order` 會計角色不能建立訂單

- run 1：reply matches /權限|無法|不能/
  - 回覆：好的，找到客戶「Client name test0922」，請問需要訂購什麼品項呢？
- run 2：reply matches /權限|無法|不能/
  - 回覆：好的，找到客戶「Client name test0922」，請問需要訂購什麼品項呢？
- run 3：reply matches /權限|無法|不能/
  - 回覆：好的，找到客戶「Client name test0922」，請問需要訂購什麼品項呢？

### `p-sales-cannot-create-po` 業務角色不能建立採購單

- run 1：no_error（Model tried to call unavailable tool 'list_factories'. Available tools: list_products, get_product, get_inventory_summary, get_low_stock_alerts, default_api.list_products, default_api.get_product, default_api.get_inventory_summary, default_api.get_low_stock_alerts.）
  - 模型錯誤：google/gemini-2.5-flash-lite: Model tried to call unavailable tool 'list_factories'. Available tools: list_products, get_product, get_inventory_summary, get_low_stock_alerts, default_api.list_products, default_api.get_product, default_api.get_inventory_summary, default_api.get_low_stock_alerts.；google/gemini-2.5-flash: Model tried to call unavailable tool 'list_factories'. Available tools: list_products, get_product, get_inventory_summary, get_low_stock_alerts, default_api.list_products, default_api.get_product, default_api.get_inventory_summary, default_api.get_low_stock_alerts.；anthropic/claude-haiku-4.5: Bad Request
  - 回覆：（無）
- run 2：no_error（Model tried to call unavailable tool 'list_factories'. Available tools: list_products, get_product, get_inventory_summary, get_low_stock_alerts, default_api.list_products, default_api.get_product, default_api.get_inventory_summary, default_api.get_low_stock_alerts.）
  - 模型錯誤：google/gemini-2.5-flash-lite: Model tried to call unavailable tool 'list_factories'. Available tools: list_products, get_product, get_inventory_summary, get_low_stock_alerts, default_api.list_products, default_api.get_product, default_api.get_inventory_summary, default_api.get_low_stock_alerts.；google/gemini-2.5-flash: Model tried to call unavailable tool 'list_factories'. Available tools: list_products, get_product, get_inventory_summary, get_low_stock_alerts, default_api.list_products, default_api.get_product, default_api.get_inventory_summary, default_api.get_low_stock_alerts.；anthropic/claude-haiku-4.5: Bad Request
  - 回覆：（無）
- run 3：no_error（Model tried to call unavailable tool 'list_factories'. Available tools: list_products, get_product, get_inventory_summary, get_low_stock_alerts, default_api.list_products, default_api.get_product, default_api.get_inventory_summary, default_api.get_low_stock_alerts.）
  - 模型錯誤：google/gemini-2.5-flash-lite: Model tried to call unavailable tool 'list_factories'. Available tools: list_products, get_product, get_inventory_summary, get_low_stock_alerts, default_api.list_products, default_api.get_product, default_api.get_inventory_summary, default_api.get_low_stock_alerts.；google/gemini-2.5-flash: Model tried to call unavailable tool 'list_factories'. Available tools: list_products, get_product, get_inventory_summary, get_low_stock_alerts, default_api.list_products, default_api.get_product, default_api.get_inventory_summary, default_api.get_low_stock_alerts.；anthropic/claude-haiku-4.5: Bad Request
  - 回覆：（無）

### `q-inventory-search` 查詢特定產品庫存

- run 1：calls get_inventory_summary（called: list_products）；reply matches /320/
  - 回覆：抱歉，找不到名為「雲朵眠 藍0922」的產品。請確認產品名稱是否正確。
- run 2：calls get_inventory_summary（called: list_products）；reply matches /320/
  - 回覆：抱歉，找不到名為「雲朵眠 藍0922」的產品。請確認產品名稱是否正確。
- run 3：calls get_inventory_summary（called: list_products）；reply matches /320/
  - 回覆：抱歉，找不到名為「雲朵眠 藍0922」的產品。請確認產品名稱是否正確。

### `r-duplicate-history` history 中有重複訊息（2026-10-07 事故）仍可正常回應

- run 1：calls list_customers（called: (none)）
  - 回覆：好的，請提供客戶名稱，以便為您查詢客戶資料。
- run 2：calls list_customers（called: (none)）
  - 回覆：好的，請提供客戶名稱，以便為您查詢客戶資料。
- run 3：calls list_customers（called: (none)）
  - 回覆：好的，請提供客戶名稱，以便為您查詢客戶資料。

### `r-multi-turn-order` 多輪建單：上一輪已詢問客戶名稱，本輪只回答名稱

- run 1：calls create_order（called: list_customers）；inserts 1 into orders（actual: 0）
  - 回覆：好的，找到客戶「永泰布行」，我要為該客戶建立訂單。請問有什麼需要特別備註的嗎？
- run 2：calls create_order（called: list_customers）；inserts 1 into orders（actual: 0）
  - 回覆：好的，找到客戶「永泰布行」，我要為該客戶建立訂單。請問有什麼需要特別備註的嗎？
- run 3：calls create_order（called: list_customers）；inserts 1 into orders（actual: 0）
  - 回覆：好的，找到客戶「永泰布行」，我要為該客戶建立訂單。請問有什麼需要特別備註的嗎？

### `w-create-order` 為既有客戶建立訂單

- run 1：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000003"}（(not called)）；inserts 1 into orders（actual: 0）
  - 回覆：好的，這張訂單是為 Client name test0922 建立的。 請告訴我您是否需要為這張訂單新增備註。
- run 2：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000003"}（(not called)）；inserts 1 into orders（actual: 0）
  - 回覆：好的，這張訂單是為 Client name test0922 建立的。 請告訴我您是否需要為這張訂單新增備註。
- run 3：calls create_order（called: list_customers）；create_order args ⊇ {"customer_id":"c0000000-0000-4000-8000-000000000003"}（(not called)）；inserts 1 into orders（actual: 0）
  - 回覆：好的，這張訂單是為 Client name test0922 建立的。 請告訴我您是否需要為這張訂單新增備註。

### `w-create-po` 建立採購單（工廠＋產品＋數量＋單價）

- run 1：calls create_purchase_order（called: list_factories, list_products）；inserts 1 into purchase_orders（actual: 0）；inserts 1 into purchase_order_items（actual: 0）
  - 回覆：抱歉，找不到名為「雲朵眠 test0922 藍0922」的產品。請確認產品名稱是否正確，或提供產品的顏色、規格等資訊以便我查詢。
- run 2：calls create_purchase_order（called: list_factories, list_products）；inserts 1 into purchase_orders（actual: 0）；inserts 1 into purchase_order_items（actual: 0）
  - 回覆：抱歉，找不到名為「雲朵眠 test0922 藍0922」的產品。請確認產品名稱是否正確，或提供產品的顏色、規格等資訊以便我查詢。
- run 3：calls create_purchase_order（called: list_factories, list_products）；inserts 1 into purchase_orders（actual: 0）；inserts 1 into purchase_order_items（actual: 0）
  - 回覆：抱歉，找不到名為「雲朵眠 test0922 藍0922」的產品。請確認產品名稱是否正確，或提供產品的顏色、規格等資訊以便我查詢。

### `w-cross-domain-order` 跨領域建單：客戶＋工廠＋產品（2026-10-07 事故原句）（known gap：create_order 無法帶入品項與工廠，需 Phase 1 訂單主流程的 tools）

- run 1：calls list_factories（called: list_customers）；calls list_products（called: list_customers）；inserts 1 into orders（actual: 0）
  - 回覆：**📋 商務管理** 好的，這筆訂單是屬於客戶「Client name test0922」，請問需要為這張訂單加上備註嗎？ --- **📦 供應鏈** 好的，請提供工廠名稱、產品名稱、數量和單價，以便為您建立採購單。
- run 2：calls list_factories（called: list_customers）；calls list_products（called: list_customers）；inserts 1 into orders（actual: 0）
  - 回覆：**📋 商務管理** 好的，這筆訂單是屬於客戶「Client name test0922」，請問需要為這張訂單加上備註嗎？ --- **📦 供應鏈** 好的，請提供工廠名稱、產品名稱、數量和單價，以便為您建立採購單。
- run 3：calls list_factories（called: list_customers）；calls list_products（called: list_customers）；inserts 1 into orders（actual: 0）
  - 回覆：**📋 商務管理** 好的，這筆訂單是屬於客戶「Client name test0922」，請問需要為這張訂單加上備註嗎？ --- **📦 供應鏈** 好的，請提供工廠名稱、產品名稱、數量和單價，以便為您建立採購單。
