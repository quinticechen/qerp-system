# 業務 API（Phase 1，RBAC Session）

> 狀態：計畫草案（決策 B1–B6 待確認）；A0 共用基礎、A1 客戶與工廠、A2 訂單已套用並完成前端改用（2026-10-08）
> 相關文件：[QUERY_AGENT_PHASE1.md](./QUERY_AGENT_PHASE1.md) §2（API → Tool 契約）、[MULTI_TENANT_RBAC.md](./MULTI_TENANT_RBAC.md)、[SESSION_COORDINATION.md](./SESSION_COORDINATION.md)

## 1. 目標

把 12 個功能的寫入打包成資料庫 API（RPC），讓前端與 AI tools 呼叫同一份邏輯：

1. 權限、組織範圍、資料驗證都在 API 內完成，前端與 AI 不再各寫一份
2. 每個寫入 API 都有試算模式，AI 的確認卡片與真正寫入走同一段驗證
3. 前端改用 API 後，業務表的 RLS 才依權限鍵收緊（MULTI_TENANT_RBAC.md R4）

讀取：單表讀取維持直接查表＋RLS（Phase 0 D1）；跨表的讀取（例如訂單含品項與出貨進度）視 AI 的需求提供 RPC 或 `security_invoker` view。

## 2. 共用規則（A0）

### 2.1 函式

| 項目 | 規則 |
|------|------|
| 名稱 | `<動作>_<對象>`：`create_customer`、`update_customer`、`set_customer_active`、`create_order`、`cancel_order` |
| 參數 | 一律 `p_` 開頭；第一個參數是 `p_organization_id`；最後一個是 `p_dry_run boolean DEFAULT false` |
| 安全性 | `SECURITY DEFINER`、`SET search_path TO 'public'`；只開放給 `authenticated`。開頭先檢查權限鍵，再確認每一筆引用的資料（客戶、產品、訂單…）都屬於 `p_organization_id` |
| 權限 | 以 `api_require_permission(p_organization_id, '<鍵>')` 檢查，內部使用 `user_has_organization_permission()`（契約 §4） |
| 更新 | 以 `p_changes jsonb` 傳入要改的欄位：沒出現的欄位不變，出現且為空字串或 `null` 的欄位清空。方便 AI 只改一個欄位，也讓試算結果能列出「舊值 → 新值」 |
| 刪除 | 不提供。主檔以 `set_<對象>_active` 停用；單據以 `cancel_<對象>` 取消（R5） |

### 2.2 回傳

所有寫入 API 回傳同一種 `jsonb`：

```json
{
  "dry_run": true,
  "id": null,
  "number": null,
  "summary": {
    "title": "建立客戶",
    "fields": [{ "label": "公司名稱", "value": "永泰布行" }, { "label": "聯絡人", "value": "陳先生" }]
  }
}
```

- `id`：寫入後的 ID；試算建立時為 `null`
- `number`：可顯示的編號（訂單編號、採購單號、出貨單號）；沒有編號的對象為 `null`
- `summary`：以名稱表示的內容，格式與 AI 確認卡片相同；只列出有值的欄位；更新時 `value` 為「舊值 → 新值」，且只列出有變更的欄位

### 2.3 錯誤

錯誤以 `RAISE EXCEPTION '<給使用者看的中文>' USING ERRCODE = '<類別>', HINT = '<代碼>'` 拋出。前端與 AI 直接顯示 `message`，依 `hint` 判斷情況，不顯示資料庫原始錯誤。

| 類別（SQLSTATE） | 意義 | 代碼範例 |
|------------------|------|----------|
| `42501` | 沒有登入或沒有權限 | `forbidden` |
| `P0002` | 找不到（含屬於其他組織） | `customer_not_found`、`product_not_found` |
| `22023` | 輸入不正確 | `name_required`、`phone_required`、`invalid_email` |
| `23505` | 重複 | `customer_name_taken` |
| `55000` | 目前狀態不允許（例如已出貨不可取消） | `order_has_shipments` |

屬於其他組織的資料一律回報「找不到」，不透露它存在。

### 2.4 試算模式

- 簡單的寫入（主檔）：驗證完、組好 `summary` 後，`p_dry_run` 為 `true` 就直接回傳，不寫入
- 牽涉多張表的單據（訂單、採購、入庫、出貨）：在子交易中**真的寫入一次**，取得完整的驗證結果與 `summary` 後，以例外回滾子交易。試算與正式寫入因此走完全相同的程式與觸發器
- 試算不得消耗流水號：單據編號改由 API 依組織計算（§2.5），不使用 sequence

### 2.5 資料分類與單據編號（Phase 0 F14、B8）

| 類別 | 資料 |
|------|------|
| 主檔（Dim） | 客戶、產品、工廠、用戶、貨架、權限、系統設定 |
| 交易（Fact） | 訂單、採購單、進貨單（入庫）、出貨單；庫存查詢由交易彙總而來 |

交易單據統一編號：**類別字母＋YYYYMMDD＋四位流水號**，組織內唯一，依台灣日期每日重新起算。

| 單據 | 字母 | 範例 | 欄位 |
|------|------|------|------|
| 訂單 | B | `B202610080001` | `orders.order_number` |
| 採購單 | P | `P202610080001` | `purchase_orders.po_number` |
| 進貨單 | I | `I202610080001` | `inventories.receipt_number`（A2 新增；既有進貨單依建立日期補號） |
| 出貨單 | O | `O202610080001` | `shippings.shipping_number` |

- 由 `api_next_document_number()` 在交易內以 advisory lock 鎖住「組織＋單據種類＋日期」後取當日最大號＋1，不使用 sequence，因此試算回滾不會跳號
- 2026-10-08 以前建立的單據保留原編號（例如 `26K1007-097`、`PO-20261007-0027`、`SHIP-261007-001`）
- 尚未改用 API 的寫入（前端、AI 工具直接寫表）由觸發器編號，用戶端不能自訂編號

## 3. API 目錄

狀態：⏳ 規劃、🔧 實作中、✅ 完成（API 與前端改用都完成，並在 SESSION_COORDINATION.md §5 標記）。

### 流程 1：訂單主流程

| 組 | API | 權限鍵 | 說明 | 狀態 |
|----|-----|--------|------|------|
| A1 客戶 | `create_customer` | `canCreateCustomers` | 名稱、聯絡人必填；手機或市話至少一個；同組織不可重名 | ✅ |
| | `update_customer` | `canEditCustomers` | `p_changes` | ✅ |
| | `set_customer_active` | `canEditCustomers` | 停用後不出現在建單的客戶選單，既有單據不受影響 | ✅ |
| A2 訂單 | `create_order` | `canCreateOrders` | 客戶、品項（產品、數量、單價、卷數、規格）、指定工廠、備註；回傳訂單編號 | ✅ |
| | `update_order` | `canEditOrders` | 品項（沿用 `save_order_items` 的鎖定規則）、工廠、備註、付款狀態 | ✅ |
| | `cancel_order` | `canEditOrders` | 已有出貨或有效採購單時不可取消 | ✅ |
| A3 採購 | `create_purchase_order` | `canCreatePurchases` | 工廠、關聯訂單、品項、下單日、預計到貨日；關聯訂單改為「已向工廠下單」 | ✅ |
| | `update_purchase_order` | `canEditPurchases` | 沿用 `save_purchase_order_items` 的鎖定規則 | ✅ |
| | `cancel_purchase_order` | `canEditPurchases` | 已入庫時不可取消；關聯訂單沒有其他進行中的採購單時改回「已確認」 | ✅ |
| A4 入庫 | `receive_inventory` | `canCreateInventory` | 採購單、到貨日、布卷（產品、貨架、品質、重量、捲號）；更新採購單收貨進度 | ✅ |
| | `update_inventory` | `canEditInventory` | 到貨日、備註、布卷（沿用 `save_inventory_rolls` 的鎖定規則） | ✅ |
| | `update_inventory_roll` | `canEditInventory` | 單一布卷的重量、品質、倉庫、貨架 | ✅ |
| A5 出貨 | `create_shipping` | `canCreateShipping` | 訂單、出貨日、布卷與重量；扣庫存、更新訂單出貨進度 | ✅ |
| | `update_shipping` | `canEditShipping` | 沿用 `save_shipping_items` | ✅ |
| | `cancel_shipping` | `canEditShipping` | 歸還布卷庫存、重算訂單出貨進度（決策 B3） | ✅ |

### 流程 2：主檔維護

| 組 | API | 權限鍵 | 狀態 |
|----|-----|--------|------|
| A1 工廠（與客戶同一組） | `create_factory`、`update_factory`、`set_factory_active` | `canCreateFactories`／`canEditFactories` | ✅ |
| A6 產品 | `create_product`、`update_product`、`set_product_active`、`add_product_color`、`update_product_color`、`set_product_color_active`（兩層，見 §7） | `canCreateProducts`／`canEditProducts` | ✅ |
| A6 貨架 | `create_shelf`、`update_shelf`（名稱、位置）、`set_shelf_active` | `canCreateShelves`／`canEditShelves` | ✅ |

客戶與工廠的欄位與規則相同，所以與 A1 一起完成。

### 流程 3：管理功能（AI 唯讀，Phase 0 D3）

| API | 權限鍵 | 狀態 |
|-----|--------|------|
| `set_member_role`、`set_member_active`、邀請相關 | `canEditUsers`／`canCreateUsers` | ✅（RBAC R1） |
| `update_organization_settings` | `canEditSystemSettings` | ⏳（組織設定頁目前大多未接上功能，先確認要保留哪些設定） |

## 4. 每組 API 的交付清單

1. Migration：API、需要的欄位（例如 `is_active`）、權限與組織檢查
2. SQL 回滾測試 `supabase/tests/api_<組>.test.sql`：
   - 權限矩陣：訪客被拒、編輯者可以、他組織的人被拒
   - 引用他組織的資料一律「找不到」
   - 試算模式不寫入任何資料，且回傳的 `summary` 與正式寫入相同
   - 每個錯誤代碼至少一個案例
3. 前端改用 API（`src/lib/api/*.ts`），移除直接寫資料表的程式；`types.ts` 局部更新
4. 本文件 §5 補上 API 說明（參數、回傳、錯誤代碼）
5. SESSION_COORDINATION.md §5 標為「API 完成」，通知 AI Session
6. 之後由 RBAC Session 收緊該組資料表的 RLS（R4）

## 5. API 說明

所有寫入 API 都回傳 §2.2 的格式，錯誤依 §2.3。以下只列各 API 特有的內容。

### A1 客戶與工廠

Migration：`supabase/migrations/20261008170920_api_a1_customers_factories.sql`；測試：`supabase/tests/api_a1_customers_factories.test.sql`；前端：`src/lib/api/partners.ts`。

客戶與工廠的參數、規則完全相同，只有名稱、權限鍵與錯誤代碼的前綴不同（`customer_*`／`factory_*`）。以下以客戶為例。

**`create_customer`**（寫入，`canCreateCustomers`）

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `p_organization_id` | uuid | ✅ | 目前選擇的組織 |
| `p_name` | text | ✅ | 公司名稱；前後空白會去除；同組織內不可重名（不分大小寫） |
| `p_contact_person` | text | ✅ | 聯絡人 |
| `p_phone` | text | 二擇一 | 手機；與市話至少填一個 |
| `p_landline_phone` | text | 二擇一 | 市話 |
| `p_fax`、`p_email`、`p_address`、`p_note` | text | | 電子郵件需為 `名稱@網域` 格式；空字串視為未填 |
| `p_dry_run` | boolean | | `true` 時只驗證並回傳內容 |

回傳：`id` 為新客戶 ID；`summary.title` 為「建立客戶」，`fields` 依序為名稱、聯絡人、手機、市話、傳真、電子郵件、地址、備註（只列有值的欄位）。

**`update_customer`**（寫入，`canEditCustomers`）

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `p_organization_id` | uuid | ✅ | |
| `p_customer_id` | uuid | ✅ | 必須屬於 `p_organization_id`，否則回報找不到 |
| `p_changes` | jsonb | ✅ | 要修改的欄位：`name`、`contact_person`、`phone`、`landline_phone`、`fax`、`email`、`address`、`note`。沒出現的欄位不變；空字串或 `null` 清空 |
| `p_dry_run` | boolean | | |

合併後的客戶仍須符合建立時的規則（例如清空手機時必須有市話）。回傳：`summary.title` 為「修改客戶「<原名稱>」」，`fields` 只列出有變更的欄位，值為「舊值 → 新值」（空值顯示為「（空白）」）；沒有任何變更時 `fields` 為空陣列。

**`set_customer_active`**（寫入，`canEditCustomers`）

參數：`p_organization_id`、`p_customer_id`、`p_is_active`（boolean，必填）、`p_dry_run`。停用的客戶仍保留在既有單據上，但不會出現在新訂單的客戶選單。回傳：`summary` 為「停用客戶「<名稱>」」或「啟用客戶「<名稱>」」，`fields` 為「狀態：啟用 → 停用」（狀態沒有改變時為空陣列）。

**錯誤代碼**

| SQLSTATE | 代碼 | 訊息 |
|----------|------|------|
| `42501` | `not_signed_in`／`forbidden` | 請先登入／您的角色沒有權限執行此操作 |
| `P0002` | `customer_not_found`／`factory_not_found` | 找不到此客戶／工廠（含屬於其他組織的） |
| `22023` | `name_required` | 請輸入客戶名稱 |
| `22023` | `contact_person_required` | 請輸入聯絡人 |
| `22023` | `phone_required` | 手機或市話至少填一個 |
| `22023` | `invalid_email` | 電子郵件格式不正確 |
| `22023` | `invalid_changes`／`unknown_field` | 修改內容格式不正確／不支援修改的欄位：… |
| `22023` | `is_active_required` | 請指定要啟用或停用 |
| `23505` | `customer_name_taken`／`factory_name_taken` | 已有同名的客戶「…」 |

**讀取**：客戶與工廠的列表、單筆查詢維持直接查表。新增欄位 `is_active`；新單據的選單只列出 `is_active = true` 的資料。

### A2 訂單

Migration：`supabase/migrations/20261008181853_api_a2_orders.sql`；測試：`supabase/tests/api_a2_orders.test.sql`；前端：`src/lib/api/orders.ts`。

**單據編號（所有交易單據共用）**：見 §2.5，訂單為 `B202610080001`。試算不會用掉號碼。尚未改用 API 的寫入（採購、出貨的前端、AI 的建單工具）一律由觸發器以同樣規則編號，使用者不能自訂編號（與改版前相同）；只有 API 內部給的號碼會保留。

**`create_order`**（寫入，`canCreateOrders`）

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `p_organization_id` | uuid | ✅ | |
| `p_customer_id` | uuid | ✅ | 同組織、啟用中的客戶 |
| `p_items` | jsonb | ✅ | 至少一項：`[{ product_id, quantity, unit_price, total_rolls?, specifications? }]`；產品須屬同組織且未停用；數量 > 0、單價 ≥ 0 |
| `p_factory_ids` | uuid[] | | 指定工廠；同組織、啟用中 |
| `p_note` | text | | |
| `p_dry_run` | boolean | | |

回傳：`id`、`number`（訂單編號；試算時兩者皆為 `null`）。`summary.title` 為「建立訂單」，`fields` 依序為客戶、品項 1…n（「產品 - 顏色（色號）× 數量 公斤，單價 X」）、指定工廠、備註、訂單總額。

**`update_order`**（寫入，`canEditOrders`）

`p_changes` 可包含：

| 鍵 | 說明 |
|----|------|
| `items` | 完整的品項清單（與 `save_order_items` 相同）：有 `id` 的更新、沒有的新增、沒列出的刪除。已出貨或已採購的品項不可刪除或更換產品；數量不可低於已出貨量 |
| `factory_ids` | 完整的工廠清單，取代現有的 |
| `note` | 備註 |
| `status` | `pending`、`confirmed`、`factory_ordered`、`completed`；取消請用 `cancel_order` |
| `payment_status` | `unpaid`、`partial_paid`、`paid` |
| `shipping_status` | `not_started`、`partial_shipped`、`shipped`（通常由出貨自動計算；只在需要手動覆寫時傳入） |

回傳：`number` 為訂單編號；`summary.title` 為「修改訂單 <編號>」；`fields` 列出有變更的狀態、工廠、備註（「舊 → 新」），以及「移除品項」「修改品項」「新增品項」。已取消的訂單不能修改。

**`cancel_order`**（寫入，`canEditOrders`）

參數：`p_organization_id`、`p_order_id`、`p_reason`（選填）、`p_dry_run`。已有出貨紀錄、或有未取消的採購單時不能取消。取消後記錄 `cancelled_at`、`cancel_reason`，訂單不能再修改。

**錯誤代碼**（除共用的 `forbidden`、`not_signed_in`、`unknown_field`、`invalid_changes` 外）

| SQLSTATE | 代碼 | 訊息 |
|----------|------|------|
| `P0002` | `order_not_found`、`customer_not_found`、`product_not_found`、`factory_not_found`、`item_not_found` | 找不到此訂單／客戶／產品／工廠，訂單項目不屬於此訂單 |
| `22023` | `customer_inactive`、`product_unavailable`、`factory_inactive` | 客戶「…」已停用、產品「…」已停用、工廠「…」已停用 |
| `22023` | `items_required`、`invalid_quantity`、`invalid_unit_price` | 訂單至少需要一項產品、數量必須大於 0、單價不可為負數 |
| `22023` | `use_cancel_order`、`invalid_status`、`invalid_payment_status`、`invalid_shipping_status`、`invalid_factory_ids` | 請使用取消訂單、狀態不正確… |
| `55000` | `item_shipped`、`item_purchased`、`quantity_below_shipped` | 產品「…」已出貨／已採購，不可刪除或更換；數量不可低於已出貨 … 公斤 |
| `55000` | `order_cancelled`、`order_already_cancelled`、`order_has_shipments`、`order_has_purchase_orders` | 訂單 … 已取消，不能修改；已有出貨紀錄／有進行中的採購單 …，不能取消 |

### A3 採購單

Migration：`supabase/migrations/20261008193554_api_a3_purchase_orders.sql`；測試：`supabase/tests/api_a3_purchase_orders.test.sql`；前端：`src/lib/api/purchases.ts`。

**`create_purchase_order`**（`canCreatePurchases`）

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `p_factory_id` | uuid | ✅ | 同組織且未停用的工廠 |
| `p_items` | jsonb | ✅ | 至少一項：`[{ product_id, ordered_quantity, unit_price, ordered_rolls?, specifications? }]`；產品（顏色）與其產品都須啟用；數量 > 0、單價 ≥ 0 |
| `p_order_ids` | uuid[] | | 關聯訂單（同組織、未取消）；「待確認」「已確認」的訂單改為「已向工廠下單」 |
| `p_expected_arrival_date` | date | | 不可早於下單日期 |
| `p_note` | text | | |
| `p_order_date` | date | | 預設為台灣今天 |

回傳：`id`、`number`（採購單編號 P＋YYYYMMDD＋四位流水號；試算時兩者皆為 `null`）。狀態為「已下單」（`confirmed`）。`summary.title` 為「建立採購單」，`fields` 依序為工廠、關聯訂單、品項 1…n（「產品 - 顏色（色號）× 數量 公斤，單價 X」）、下單日期、預計到貨日期、備註、採購總額。

**`update_purchase_order`**（`canEditPurchases`）：`p_changes` 可含

| 鍵 | 說明 |
|----|------|
| `items` | 完整的品項清單（與 `save_purchase_order_items` 相同）：有 `id` 的更新、沒有的新增、沒列出的刪除。已入庫的品項不可刪除或更換產品；數量不可低於已入庫量 |
| `order_ids` | 完整的關聯訂單清單；新關聯的訂單改為「已向工廠下單」，移除關聯的訂單若沒有其他進行中的採購單則改回「已確認」 |
| `factory_id` | 已有入庫紀錄時不可更換 |
| `order_date`、`expected_arrival_date` | `YYYY-MM-DD`；預計到貨日期可用空字串清除 |
| `note` | 空字串清除 |
| `status` | `pending`、`confirmed`、`partial_received`、`completed`；入庫時會自動重算。取消請用 `cancel_purchase_order` |

`summary` 只列有變的欄位，品項以「移除品項／修改品項（舊 → 新）／新增品項」表示。

**`cancel_purchase_order`**（`canEditPurchases`）：`p_purchase_order_id`、`p_reason?`。已有入庫紀錄時不可取消。取消後記錄 `cancelled_at`、`cancel_reason`，採購單不能再修改；關聯保留作為紀錄，關聯訂單若沒有其他進行中的採購單，「已向工廠下單」改回「已確認」（之後才能取消該訂單）。

| SQLSTATE | 代碼 | 訊息 |
|----------|------|------|
| `P0002` | `purchase_order_not_found`、`factory_not_found`、`product_not_found`、`order_not_found`、`item_not_found` | 找不到此採購單／工廠／產品／訂單，採購項目不屬於此採購單 |
| `22023` | `factory_inactive`、`product_unavailable` | 工廠「…」已停用、產品「…」已停用 |
| `22023` | `items_required`、`invalid_quantity`、`invalid_unit_price`、`invalid_date`、`invalid_expected_arrival_date` | 採購單至少需要一項產品、採購數量必須大於 0、單價不可為負數、日期格式不正確、預計到貨日期不可早於下單日期 |
| `22023` | `use_cancel_purchase_order`、`invalid_status`、`invalid_order_ids`、`unknown_field` | 請使用取消採購單、採購單狀態不正確… |
| `55000` | `item_received`、`quantity_below_received` | 產品「…」已入庫，不可刪除或更換；採購數量不可低於已入庫 … 公斤 |
| `55000` | `order_cancelled`、`purchase_order_cancelled`、`purchase_order_already_cancelled`、`purchase_order_received` | 訂單 … 已取消；採購單 … 已取消，不能修改；已有入庫紀錄，不能取消或更換工廠 |

### A4 入庫（進貨單）

Migration：`supabase/migrations/20261008233705_api_a4_receiving.sql`；測試：`supabase/tests/api_a4_receiving.test.sql`；前端：`src/lib/api/inventory.ts`。

**`receive_inventory`**（`canCreateInventory`）

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `p_purchase_order_id` | uuid | ✅ | 同組織、未取消的採購單；工廠沿用採購單 |
| `p_rolls` | jsonb | ✅ | 至少一卷：`[{ product_id, quantity, warehouse_id, shelf?, quality?, roll_number?, specifications? }]`；產品必須在採購單上；重量 > 0；品質 `A`／`B`／`C`／`D`／`defective`，預設 `A`；不給 `roll_number` 時由系統產生（R＋YYMMDD＋九位數） |
| `p_arrival_date` | date | | 預設為台灣今天 |
| `p_note` | text | | |

回傳：`id`、`number`（進貨單編號 I＋YYYYMMDD＋四位流水號；試算時皆為 `null`）。入庫後採購單的已入庫量與狀態自動重算。超過採購量仍可入庫。`summary.title` 為「入庫」，`fields` 依序為採購單、工廠、到貨日期、產品 1…n（「產品 - 顏色 × N 卷，共 X 公斤」）、備註、合計，以及「超過採購量」（有超收時）。

**`update_inventory`**（`canEditInventory`）：`p_changes` 可含 `rolls`（完整的布卷清單：有 `id` 的更新、沒有的新增、沒列出的刪除；已出貨的布卷不可刪除或更換產品，重量不可低於已出貨量；新增或更換的產品必須在採購單上）、`arrival_date`、`note`。`summary` 只列有變的欄位，布卷以「移除布卷／修改布卷（舊 → 新）／新增布卷」表示，例如「R261008123456789 棉布 - 白 100 公斤（A 級，倉庫 一號倉 B-03）」。

**`update_inventory_roll`**（`canEditInventory`）：`p_roll_id`、`p_changes` 可含 `quantity`（入庫重量；已出貨量不變，庫存隨之調整）、`quality`、`warehouse_id`、`shelf`。回傳的 `number` 為布卷編號。

| SQLSTATE | 代碼 | 訊息 |
|----------|------|------|
| `P0002` | `purchase_order_not_found`、`inventory_not_found`、`roll_not_found`、`product_not_found`、`warehouse_not_found` | 找不到此採購單／入庫紀錄／布卷／產品／倉庫 |
| `22023` | `rolls_required`、`invalid_quantity`、`invalid_quality`、`invalid_date`、`product_not_on_purchase_order`、`unknown_field` | 入庫紀錄至少需要一卷布、布卷重量必須大於 0、產品「…」不在採購單上… |
| `23505` | `roll_number_taken` | 布卷編號「…」已被使用 |
| `55000` | `purchase_order_cancelled`、`roll_shipped`、`quantity_below_shipped` | 採購單 … 已取消，不能入庫；布卷「…」已出貨，不可刪除或更換產品；入庫重量不可低於已出貨 … 公斤 |

### A5 出貨單

Migration：`supabase/migrations/20261009000604_api_a5_shipping.sql`；測試：`supabase/tests/api_a5_shipping.test.sql`；前端：`src/lib/api/shipping.ts`。

出貨單新增 `status`（`shipped`／`cancelled`）、`cancelled_at`、`cancel_reason`。訂單的出貨量與出貨狀態只計算未取消的出貨單。

**`create_shipping`**（`canCreateShipping`）

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `p_order_id` | uuid | ✅ | 同組織、未取消的訂單；客戶沿用訂單 |
| `p_items` | jsonb | ✅ | 至少一卷：`[{ inventory_roll_id, shipped_quantity }]`；布卷須屬同組織，其產品須在訂單上；重量 > 0 且不可超過布卷剩餘庫存 |
| `p_shipping_date` | date | | 預設為台灣今天 |
| `p_note` | text | | |

回傳：`id`、`number`（出貨單編號 O＋YYYYMMDD＋四位流水號；試算時皆為 `null`）。同一個交易內扣除布卷庫存、更新訂單出貨進度。超過訂單量仍可出貨。`summary.title` 為「建立出貨單」，`fields` 依序為訂單、客戶、出貨日期、產品 1…n（「產品 - 顏色 × N 卷，共 X 公斤」）、備註、合計，以及「超過訂單量」（有超出時）。

**`update_shipping`**（`canEditShipping`）：`p_changes` 可含 `items`（完整的布卷清單：有 `id` 的更新、沒有的新增、沒列出的刪除；只把差額計入庫存）、`shipping_date`、`note`。已取消的出貨單不能修改。`summary` 以「移除布卷／修改布卷（舊 → 新）／新增布卷」表示，例如「R261008123456789 棉布 - 白 40 公斤」。

**`cancel_shipping`**（`canEditShipping`，決策 B3）：`p_shipping_id`、`p_reason?`。出貨的重量加回各布卷、訂單出貨進度重算；出貨項目保留作為紀錄。訂單的出貨單都取消後，訂單就可以取消（若沒有進行中的採購單）。

| SQLSTATE | 代碼 | 訊息 |
|----------|------|------|
| `P0002` | `order_not_found`、`shipping_not_found`、`roll_not_found`、`item_not_found` | 找不到此訂單／出貨單／布卷，出貨項目不屬於此出貨單 |
| `22023` | `items_required`、`invalid_quantity`、`roll_not_in_order`、`invalid_date`、`unknown_field` | 出貨單至少需要一卷布、出貨重量必須大於 0、布卷「…」的產品不在此訂單中… |
| `55000` | `order_cancelled`、`shipping_cancelled`、`shipping_already_cancelled`、`insufficient_stock` | 訂單 … 已取消，不能出貨；出貨單 … 已取消；布卷「…」庫存不足，最多可再出貨 … 公斤 |

### A6 產品與顏色

Migration：`supabase/migrations/20261008185816_api_a6_products.sql`；測試：`supabase/tests/api_a6_products.test.sql`；前端：`src/lib/api/products.ts`、`src/hooks/useProductCatalog.ts`。資料結構見 §7。

**`create_product`**（`canCreateProducts`）

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `p_name` | text | ✅ | 組織內唯一（不分大小寫、去除前後空白） |
| `p_colors` | jsonb | ✅ | 至少一個：`[{ color, color_code?, color_hex?, stock_threshold? }]`；同一產品下「顏色＋色號」不可重複 |
| `p_category` | text | | 預設「布料」 |
| `p_unit_of_measure` | text | | 預設 `KG` |

回傳：`id`（產品 id）。`summary.title` 為「建立產品」，`fields` 依序為產品名稱、類別、單位、顏色 1…n（「米白（色號 W01），安全庫存 50 公斤」）。

**`update_product`**（`canEditProducts`）：`p_product_id`、`p_changes` 可含 `name`、`category`、`unit_of_measure`；同步到所有顏色。`summary` 只列有變的欄位（「舊值 → 新值」）。

**`set_product_active`**（`canEditProducts`）：`p_product_id`、`p_is_active`。停用後其下所有顏色都不能再加入訂單（既有品項可保留）。

**`add_product_color`**（`canCreateProducts`）：`p_product_id`、`p_color`、`p_color_code?`、`p_color_hex?`、`p_stock_threshold?`；回傳新顏色的 `id`。

**`update_product_color`**（`canEditProducts`）：`p_color_id`、`p_changes` 可含 `color`、`color_code`、`color_hex`、`stock_threshold`（空字串或 `null` 清除）。

**`set_product_color_active`**（`canEditProducts`）：`p_color_id`、`p_is_active`（對應 `status` 的 `Available`／`Unavailable`）。

**唯讀 view `product_catalog`**：每個顏色一列，含 `product_id`、`product_name`、`category`、`unit_of_measure`、`product_is_active`、`color_id`、`color`、`color_code`、`color_hex`、`stock_threshold`、`color_is_active`、`stock_quantity`、`stock_rolls`、`is_low_stock`。訂單等單據的 `product_id` 指的是 `color_id`。

**舊的寫入方式**：直接 insert `products_new` 只給名稱時，會自動歸到同組織的同名產品（不存在就建立），並帶入產品的名稱、類別與單位。

| SQLSTATE | 代碼 | 訊息 |
|----------|------|------|
| `P0002` | `product_not_found`、`product_color_not_found` | 找不到此產品／顏色 |
| `22023` | `name_required`、`colors_required`、`color_required` | 請輸入產品名稱、產品至少需要一個顏色、請輸入顏色 |
| `22023` | `invalid_color_hex`、`invalid_stock_threshold`、`is_active_required` | 色值格式不正確，請使用 #RRGGBB；安全庫存不可為負數 |
| `22023` | `unknown_field`、`invalid_changes` | 不支援修改的欄位（例如在產品上改顏色） |
| `23505` | `product_name_taken`、`product_color_taken` | 已有同名的產品「…」，請在該產品下新增顏色；此產品已有顏色「…」 |

### A6 貨架

Migration：`supabase/migrations/20261009003415_api_a6_shelves.sql`；測試：`supabase/tests/api_a6_shelves.test.sql`；前端：`src/lib/api/shelves.ts`。貨架存放在 `warehouses`（入庫畫面稱「倉庫」）。

| API | 權限鍵 | 參數 | 說明 |
|-----|--------|------|------|
| `create_shelf` | `canCreateShelves` | `p_name`、`p_location?` | 名稱組織內唯一（不分大小寫、去除前後空白，B6） |
| `update_shelf` | `canEditShelves` | `p_shelf_id`、`p_changes`（`name`、`location`；空字串清除位置） | `summary` 只列有變的欄位 |
| `set_shelf_active` | `canEditShelves` | `p_shelf_id`、`p_is_active` | 停用後不能再放入新布卷，也不能把布卷移過去；已在上面的布卷不受影響（B4）。停用時 `summary` 會列「仍有庫存」 |

`warehouses` 新增 `is_active`。布卷的貨架檢查在 `save_inventory_rolls`，因此 `receive_inventory`、`update_inventory`、`update_inventory_roll` 都適用。

| SQLSTATE | 代碼 | 訊息 |
|----------|------|------|
| `P0002` | `shelf_not_found` | 找不到此貨架 |
| `22023` | `name_required`、`is_active_required`、`unknown_field`、`warehouse_inactive` | 請輸入貨架名稱；貨架「…」已停用 |
| `23505` | `shelf_name_taken` | 已有同名的貨架「…」 |

## 6. 決策

| # | 問題 | 建議 |
|---|------|------|
| B1 | 錯誤格式：SQLSTATE 表示類別、`HINT` 放固定代碼、訊息為中文（§2.3） | 採用 |
| B2 | 單據的試算以子交易真的寫入再回滾（§2.4），並改由 API 依組織產生編號（§2.5） | ✅ 已確認（2026-10-08） |
| B3 | 出貨單目前沒有狀態欄位。「取消出貨」要不要提供？提供的話：新增狀態欄位，取消時歸還布卷庫存並重算訂單出貨進度 | ✅ 已確認提供（2026-10-08） |
| B4 | 客戶、工廠、貨架新增 `is_active`；停用的資料不出現在新單據的選單，但既有單據照常顯示 | 採用 |
| B5 | 產品的 `UNIQUE (name, color, color_code)` 是全域的，兩個組織不能有同名同色的產品 | ✅ 已確認改為組織內唯一（A6；產品結構另見 B7） |
| B6 | 同一組織內客戶、工廠不可重名 | 採用（只在建立與改名時檢查，不影響既有資料） |
| B7 | 產品改為兩層：產品（母）＋顏色（子），見 §7 | ✅ 已確認（2026-10-08） |
| B8 | 交易單據統一編號「字母＋YYYYMMDD＋四位流水號」（B 訂單、P 採購單、I 進貨單、O 出貨單），見 §2.5；既有單據保留原編號 | ✅ 已確認（2026-10-08） |

## 7. 產品結構（B7）

### 7.1 資料

新增母表 `product_groups`；現有的 `products_new` 每一列成為一個顏色，加上 `group_id`。訂單品項、採購品項、入庫布卷、出貨紀錄原本就指向顏色那一列，因此**單據與庫存的關聯都不變**。

| 層 | 資料表 | 欄位 | 唯一性 |
|----|--------|------|--------|
| 產品（母） | `product_groups` | 名稱、類別、單位、`is_active` | 組織內名稱唯一（不分大小寫） |
| 顏色（子） | `products_new` | `group_id`、顏色名稱、色號、色值（可選，例如 `#C0392B`，用於色塊）、安全庫存、狀態 | 同一產品下「顏色＋色號」唯一（取代全域的 `UNIQUE (name, color, color_code)`，B5） |

- 過渡期間顏色列保留 `name`、`category`、`unit_of_measure`，由 API 與母表同步，既有的讀取（列表、view、AI tools）不必一次全改；之後逐步改讀母表再移除
- 停用分兩層：停用產品＝其下所有顏色都不出現在新單據的選單；也可只停用單一顏色
- 遷移：依「組織＋名稱」建立母表（2026-10-08 檢查：同名產品的類別與單位皆一致）
- 唯讀 view `product_catalog`（`security_invoker`）：產品、顏色、每個顏色的庫存重量與卷數、是否低於安全庫存；前端與 AI 共用

### 7.2 畫面

- 產品頁為可展開的兩層表格：產品列顯示顏色數、總庫存、低庫存顏色數；展開後列出各顏色的色號、庫存（重量／卷數）、安全庫存、狀態
- 搜尋同時比對產品名稱、顏色與色號，符合的產品自動展開
- 新增產品時可一次輸入多個顏色；展開後可「新增顏色」
- **編輯分層**：點產品列展開或收合；產品列的編輯按鈕編輯產品（名稱、類別、單位、狀態），編輯紀錄記在產品；點顏色列編輯顏色（顏色、色號、色值、安全庫存、狀態），編輯紀錄記在該顏色。改產品名稱時同步到顏色列的名稱只記在產品的紀錄，不會重複出現在每個顏色
- 訂單、採購、出貨的產品選單依產品分組（「1601鳥眼布 › 17大紅」），可用「鳥眼 大紅」搜尋（尚未實作，隨 A3 採購一起做；A6 先讓建單選單排除已停用的產品）

### 7.3 API

| API | 權限鍵 | 說明 |
|-----|--------|------|
| `create_product` | `canCreateProducts` | 產品資料＋一個以上的顏色 |
| `update_product`、`set_product_active` | `canEditProducts` | 只改母層；名稱、類別、單位同步到顏色列 |
| `add_product_color` | `canCreateProducts` | 在既有產品下新增顏色 |
| `update_product_color`、`set_product_color_active` | `canEditProducts` | 只改單一顏色 |

### 7.4 時程

排在 A2 訂單之後立即進行（A6 提前），讓 A2 重寫的建單對話框直接使用分組的產品選單，A3 採購、A5 出貨沿用。
