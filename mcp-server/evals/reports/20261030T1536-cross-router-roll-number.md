# Query Agent Eval — cross-router-roll-number

- 報告：`20261030T1536-cross-router-roll-number`（2026-10-30T15:36:55.505Z）
- 案例：15（每案 3 次）；案例通過門檻 66%；篩選 `gen-cross`
- Dataset：`query-agent`（最新）；快照 `20261030T1521-d55bf2ed.json`
- 資料庫一致性檢查：通過
- Prompt：Langfuse 標籤 `candidate`（query-router v2、query-agent-commercial v2、query-agent-supply_chain v2、query-agent-warehouse v2、query-agent-catalog v2、query-agent-facilities v2、query-agent-single v1、query-summary v1）
- 架構：router；git 5e3ef63（有未提交的修改）

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
| 不可違反的規則 | 98% | ≥ 100% | ❌ |

## 指標（不含 🚧 案例；規則含全部案例）

| 指標 | 數值 |
|------|------|
| 任務完成率 | — |
| 規則全部通過 | 98% |
| 任務結果正確 | — |
| 寫入類完成率 | — |
| 回覆品質（LLM 評分，僅記錄） | — |
| 錯誤率 | — |
| 降級率 | — |
| 每個完成任務的花費 | — |
| 總花費 | — |
| 延遲 平均／P50／P90／最大 | 0.0s／0.0s／0.0s／0.0s |
| 平均 token（輸入／輸出，含 Router） | —／— |

## 診斷（不影響是否通過）

- Tool 選擇正確率：—；Router 分派正確率：—
- 回覆品質（LLM 評分，校準前不計入門檻）：—

## 與基準比較（`20261030T1530-roll-number-lookup`）

- 退步（✅ → ❌）：無
- 修好（❌ → ✅）：無
- 設定差異：
  - hash.cases: 4258fc18 → 4dd51b51

## 各案例

| 案例 | 類別 | 領域 | 通過 | 路由 | 呼叫的 tools |
|------|------|------|------|------|--------------|
| 🚧 `gen-cross-01` 跨流程：大東的訂單庫存夠不夠出貨 | 跨流程 | order | 0/3 | commercial+warehouse / warehouse | list_orders, get_order |
| 🚧 `gen-cross-02` 跨流程：永泰未出完的量加總後比對庫存 | 跨流程 | order | 0/3 | commercial+warehouse / warehouse | list_customers, get_inventory_summary, list_products, list_orders, get_order |
| 🚧 `gen-cross-03` 跨流程：所有訂單的需求量對庫存的缺口 | 跨流程 | inventory | 0/3 | commercial+warehouse | list_products, list_orders, get_inventory_summary |
| 🚧 `gen-cross-04` 跨流程：在途採購加庫存夠不夠出所有訂單 | 跨流程 | purchase | 2/3 | supply_chain+warehouse+commercial | list_products, get_inventory_summary, list_orders, list_purchase_orders, get_purchase_order |
| 🚧 `gen-cross-05` 跨流程：庫存不足時依差額下採購單 | 跨流程 | purchase | 0/3 | commercial+supply_chain+warehouse / warehouse+supply_chain | list_customers, list_products, create_order, list_orders, get_order |
| 🚧 `gen-cross-06` 跨流程：庫存不夠就不開單，說明差額 | 跨流程 | order | 0/3 | commercial+warehouse | list_products, list_customers |
| 🚧 `gen-cross-07` 跨流程：庫存夠才開單（夠） | 跨流程 | order | 3/3 | warehouse+commercial | list_customers, get_inventory_summary, list_products, create_order |
| 🚧 `gen-cross-08` 跨流程：開單並回報庫存 | 跨流程 | order | 3/3 | commercial+warehouse | list_customers, list_products, create_order, get_inventory_summary |
| 🚧 `gen-cross-09` 跨流程：庫存加採購單未到的量 | 跨流程 | purchase | 0/3 | warehouse+supply_chain | get_inventory_summary, get_purchase_order |
| 🚧 `gen-cross-10` 跨流程：訂單要的布在和興有哪些採購單 | 跨流程 | purchase | 3/3 | supply_chain | list_orders, list_factories, list_purchase_orders |
| 🚧 `gen-cross-11` 跨流程：下採購單並指定到貨貨架 | 跨流程 | purchase | 3/3 | supply_chain / supply_chain+warehouse | list_factories, list_products, create_purchase_order |
| 🚧 `gen-cross-12` 跨流程多輪：上一輪查需求量，本輪比對庫存（夠，不下採購） | 跨流程 | inventory | 3/3 | warehouse+supply_chain | get_inventory_summary, list_factories |
| 🚧 `gen-cross-13` 跨流程：訂單未出量對單一布卷 | 跨流程 | shipping | 3/3 | warehouse | get_order, list_inventory_rolls |
| 🚧 `gen-cross-14` 跨流程：採購到貨前庫存已足夠 | 跨流程 | purchase | 0/3 | warehouse+supply_chain / supply_chain+warehouse | get_shipping, get_purchase_order, get_order, list_products |
| 🚧 `gen-cross-15` 跨流程＋沒有權限：可以查缺口，不能下採購單 | 跨流程 | purchase | 0/3 | warehouse+supply_chain / commercial+supply_chain+warehouse | list_customers, list_factories, list_products, list_orders, get_order, get_purchase_order, list_purchase_orders, get_inventory_summary |

## 失敗明細

### `gen-cross-01` 跨流程：大東的訂單庫存夠不夠出貨（不計分：生成的案例尚未審核）

- run 1：answer includes「450」
  - LLM 評分 30%：回覆違反多項政策：(1) 顯示了訂單編號等內部 ID，政策要求「不顯示內部 ID」；(2) 未根據工具查到的資料回答，而是直接呈現資料庫欄位，包括訂單狀態、付款狀態等使用者未詢問的資訊；(3) 雖然回答了庫存不足，但缺少具體的庫存數字對比，無法讓使用者清楚了解差距；(4) 跨流程查詢應整合多個流程資料，但回覆未顯示庫存流程的具體庫存量資訊。
  - 回覆：您好，關於大東紡織的訂單 B202610090004，目前庫存不足以出貨。 訂單詳情： * 訂單編號：B202610090004 * 訂單狀態：confirmed * 出貨狀態：not_started * 付款狀態：unpaid * 訂單日期：2026-10-09 訂單品項： * 產品：40S雙面布 - 藏青 * 訂購數量：300 公斤 * 已出貨數量：0 公斤 目前訂單的 40S雙面布 - 藏青
- run 2：answer includes「300」；answer includes「450」
  - 模型錯誤：agent:warehouse google/gemini-2.5-flash-lite: Too Many Requests；summary google/gemini-2.5-flash-lite: Too Many Requests
  - LLM 評分 30%：回覆有部分符合政策，但存在重大缺陷：

符合的地方：
- 使用繁體中文、語氣友善簡潔
- 正確指出無法判斷庫存是否足夠

違反政策的地方：
1. 顯示了內部 ID（訂單編號 B202610090004）和內部狀態欄位（confirmed、not_started、unpaid 等），這些對使用者無幫助
2. 回覆內容過於冗長，列舉了使用者未詢問的訂單詳細資訊
3. 最關鍵的問題：使用者詢問「庫存夠不夠出貨」，這是跨流程查詢（涉及訂單流程和庫存流程），Query 應該先查詢訂單內容（產品、數量），再查詢庫存，才能給出有意義的答案。目前的回覆只查了訂單狀態，沒有進行必要的跨流程整合查詢
4. 沒有說明為什麼無法判斷，也沒有告訴使用者需要什麼資訊才能回答
  - 回覆：大東紡織的訂單編號為 B202610090004，訂單狀態為 confirmed，出貨狀態為 not_started，付款狀態為 unpaid，訂單日期為 2026-10-09。 目前無法判斷庫存是否足夠出貨。
- run 3：answer includes「300」；answer includes「450」
  - 診斷：routes to commercial+warehouse（warehouse）
  - 模型錯誤：router google/gemini-2.5-flash-lite: Too Many Requests
  - LLM 評分 100%：符合政策。使用者查詢跨流程資料（訂單與庫存），但未提供訂單號碼等必要資訊。Query 的回覆友善簡潔，正確要求使用者補充資訊以進行查詢，符合「查詢要整合多個流程的資料回答」的前置條件。
  - 回覆：請提供訂單號碼，我才能查詢目前的庫存是否足夠出貨。

### `gen-cross-02` 跨流程：永泰未出完的量加總後比對庫存（不計分：生成的案例尚未審核）

- run 1：answer includes「90」
  - LLM 評分 30%：回覆有多項政策違反：(1) 顯示了內部單據編號（B202610020002等），政策要求不顯示內部ID；(2) 未整合多流程資料給出明確答案，只列出訂單狀態卻未提供「還要多少」的具體數字，無法回答使用者的核心問題；(3) 最後說「詳細數量資訊尚未提供」，但這些資訊應該從工具查詢取得，不應該向使用者要求；(4) 跨流程查詢應整合銷售、生產、庫存等流程資料後才回答，此回覆顯然未完成整合。
  - 回覆：您好，關於永泰布行尚未出完的「雲朵眠 - 藍」訂單總計需求量，以及目前庫存情況，現況如下： **訂單需求：** * **B202610020002**：尚未開始，未付款 * **B202610010001**：尚未開始，未付款 * **B202610080003**：部分出貨，部分付款 **庫存情況：** * 「雲朵眠 - 藍」的總庫存量為 320 公斤。 由於訂單的詳細數量資訊尚未提供，目前無法
- run 2：answer includes「90」
  - 診斷：routes to commercial+warehouse（warehouse）
  - 模型錯誤：router google/gemini-2.5-flash-lite: Too Many Requests；agent:warehouse google/gemini-2.5-flash-lite: Too Many Requests
  - LLM 評分 100%：回覆完全符合政策。使用繁體中文、語氣友善簡潔，根據查詢結果清楚列出：(1) 永泰布行現有庫存 130 公斤，(2) 兩筆訂單的待出貨需求（40+50=90 公斤），(3) 總庫存 320 公斤足以支應。數字標示正確單位（公斤），未顯示內部 ID，直接回答使用者「還要多少」和「庫存夠嗎」的問題。跨流程查詢資料整合恰當，無需建立草稿。
  - 回覆：永泰布行還有 130 公斤的雲朵眠 - 藍色 尚未出貨。 訂單編號 B202610080003： * 雲朵眠 - 藍：還差 40 公斤 訂單編號 B202610020002： * 雲朵眠 - 藍：還差 50 公斤 目前雲朵眠 - 藍 的庫存量為 320 公斤，足夠支應。
- run 3：answer includes「90」
  - LLM 評分 30%：回覆有多項政策違反：(1) 顯示了內部單據編號（B202610020002等），政策要求不顯示內部ID；(2) 未整合多流程資料給出明確答案，只列出訂單狀態卻未提供「還要多少」的具體數字，無法回答使用者的核心問題；(3) 最後說「詳細數量資訊尚未提供」，但這些資訊應該從工具查詢取得，不應該向使用者要求；(4) 跨流程查詢應整合銷售、生產、庫存等流程資料後才回答，此回覆顯然未完成整合。
  - 回覆：您好，關於永泰布行尚未出完的「雲朵眠 - 藍」訂單總計需求量，以及目前庫存情況，現況如下： **訂單需求：** * **B202610020002**：尚未開始，未付款 * **B202610010001**：尚未開始，未付款 * **B202610080003**：部分出貨，部分付款 **庫存情況：** * 「雲朵眠 - 藍」的總庫存量為 320 公斤。 由於訂單的詳細數量資訊尚未提供，目前無法

### `gen-cross-03` 跨流程：所有訂單的需求量對庫存的缺口（不計分：生成的案例尚未審核）

- run 1：answer includes「500」
  - LLM 評分 50%：回覆符合政策的大部分要求（繁體中文、友善簡潔、使用正確單位「公斤」、未顯示內部ID），但存在兩個問題：(1) 跨流程查詢應整合銷售訂單與庫存資料，回覆未明確說明查詢範圍（如是否包含所有未出貨狀態），(2) 若確實無未出貨訂單，應說明查詢依據或建議使用者確認條件，避免使用者誤解。建議補充說明查詢的流程範圍與時間範圍。
  - 回覆：您好，關於「40S雙面布 - 藏青」的訂單與庫存狀況： * 目前沒有尚未出貨的訂單。 * 「40S雙面布 - 藏青」的總庫存量為 450 公斤。 * 庫存量足夠，不需要追加。
- run 2：answer includes「500」
  - LLM 評分 50%：回覆符合政策的大部分要求（繁體中文、友善簡潔、使用正確單位「公斤」、未顯示內部ID），但存在兩個問題：(1) 跨流程查詢應整合銷售訂單與庫存資料，回覆未明確說明查詢範圍（如是否包含所有未出貨狀態），(2) 若確實無未出貨訂單，應說明查詢依據或建議使用者確認條件，避免使用者誤解。建議補充說明查詢的流程範圍與時間範圍。
  - 回覆：您好，關於「40S雙面布 - 藏青」的訂單與庫存狀況： * 目前沒有尚未出貨的訂單。 * 「40S雙面布 - 藏青」的總庫存量為 450 公斤。 * 庫存量足夠，不需要追加。
- run 3：answer includes「500」
  - LLM 評分 50%：回覆符合政策的大部分要求（繁體中文、友善簡潔、使用正確單位「公斤」、未顯示內部ID），但存在兩個問題：(1) 跨流程查詢應整合銷售訂單與庫存資料，回覆未明確說明查詢範圍（如是否包含所有未出貨狀態），(2) 若確實無未出貨訂單，應說明查詢依據或建議使用者確認條件，避免使用者誤解。建議補充說明查詢的流程範圍與時間範圍。
  - 回覆：您好，關於「40S雙面布 - 藏青」的訂單與庫存狀況： * 目前沒有尚未出貨的訂單。 * 「40S雙面布 - 藏青」的總庫存量為 450 公斤。 * 庫存量足夠，不需要追加。

### `gen-cross-04` 跨流程：在途採購加庫存夠不夠出所有訂單（不計分：生成的案例尚未審核）

- run 2：rule_latency（42.5s）
  - 診斷：routes to supply_chain+warehouse（commercial+supply_chain+warehouse）
  - 模型錯誤：summary google/gemini-2.5-flash-lite: Failed to process successful response
  - LLM 評分 60%：回覆部分符合政策，但有重大缺陷：(1) 正確地整合了採購與庫存資料，並計算出總可供量；(2) 正確地指出缺少訂單具體數量而無法判斷是否足夠；(3) 但列出訂單編號時未提供各訂單中該品項的需求數量，導致無法完整回答使用者的核心問題。政策要求「查詢要整合多個流程的資料回答」，此回覆應進一步查詢各訂單中 40S雙面布藏青 的具體需求量，才能給出明確的「夠不夠」判斷。
  - 回覆：關於 40S雙面布 藏青： **採購與庫存狀況：** * **在途採購量：** * P202610140001：100 公斤 (預計到貨日 2026-10-14) * P202610100001：200 公斤 (預計到貨日 2026-10-15) * P202609050001：150 公斤 (預計到貨日 2026-10-20) * 總計在途採購量：450 公斤 * **現有庫存：** 450 公

### `gen-cross-05` 跨流程：庫存不足時依差額下採購單（不計分：生成的案例尚未審核）

- run 1：one create_purchase_order draft（草稿：create_order, create_order）；draft「工廠」= 和興染整（（沒有此欄位））；draft「品項 1」= 40S雙面布 - 藏青 × 50 公斤，單價 120（（沒有此欄位））；answer includes「50」
  - 模型錯誤：agent:supply_chain google/gemini-2.5-flash-lite: Model returned an empty response (finishReason: stop)；agent:warehouse google/gemini-2.5-flash-lite: Cannot connect to API: 
  - LLM 評分 30%：回覆有多項違反政策的問題：

1. **捏造數據**：使用者未提供訂單數量，Query卻自行假設「各100公斤」並建立草稿，這違反「不捏造客戶、產品、單據或數字」的政策。

2. **跨流程處理不當**：政策明確指出「寫入要等每個流程的必填都齊全」，但Query在缺少關鍵資訊（訂單數量、庫存狀況）的情況下，仍然建立了銷售訂單草稿，這是不恰當的。

3. **應先查詢再判斷**：Query應該先查詢庫存和產品資訊，根據實際情況判斷是否需要採購，而非要求使用者提供ID。政策要求「只根據工具查到的資料回答」，應該是Query主動查詢，而非向使用者要求ID。

4. **流程順序錯誤**：應該先確認訂單數量→查詢庫存→判斷是否需採購→再建立相關單據，而非先建立不確定的草稿。
  - 回覆：為大東紡織和永泰布行建立了銷售訂單草稿，品項均為 40S雙面布 - 藏青，各 100 公斤，單價 120 元。 由於查詢不到 40S雙面布 - 藏青 的庫存資訊，也無法得知大東紡織和永泰布行的訂單數量，因此無法判斷是否需要向和興染整採購，也無法建立採購單。 請提供以下資訊以便繼續處理： * 40S雙面布 - 藏青 的產品 ID * 大東紡織和永泰布行的客戶 ID * 大東紡織和永泰布行的訂單數量
- run 2：one create_purchase_order draft（草稿：（無））；draft「工廠」= 和興染整（（沒有此欄位））；draft「品項 1」= 40S雙面布 - 藏青 × 50 公斤，單價 120（（沒有此欄位））；answer includes「50」
  - 模型錯誤：agent:supply_chain google/gemini-2.5-flash-lite: Model returned an empty response (finishReason: stop)；agent:commercial google/gemini-2.5-flash-lite: Too Many Requests；agent:warehouse google/gemini-2.5-flash-lite: Too Many Requests；summary google/gemini-2.5-flash-lite: Too Many Requests
  - LLM 評分 30%：Query 的回覆違反了政策。根據「跨流程」政策，查詢要整合多個流程的資料回答，寫入要等每個流程的必填都齊全。使用者已提供了明確的指示（出貨、補採購），Query 應該主動查詢系統中大東和永泰的訂單資訊及庫存，而不是反問使用者。此外，Query 沒有建立任何草稿卡片，表示沒有進行實際的系統操作。
  - 回覆：您好，關於大東紡織與永泰布行 40S雙面布藏青 的訂單，請提供以下資訊以便處理： * 大東紡織 40S雙面布藏青 的訂購數量 * 永泰布行 40S雙面布藏青 的訂購數量 待收到訂購數量後，我將會為您查詢庫存並處理後續的採購事宜。
- run 3：one create_purchase_order draft（草稿：（無））；draft「工廠」= 和興染整（（沒有此欄位））；draft「品項 1」= 40S雙面布 - 藏青 × 50 公斤，單價 120（（沒有此欄位））；answer includes「50」
  - 診斷：routes to commercial+supply_chain+warehouse（supply_chain+warehouse）
  - 模型錯誤：router google/gemini-2.5-flash-lite: Too Many Requests；agent:warehouse google/gemini-2.5-flash-lite: Too Many Requests
  - LLM 評分 0%：違反政策。使用者要求跨流程操作（出貨+採購），Query 應依各流程政策分別處理：先查詢訂單與庫存資料回答，再確認採購流程的必填資訊齊全後才能寫入。Query 直接回覆「查無相關訂單資料」並要求訂單編號，未能根據產品名稱（40S雙面布藏青）與客戶名稱（大東、永泰）進行合理查詢，也未建立任何草稿協助使用者確認後續步驟。
  - 回覆：您好，關於大東與永泰的 40S 雙面布藏青訂單出貨事宜，目前查無相關訂單資料。若需查詢或處理，請提供訂單編號。

### `gen-cross-06` 跨流程：庫存不夠就不開單，說明差額（不計分：生成的案例尚未審核）

- run 1：answer includes「45」；answer includes「55」
  - 模型錯誤：agent:warehouse google/gemini-2.5-flash-lite: Model returned an empty response (finishReason: stop)
  - LLM 評分 50%：回覆部分符合政策：正確使用繁體中文、語氣友善、標示單位（公斤）、未顯示內部 ID、未捏造資料。但有兩個問題：(1) 使用者要求「庫存夠就開單」，這是跨流程操作（查詢+寫入），Query 應該先確認庫存充足後才開單，但回覆未提及是否已開單或為何未開；(2) 回覆說「尚缺 100 公斤」，邏輯上應該是庫存為 0 才會缺 100 公斤，但未明確說明實際庫存數量，使用者無法判斷是否正確。
  - 回覆：您好，查詢到客戶名稱為「大東紡織」，所需產品為「雲朵眠 - 粉」，數量為 100 公斤。 目前庫存不足，尚缺 100 公斤，暫無法為您開立訂單。
- run 2：answer includes「45」；answer includes「55」
  - 模型錯誤：agent:warehouse google/gemini-2.5-flash-lite: Model returned an empty response (finishReason: stop)
  - LLM 評分 40%：回覆有以下問題：(1) 使用者要求「庫存夠就開單，不夠先別開，告訴我差多少」，Query 應該明確告知目前庫存數量和缺少的數量，但回覆只說「庫存不足」和「需補足 100 公斤」，沒有提供具體的庫存數字；(2) 使用者明確指示「不夠先別開」，Query 不應該主動建議採購，應該只回報缺口數量；(3) 根據跨流程政策，寫入要等每個流程的必填都齊全，但 Query 沒有建立草稿，表示沒有準備開單，這部分符合政策；(4) 缺少關鍵資訊：實際庫存數量和具體缺少多少公斤。
  - 回覆：您好，查詢到客戶名稱為「大東紡織」，所需產品為「雲朵眠 - 粉」，數量為 100 公斤。 由於目前庫存不足，無法立即開立訂單。請您確認是否需要進行採購，採購數量需補足 100 公斤。
- run 3：answer includes「45」；answer includes「55」
  - 模型錯誤：agent:warehouse google/gemini-2.5-flash-lite: Model returned an empty response (finishReason: stop)
  - LLM 評分 50%：回覆部分符合政策：正確使用繁體中文、語氣友善、標示單位（公斤）、未顯示內部 ID、未捏造資料。但有兩個問題：(1) 使用者要求「庫存夠就開單」，這是跨流程操作（查詢+寫入），Query 應該先確認庫存充足後才開單，但回覆未提及是否已開單或為何未開；(2) 回覆說「尚缺 100 公斤」，邏輯上應該是庫存為 0 才會缺 100 公斤，但未明確說明實際庫存數量，使用者無法判斷是否正確。
  - 回覆：您好，查詢到客戶名稱為「大東紡織」，所需產品為「雲朵眠 - 粉」，數量為 100 公斤。 目前庫存不足，尚缺 100 公斤，暫無法為您開立訂單。

### `gen-cross-09` 跨流程：庫存加採購單未到的量（不計分：生成的案例尚未審核）

- run 1：answer includes「320」；answer includes「338.5」
  - 模型錯誤：agent:warehouse google/gemini-2.5-flash-lite: Model returned an empty response (finishReason: stop)
  - LLM 評分 50%：回覆部分符合政策：正確查詢了採購單 P202610010002 的未到貨數量（18.5 公斤），並正確標示單位。但是，使用者要求整合多個流程的資料（庫存 + 採購未到貨）來計算總量，Query 只回覆了採購單的資料，沒有完成整合查詢。由於庫存查無資料，Query 應該說明無法計算總量，而不是只提供片段資訊。
  - 回覆：您好，關於「雲朵眠藍」的庫存量，目前查無資料。 另外，採購單 P202610010002 尚未到貨的數量為 18.5 公斤。
- run 2：answer includes「320」；answer includes「18.5」；answer includes「338.5」
  - 模型錯誤：agent:supply_chain google/gemini-2.5-flash-lite: Too Many Requests；agent:warehouse google/gemini-2.5-flash-lite: Model returned an empty response (finishReason: stop)
  - LLM 評分 50%：回覆符合政策的基本要求（繁體中文、友善簡潔、不捏造數據、無內部ID），但在跨流程查詢上有不足。根據政策「查詢要整合多個流程的資料回答」，Query應該主動說明已查詢了哪些流程（庫存管理、採購管理），而非籠統地說「查無資料」。建議應更具體地說明：已查詢庫存系統但無此產品、已查詢採購單但無此單號或該單已到貨等，幫助使用者了解查詢範圍，以便後續確認產品名稱或單號是否正確。
  - 回覆：您好，我查詢「雲朵眠藍」的庫存量，但目前查無資料。另外，採購單 P202610010002 尚未到貨的數量也查無資料。
- run 3：answer includes「320」；answer includes「18.5」；answer includes「338.5」
  - 模型錯誤：router google/gemini-2.5-flash-lite: Too Many Requests；agent:warehouse google/gemini-2.5-flash-lite: Too Many Requests；agent:supply_chain google/gemini-2.5-flash-lite: Too Many Requests
  - LLM 評分 60%：回覆部分符合政策。符合的地方：(1)使用繁體中文、語氣友善簡潔；(2)正確標示單位「公斤」；(3)誠實說明查無庫存資料，未捏造數字；(4)未顯示內部ID。

不符合的地方：(1)跨流程查詢應整合庫存流程與採購流程的資料，但只查到採購單資料，庫存流程的查詢似乎有問題，應進一步確認是否真的無此產品或查詢有誤；(2)面對查無庫存的情況，應主動提供排查建議（如確認產品名稱、檢查是否有別名等），而非直接放棄；(3)未建立草稿卡片，跨流程查詢結果應整理成卡片供使用者確認。
  - 回覆：您好，關於「雲朵眠藍」的庫存與預計到貨量，目前查詢結果如下： * **雲朵眠藍 庫存量：** 查無此產品的庫存資料。 * **採購單 P202610010002 預計到貨量：** 1000 公斤。 由於查無「雲朵眠藍」的庫存量，因此無法計算總計數量。

### `gen-cross-14` 跨流程：採購到貨前庫存已足夠（不計分：生成的案例尚未審核）

- run 1：answer includes「200」；answer includes「450」
  - 模型錯誤：agent:supply_chain google/gemini-2.5-flash-lite: Model returned an empty response (finishReason: stop)
  - LLM 評分 30%：回覆有多項政策違反：(1) 說「系統找不到此出貨單」是捏造錯誤，應只根據工具查到的資料回答；(2) 說「需要進一步查詢，目前無法得知」暗示沒有真正查詢，違反「只根據工具查到的資料回答」；(3) 跨流程查詢應整合採購與出貨流程資料，但回覆未展示實際查詢結果；(4) 未能提供明確的查詢結論。建議應明確說明已查詢但無相關資料，或提供實際查到的數字進行比對。
  - 回覆：您好，關於您詢問的 P202610140001 的布是否足夠出貨給 B202610010001 的問題，目前系統回報以下資訊： * **採購單 P202610140001 的到貨數量**：需要進一步查詢，目前無法得知。 * **出貨單 B202610010001**：系統找不到此出貨單。 由於無法得知採購單的到貨數量，且找不到對應的出貨單，因此目前無法判斷布料是否足夠出貨。
- run 2：answer includes「450」
  - 模型錯誤：router google/gemini-2.5-flash-lite: Too Many Requests；agent:supply_chain google/gemini-2.5-flash-lite: Too Many Requests；summary google/gemini-2.5-flash-lite: Too Many Requests
  - LLM 評分 30%：回覆有多項問題：(1) 混淆了採購單與銷售訂單的編號邏輯，說「找不到產品 P202610010001」不恰當，P開頭是採購單號不是產品；(2) 採購單到貨狀態「仍在查詢中」表示工具查詢未完成，不應該就回覆使用者；(3) 未能整合兩個流程的資料做出判斷，應該等到採購單到貨數量確認後，才能與銷售訂單需求量比較；(4) 根據跨流程政策，查詢要整合多流程資料回答，此回覆未完成整合。
  - 回覆：您好， 關於您的問題，目前查詢到以下資訊： * **銷售訂單 B202610010001**：品項為 40S雙面布 - 藏青，預計出貨量為 200 公斤。 * **採購單 P202610140001**：到貨狀態仍在查詢中，請稍等。 由於採購單 P202610140001 的到貨狀態尚未確認，因此目前無法判斷是否足夠出貨訂單 B202610010001。 另外，我們找不到產品 P202610010
- run 3：answer includes「450」
  - 模型錯誤：router google/gemini-2.5-flash-lite: Too Many Requests；agent:supply_chain google/gemini-2.5-flash-lite: Too Many Requests
  - LLM 評分 30%：回覆有多項政策違反：(1) 使用者問的是「P202610140001 的布到了的話，夠不夠出 B202610010001」，這是跨流程查詢（採購單→銷售單），應整合兩個流程的資料後回答，但 Query 只提供了銷售單的需求量，未查詢採購單的到貨數量，無法比較是否夠用；(2) 誤解使用者意圖，將「P202610010001」當作產品代碼要求補充，但使用者原意應是指採購單 P202610140001；(3) 回覆不完整，未能直接回答「夠不夠」的核心問題。
  - 回覆：您好，關於訂單 B202610010001 的出貨需求，需要 200 公斤的 40S雙面布 - 藏青。 目前採購單 P202610140001 的到貨狀態正在查詢中，請稍候。另外，系統找不到產品 P202610010001 的資訊，請提供產品代碼。

### `gen-cross-15` 跨流程＋沒有權限：可以查缺口，不能下採購單（不計分：生成的案例尚未審核）

- run 1：answer includes「50」
  - 診斷：routes to commercial+supply_chain+warehouse（supply_chain+warehouse）
  - 模型錯誤：router google/gemini-2.5-flash-lite: Too Many Requests；agent:warehouse google/gemini-2.5-flash-lite: Too Many Requests；agent:supply_chain google/gemini-2.5-flash-lite: Too Many Requests
  - LLM 評分 50%：回覆部分符合政策。正確地告知使用者沒有查詢訂單和下採購單的權限，但缺少「引導尋求管理員協助」的部分。政策要求應主動建議使用者聯繫管理員以獲得必要的權限或協助完成操作，而非僅說明無法執行。
  - 回覆：您好，由於本帳號沒有查詢訂單的權限，因此無法確認大東紡織與永泰布行的 40S雙面布藏青訂單出貨狀況，也無法得知庫存是否足夠。 此外，目前帳號也沒有下採購單的權限，因此無法向和興染整下採購單補足 40S雙面布藏青的差額。
- run 2：answer includes「50」
  - 診斷：routes to commercial+supply_chain+warehouse（supply_chain+warehouse）
  - 模型錯誤：router google/gemini-2.5-flash-lite: Too Many Requests；agent:warehouse google/gemini-2.5-flash-lite: Too Many Requests；agent:supply_chain google/gemini-2.5-flash-lite: Too Many Requests
  - LLM 評分 50%：回覆部分符合政策。正確地告知使用者沒有權限且未執行操作，但缺少「引導尋求管理員協助」或「改做其他有權限的操作」的建議，政策要求應提供後續解決方向。
  - 回覆：您好，由於目前帳號沒有查詢訂單出貨狀況、確認庫存以及下採購單的權限，因此無法為您處理此需求。
- run 3：answer includes「50」
  - 模型錯誤：agent:warehouse google/gemini-2.5-flash-lite: Model returned an empty response (finishReason: stop)
  - LLM 評分 0%：Query 的回覆違反政策。使用者要求跨流程操作（銷售→庫存查詢→採購），但 Query 聲稱「沒有查詢庫存的權限」後，仍然聲稱「已為大東紡織和永泰布行建立銷售訂單」。這是矛盾的：若無權限執行庫存查詢，就不應該執行銷售訂單建立。根據政策，應該告知使用者沒有權限執行此操作，引導尋求管理員協助，而不是部分執行。此外，Query 要求使用者提供「採購單的品項、數量、單價」，但使用者已明確提供單價 120，Query 不應該再要求。
  - 回覆：您好，已為大東紡織和永泰布行建立銷售訂單，產品為 40S雙面布 藏青。 由於目前帳號沒有查詢庫存的權限，因此無法判斷是否需要向和興染整採購。若需要採購，請提供以下資訊以建立採購單： * 採購單的品項（產品、數量、單價） * 採購單的預計到貨日期
