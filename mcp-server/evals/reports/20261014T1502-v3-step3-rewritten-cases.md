# Query Agent Eval — v3-step3-rewritten-cases

- 報告：`20261014T1502-v3-step3-rewritten-cases`（2026-10-14T15:02:57.273Z）
- 案例：31（每案 3 次）；案例通過門檻 66%
- Dataset：`query-agent`（最新）；快照 `20261014T1502-7842c556.json`
- 資料庫一致性檢查：通過
- 架構：router；git 4e59225（有未提交的修改）

| 節點 | 模型（主 → 降級） |
|------|------------------|
| router | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:commercial | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |
| agent:supply_chain | google/gemini-2.5-flash-lite → google/gemini-2.5-flash → anthropic/claude-haiku-4.5 |

## 門檻

| 門檻 | 數值 | 要求 | 結果 |
|------|------|------|------|
| 整體任務完成率 | 77% | ≥ 85% | ❌ |
| 不可違反的規則 | 100% | ≥ 100% | ✅ |
| 沒有權限類案例 | 100% | ≥ 100% | ✅ |
| 寫入類案例（應產生草稿） | 33% | ≥ 100% | ❌ |
| 平均延遲 | 4.7s | ≤ 10.0s | ✅ |

## 指標（不含 🚧 案例；規則含全部案例）

| 指標 | 數值 |
|------|------|
| 任務完成率 | 77%（95% 信賴區間 60%–89%） |
| 規則全部通過 | 100% |
| 任務結果正確 | 77% |
| 寫入類完成率 | 33% |
| 錯誤率 | 0% |
| 降級率 | 6% |
| 每個完成任務的花費 | US$0.00044 |
| 總花費 | US$0.03171 |
| 延遲 平均／P50／P90／最大 | 4.7s／3.7s／7.6s／19.0s |
| agent:commercial 延遲 P50／P90 | 2.5s／5.7s |
| agent:supply_chain 延遲 P50／P90 | 2.6s／7.3s |
| router 延遲 P50／P90 | 1.0s／1.8s |
| 平均 token（輸入／輸出，含 Router） | 2699／136 |
| 類別 多輪 | 50% |
| 類別 找不到指定的資料 | 100% |
| 類別 改寫 | 57% |
| 類別 正常 | 83% |
| 類別 沒有權限 | 100% |
| 類別 資訊不足 | 100% |
| 領域 customer | 100% |
| 領域 factory | 100% |
| 領域 inventory | 100% |
| 領域 order | 57% |
| 領域 purchase | 80% |
| 領域 shipping | 100% |

## 診斷（不影響是否通過）

- Tool 選擇正確率：75%；Router 分派正確率：89%

| 應呼叫 | 實際呼叫 | 次數 |
|--------|----------|------|
| create_order | （沒有呼叫） | 9 |
| create_order | list_customers | 6 |
| create_order | list_products | 3 |
| create_purchase_order | list_customers | 3 |
| list_factories | list_customers | 3 |
| list_products | list_customers | 3 |

## 各案例

| 案例 | 類別 | 領域 | 通過 | 路由 | 呼叫的 tools |
|------|------|------|------|------|--------------|
| ✅ `p-accounting-cannot-create-order` 訪客不能建立訂單 | 沒有權限 | order | 3/3 | commercial | — |
| ✅ `p-sales-cannot-create-po` 訪客不能建立採購單 | 沒有權限 | purchase | 3/3 | supply_chain | list_factories, list_products |
| ✅ `p-viewer-cannot-create-customer` 訪客不能新增客戶 | 沒有權限 | customer | 3/3 | commercial | — |
| ❌ `pp-create-order` 改寫：開一張新訂單 | 改寫 | order | 0/3 | commercial | list_customers, list_products |
| ❌ `pp-create-po` 改寫：跟工廠訂布 | 改寫 | purchase | 0/3 | commercial | list_customers |
| ✅ `pp-customers` 改寫：客戶名單 | 改寫 | customer | 3/3 | commercial | list_customers |
| ✅ `pp-inventory` 改寫：庫存剩多少（顏色在前） | 改寫 | inventory | 3/3 | supply_chain | get_inventory_summary |
| ✅ `pp-latest-po` 改寫：最近一張採購單 | 改寫 | purchase | 3/3 | supply_chain | list_purchase_orders |
| ✅ `pp-low-stock` 改寫：快缺貨的布 | 改寫 | inventory | 3/3 | supply_chain | get_low_stock_alerts |
| ❌ `pp-multi-turn-answer` 多輪：上一輪問客戶，本輪只回名稱（F1 型） | 多輪 | order | 0/3 | commercial | list_customers, list_products |
| ✅ `pp-order-with-product` 跨領域：客戶要訂某產品（只能建立訂單本身） | 資訊不足 | order | 3/3 | commercial | list_customers |
| ❌ `pp-unpaid` 改寫：還沒付錢的訂單 | 改寫 | order | 0/3 | commercial | list_customers, list_orders |
| ✅ `q-customer-contact` 依名稱查客戶聯絡方式 | 正常 | customer | 3/3 | commercial | list_customers |
| ✅ `q-factories` 合作工廠列表 | 正常 | factory | 3/3 | supply_chain | list_factories |
| ✅ `q-inventory-search` 查詢特定產品庫存 | 正常 | inventory | 3/3 | supply_chain | get_inventory_summary |
| ✅ `q-latest-po` 最新的採購單（不反問篩選條件） | 正常 | purchase | 3/3 | supply_chain | list_purchase_orders |
| ✅ `q-list-customers` 查詢所有客戶 | 正常 | customer | 3/3 | commercial | list_customers |
| ✅ `q-low-stock` 庫存低於門檻的產品 | 正常 | inventory | 3/3 | supply_chain | get_low_stock_alerts |
| ✅ `q-no-id-leak` 使用者要求顯示 ID 也不可洩漏 UUID | 正常 | factory | 3/3 | supply_chain | list_factories |
| ✅ `q-recent-shipping` 最近的出貨紀錄 | 正常 | shipping | 3/3 | supply_chain | list_shippings |
| ✅ `q-unpaid-orders` 未付款訂單（帶篩選參數） | 正常 | order | 3/3 | commercial | list_orders |
| ✅ `r-after-confirmation` 確認卡片完成後的下一個新增要求，必須真的建立草稿（2026-10-07 實測事故） | 多輪 | customer | 3/3 | commercial | create_customer |
| ✅ `r-duplicate-history` history 中有重複訊息（2026-10-07 事故）仍可正常回應 | 資訊不足 | order | 3/3 | commercial | — |
| ✅ `r-entity-memory` 實體記憶：上一輪已找到客戶，本輪用代名詞建單（P0-4） | 多輪 | order | 3/3 | commercial | list_customers, list_products, create_order |
| ❌ `r-multi-turn-order` 多輪建單：上一輪已詢問客戶名稱，本輪只回答名稱 | 多輪 | order | 0/3 | commercial | list_customers |
| ❌ `w-create-order` 為既有客戶建立訂單 | 正常 | order | 0/3 | commercial | list_customers, list_products |
| ✅ `w-create-order-no-items` 建單但沒有提供品項 | 資訊不足 | order | 3/3 | commercial | list_customers |
| ✅ `w-create-po` 建立採購單（工廠＋產品＋數量＋單價） | 正常 | purchase | 3/3 | supply_chain | list_products, list_factories, create_purchase_order |
| ✅ `w-cross-domain-incomplete` 跨領域建單，缺少數量與單價（2026-10-07 事故原句） | 資訊不足 | order | 3/3 | commercial+supply_chain | list_factories, list_customers |
| ❌ `w-cross-domain-order` 跨領域建單：客戶＋指定工廠＋產品（2026-10-07 事故原句，補上數量與單價） | 正常 | order | 0/3 | commercial+supply_chain | list_customers, list_factories, list_products |
| ✅ `w-order-unknown-customer` 找不到客戶時詢問是否新增，不可直接建單 | 找不到指定的資料 | order | 3/3 | commercial | list_customers |

## 失敗明細

### `pp-create-order` 改寫：開一張新訂單

- run 1：one create_order draft（草稿：（無））；draft「客戶」= 永泰布行（（沒有此欄位））；draft「品項 1」= 棉麻平織 - 米白（色號 OW-01） × 30 公斤，單價 120（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_products）
  - 回覆：好的，請確認以下訂單資訊： 客戶：永泰布行 品項： - 棉麻平織 (米白色) - 數量：30 公斤 - 單價：120 元 是否需要為此訂單建立草稿？
- run 2：one create_order draft（草稿：（無））；draft「客戶」= 永泰布行（（沒有此欄位））；draft「品項 1」= 棉麻平織 - 米白（色號 OW-01） × 30 公斤，單價 120（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_products）
  - 回覆：好的，請確認以下訂單資訊： 客戶：永泰布行 品項： - 棉麻平織 (米白色) - 數量：30 公斤 - 單價：120 元 是否需要為此訂單建立草稿？
- run 3：one create_order draft（草稿：（無））；draft「客戶」= 永泰布行（（沒有此欄位））；draft「品項 1」= 棉麻平織 - 米白（色號 OW-01） × 30 公斤，單價 120（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_products）
  - 回覆：好的，請確認以下訂單資訊： 客戶：永泰布行 品項： - 棉麻平織 (米白色) - 數量：30 公斤 - 單價：120 元 是否需要為此訂單建立草稿？

### `pp-create-po` 改寫：跟工廠訂布

- run 1：one create_purchase_order draft（草稿：（無））；draft「工廠」= 永興織造（（沒有此欄位））
  - 診斷：calls list_factories（called: list_customers）；calls list_products（called: list_customers）；calls create_purchase_order（called: list_customers）；routes to supply_chain（commercial）
  - 回覆：抱歉，找不到客戶「永興織造」，是否要新增此客戶？
- run 2：one create_purchase_order draft（草稿：（無））；draft「工廠」= 永興織造（（沒有此欄位））
  - 診斷：calls list_factories（called: list_customers）；calls list_products（called: list_customers）；calls create_purchase_order（called: list_customers）；routes to supply_chain（commercial）
  - 回覆：抱歉，找不到客戶「永興織造」，是否要新增此客戶？
- run 3：one create_purchase_order draft（草稿：（無））；draft「工廠」= 永興織造（（沒有此欄位））
  - 診斷：calls list_factories（called: list_customers）；calls list_products（called: list_customers）；calls create_purchase_order（called: list_customers）；routes to supply_chain（commercial）
  - 回覆：抱歉，找不到客戶「永興織造」，是否要新增此客戶？

### `pp-multi-turn-answer` 多輪：上一輪問客戶，本輪只回名稱（F1 型）

- run 1：one create_order draft（草稿：（無））；draft「客戶」= Chen1（（沒有此欄位））；draft「品項 1」= 棉麻平織 - 米白（色號 OW-01） × 30 公斤，單價 120（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_products）
  - 回覆：好的，這張訂單是給客戶 Chen1 的嗎？訂單內容如下： * 產品：棉麻平織 (米白) * 數量：30 公斤 * 單價：120 請確認以上資訊是否正確。
- run 2：one create_order draft（草稿：（無））；draft「客戶」= Chen1（（沒有此欄位））；draft「品項 1」= 棉麻平織 - 米白（色號 OW-01） × 30 公斤，單價 120（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_products）
  - 回覆：好的，這張訂單是給客戶 Chen1 的嗎？訂單內容如下： * 產品：棉麻平織 (米白) * 數量：30 公斤 * 單價：120 請確認以上資訊是否正確。
- run 3：one create_order draft（草稿：（無））；draft「客戶」= Chen1（（沒有此欄位））；draft「品項 1」= 棉麻平織 - 米白（色號 OW-01） × 30 公斤，單價 120（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_products）
  - 回覆：好的，這張訂單是給客戶 Chen1 的嗎？訂單內容如下： * 產品：棉麻平織 (米白) * 數量：30 公斤 * 單價：120 請確認以上資訊是否正確。

### `pp-unpaid` 改寫：還沒付錢的訂單

- run 1：answer includes「ORD-20261001-001」
  - 回覆：尚未付款的訂單客戶如下： - Chen
- run 2：answer includes「ORD-20261001-001」
  - 回覆：尚未付款的訂單客戶如下： - Chen
- run 3：answer includes「ORD-20261001-001」
  - 回覆：尚未付款的訂單客戶如下： - Chen

### `r-multi-turn-order` 多輪建單：上一輪已詢問客戶名稱，本輪只回答名稱

- run 1：one create_order draft（草稿：（無））；draft「客戶」= 永泰布行（（沒有此欄位））；draft「品項 1」= 雲朵眠 test0922 - 藍0922（色號 BL-0922） × 20 公斤，單價 80（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers）
  - 回覆：找不到客戶「雲朵眠」，是否要新增此客戶？
- run 2：one create_order draft（草稿：（無））；draft「客戶」= 永泰布行（（沒有此欄位））；draft「品項 1」= 雲朵眠 test0922 - 藍0922（色號 BL-0922） × 20 公斤，單價 80（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers）
  - 回覆：找不到客戶「雲朵眠」，是否要新增此客戶？
- run 3：one create_order draft（草稿：（無））；draft「客戶」= 永泰布行（（沒有此欄位））；draft「品項 1」= 雲朵眠 test0922 - 藍0922（色號 BL-0922） × 20 公斤，單價 80（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers）
  - 回覆：找不到客戶「雲朵眠」，是否要新增此客戶？

### `w-create-order` 為既有客戶建立訂單

- run 1：one create_order draft（草稿：（無））；draft「客戶」= Client name test0922（（沒有此欄位））；draft「品項 1」= 雲朵眠 test0922 - 藍0922（色號 BL-0922） × 100 公斤，單價 50（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_products）
  - 回覆：好的，請確認這筆訂單： 客戶名稱：Client name test0922 訂單內容： - 產品名稱：雲朵眠 test0922 藍0922 - 數量：100 公斤 - 單價：50 是否需要為這筆訂單建立草稿？
- run 2：one create_order draft（草稿：（無））；draft「客戶」= Client name test0922（（沒有此欄位））；draft「品項 1」= 雲朵眠 test0922 - 藍0922（色號 BL-0922） × 100 公斤，單價 50（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_products）
  - 回覆：好的，請確認這筆訂單： 客戶名稱：Client name test0922 訂單內容： - 產品名稱：雲朵眠 test0922 藍0922 - 數量：100 公斤 - 單價：50 是否需要為這筆訂單建立草稿？
- run 3：one create_order draft（草稿：（無））；draft「客戶」= Client name test0922（（沒有此欄位））；draft「品項 1」= 雲朵眠 test0922 - 藍0922（色號 BL-0922） × 100 公斤，單價 50（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_products）
  - 回覆：好的，請確認這筆訂單： 客戶名稱：Client name test0922 訂單內容： - 產品名稱：雲朵眠 test0922 藍0922 - 數量：100 公斤 - 單價：50 是否需要為這筆訂單建立草稿？

### `w-cross-domain-order` 跨領域建單：客戶＋指定工廠＋產品（2026-10-07 事故原句，補上數量與單價）

- run 1：one create_order draft（草稿：（無））；draft「客戶」= Client name test0922（（沒有此欄位））；draft「品項 1」= 雲朵眠 test0922 - 藍0922（色號 BL-0922） × 100 公斤，單價 50（（沒有此欄位））；draft「指定工廠」= Factory 092202（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_factories, list_products）；routes to commercial（commercial+supply_chain）
  - 模型錯誤：agent:supply_chain google/gemini-2.5-flash-lite: Invalid arguments for tool create_purchase_order: Type validation failed: Value: {"factory_id":"f0000000-0000-4000-8000-000000000001","items":[]}.
Error message: [
  {
    "code": "too_small",
    "minimum": 1,
    "type": "array",
    "inclusive": true,
    "exact": false,
    "message": "Array must contain at least 1 element(s)",
    "path": [
      "items"
    ]
  }
]
  - 回覆：**📋 商務管理** 好的，這筆訂單的客戶是 Client name test0922，品項是雲朵眠 test0922，數量為 100 公斤，單價為 50。請問是要使用 ID 為 的藍色雲朵眠 test0922，還是 ID 為 的灰色雲朵眠 test0922 呢？ --- **📦 供應鏈** 抱歉，我找不到 Factory 092202 工廠。請確認工廠名稱是否正確。
- run 2：one create_order draft（草稿：（無））；draft「客戶」= Client name test0922（（沒有此欄位））；draft「品項 1」= 雲朵眠 test0922 - 藍0922（色號 BL-0922） × 100 公斤，單價 50（（沒有此欄位））；draft「指定工廠」= Factory 092202（（沒有此欄位））
  - 診斷：calls create_order（called: list_customers, list_factories, list_products）；routes to commercial（commercial+supply_chain）
  - 模型錯誤：agent:supply_chain google/gemini-2.5-flash-lite: Invalid arguments for tool create_purchase_order: Type validation failed: Value: {"items":[],"factory_id":"f0000000-0000-4000-8000-000000000001"}.
Error message: [
  {
    "code": "too_small",
    "minimum": 1,
    "type": "array",
    "inclusive": true,
    "exact": false,
    "message": "Array must contain at least 1 element(s)",
    "path": [
      "items"
    ]
  }
]
  - 回覆：**📋 商務管理** 好的，這筆訂單的客戶是 Client name test0922，品項是雲朵眠 test0922，數量為 100 公斤，單價為 50。請問是要使用 ID 為 的藍色雲朵眠 test0922，還是 ID 為 的灰色雲朵眠 test0922 呢？ --- **📦 供應鏈** 抱歉，我找不到 Factory 092202 工廠。請確認工廠名稱是否正確。
- run 3：one create_order draft（草稿：（無））；draft「客戶」= Client name test0922（（沒有此欄位））；draft「品項 1」= 雲朵眠 test0922 - 藍0922（色號 BL-0922） × 100 公斤，單價 50（（沒有此欄位））；draft「指定工廠」= Factory 092202（（沒有此欄位））
  - 診斷：calls create_order（called: list_factories, list_customers, list_products）；routes to commercial（commercial+supply_chain）
  - 模型錯誤：agent:supply_chain google/gemini-2.5-flash-lite: Invalid arguments for tool create_purchase_order: Type validation failed: Value: {"items":[],"factory_id":"f0000000-0000-4000-8000-000000000001"}.
Error message: [
  {
    "code": "too_small",
    "minimum": 1,
    "type": "array",
    "inclusive": true,
    "exact": false,
    "message": "Array must contain at least 1 element(s)",
    "path": [
      "items"
    ]
  }
]
  - 回覆：**📋 商務管理** 好的，這筆訂單的客戶是 Client name test0922，品項是雲朵眠 test0922，數量為 100 公斤，單價為 50。請問是要使用 ID 為 的藍色雲朵眠 test0922，還是 ID 為 的灰色雲朵眠 test0922 呢？ --- **📦 供應鏈** 抱歉，我找不到 Factory 092202 工廠。請確認工廠名稱是否正確。
