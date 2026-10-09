# 資料表盤點

> 2026-10-09 盤點（RBAC Session）。依據：Supabase 正式資料庫的資料表、筆數、policy、觸發器與函式引用，以及前端 `src/`、AI 伺服器 `mcp-server/src/` 的程式引用。筆數為盤點當下的數字。

## 1. 摘要

| 狀態 | 資料表 |
|------|--------|
| 使用中（業務） | `customers`、`factories`、`product_groups`、`products_new`、`warehouses`、`orders`、`order_products`、`order_factories`、`purchase_orders`、`purchase_order_items`、`purchase_order_relations`、`inventories`、`inventory_rolls`、`shippings`、`shipping_items` |
| 使用中（組織與權限） | `organizations`、`user_organizations`、`role_permissions`、`profiles`、`user_operation_logs` |
| 使用中（紀錄） | `record_audit_logs` |
| 使用中（AI 查詢，AI Session 負責） | `query_sessions`、`query_messages`、`query_pending_actions`、`query_traces` |

唯讀 view：`product_catalog`、`inventory_summary`、`inventory_summary_enhanced`（皆為 `security_invoker`，依呼叫者的權限讀取）。

## 2. 業務流程

```
主檔：客戶 customers、工廠 factories、產品 product_groups ─┬─ 顏色 products_new、貨架 warehouses
                                                        │
訂單 orders（B） ── 品項 order_products ── 指定工廠 order_factories
   │  ▲ 出貨進度由出貨自動重算
   │  └──────────────────────────────────────────────┐
   ▼ purchase_order_relations（多對多）                │
採購單 purchase_orders（P） ── 品項 purchase_order_items │
   │  ▲ 已入庫量由入庫自動重算                          │
   ▼                                                  │
進貨單 inventories（I） ── 布卷 inventory_rolls（庫存） ─┤
                                    │ 扣庫存             │
                                    ▼                   │
出貨單 shippings（O） ── 出貨布卷 shipping_items ────────┘
```

- 所有業務寫入都經過業務 API（[API.md](./API.md)），以函式擁有者身分執行；資料表本身的 RLS 依權限鍵控制（[PERMISSIONS.md](./PERMISSIONS.md)）。前端已沒有直接寫業務資料表的地方；AI tools 仍有幾處直接寫表（SESSION_COORDINATION.md §6）。
- 業務資料不實際刪除：主檔停用（`is_active`、顏色 `status`），單據取消（`status = cancelled` 加 `cancelled_at`、`cancel_reason`）。
- 單據編號為「字母＋YYYYMMDD＋四位流水號」，組織內唯一、依台灣日期（[API.md](./API.md) §2.5）。

## 3. 使用中的資料表

### 3.1 主檔

| 資料表 | 筆數 | 用途與規則 | 寫入 |
|--------|------|------------|------|
| `customers` 客戶 | 10 | 名稱組織內唯一；聯絡人必填，手機或市話至少一個；`is_active` 停用後不出現在新訂單 | A1 API |
| `factories` 工廠 | 9 | 規則同客戶；停用後不能指定給新訂單或新採購單 | A1 API |
| `product_groups` 產品 | 7 | 產品名稱、類別、單位、`is_active`；名稱組織內唯一 | A6 API（用戶端只能讀） |
| `products_new` 顏色 | 34 | 產品下的顏色、色號、色值、安全庫存、`status`（Available／Unavailable）；同產品下「顏色＋色號」唯一。訂單、採購、布卷、出貨都指向這張表 | A6 API |
| `warehouses` 貨架 | 4 | 貨架名稱（組織內唯一）、位置、`is_active`；停用後不能放新布卷 | A6 貨架 API |

### 3.2 單據

| 資料表 | 筆數 | 用途與規則 | 寫入 |
|--------|------|------------|------|
| `orders` 訂單 | 6 | 客戶、狀態（待確認 → 已確認 → 已向工廠下單 → 已完成／已取消）、付款狀態、出貨狀態（由出貨重算）；有出貨或進行中採購單時不能取消 | A2 API |
| `order_products` 訂單品項 | 9 | 產品（顏色）、數量、單價、卷數、規格；`shipped_quantity` 與 `status` 由出貨重算；已出貨或已採購的品項鎖定 | A2 API（`save_order_items`） |
| `order_factories` 指定工廠 | 8 | 訂單與工廠的多對多 | A2 API |
| `purchase_orders` 採購單 | 3 | 工廠、下單日、預計到貨日、狀態（待確認／已下單／部分入庫／已完成由入庫重算／已取消）；已入庫時不能取消或換工廠 | A3 API |
| `purchase_order_items` 採購品項 | 5 | 產品、採購量、單價；`received_quantity` 與 `status` 由入庫重算 | A3 API（`save_purchase_order_items`） |
| `purchase_order_relations` 採購關聯訂單 | 3 | 採購單與訂單的多對多；建立關聯時訂單改為「已向工廠下單」，最後一張進行中的採購單取消後改回「已確認」 | A3 API |
| `inventories` 進貨單 | 2 | 依採購單入庫的一批貨；工廠沿用採購單；編號 `receipt_number` | A4 API |
| `inventory_rolls` 布卷（庫存） | 4 | 每一卷布：產品、貨架與位置、品級、入庫重量 `quantity`、剩餘重量 `current_quantity`；入庫或修改時觸發採購進度重算 | A4 API（`save_inventory_rolls`）；出貨扣減 |
| `shippings` 出貨單 | 2 | 訂單、客戶（沿用訂單）、出貨日、總重量與卷數、`status`（shipped／cancelled） | A5 API |
| `shipping_items` 出貨布卷 | 3 | 每一卷出了多少；寫入時扣布卷庫存並觸發訂單出貨進度重算；取消出貨時保留作為紀錄 | A5 API（`save_shipping_items`） |

### 3.3 組織、成員與權限

| 資料表 | 筆數 | 用途與規則 | 寫入 |
|--------|------|------------|------|
| `organizations` 組織 | 4 | 名稱、描述 `description`（建立組織時填寫）、擁有者 `owner_id`、`is_active`；建立時觸發器把擁有者加為成員 | 建立組織、轉移擁有權、刪除組織（RPC） |
| `user_organizations` 成員 | 7 | 使用者在組織中的成員資格與角色 `role`（admin／editor／viewer，一人一個）、邀請與接受時間；`protect_membership_columns` 觸發器防止自行修改 | 邀請、接受、`set_member_role`、`set_member_active`（RPC） |
| `role_permissions` 角色權限 | 65 | 三個固定角色各有哪些權限鍵（全域，不分組織）；擁有者取得管理員的權限。`user_has_organization_permission()` 讀這張表，RLS、API、AI 都經由它判斷 | migration |
| `profiles` 使用者資料 | 6 | 姓名、電話、`is_active`；註冊時由觸發器建立 | 個人設定、用戶管理 |
| `user_operation_logs` 使用者操作紀錄 | 16 | 邀請、加入組織、轉移擁有權等成員操作的紀錄（與 `record_audit_logs` 的資料變更紀錄不同） | 成員相關 RPC |

### 3.4 紀錄

| 資料表 | 筆數 | 用途 |
|--------|------|------|
| `record_audit_logs` 編輯紀錄 | 251 | 業務資料與成員資料每次新增、修改、刪除的前後內容與修改者，由 `log_record_change()` 觸發器寫入；畫面上的「編輯紀錄」讀這張表 |

### 3.5 AI 查詢（AI Session 負責）

| 資料表 | 筆數 | 用途 |
|--------|------|------|
| `query_sessions` | 35 | 使用者與 AI 的對話 |
| `query_messages` | 74 | 對話中的每則訊息 |
| `query_pending_actions` | 3 | AI 提出、等待使用者確認的寫入動作 |
| `query_traces` | 16 | 每次 AI 回覆的模型、工具呼叫、耗時（除錯用，只有本人可看） |

## 4. 棄用與未使用

### 4.1 欄位

| 欄位 | 狀況 |
|------|------|
| `products_new.name`、`category`、`unit_of_measure` | 兩層產品之後由 `product_groups` 同步過來的副本；以 `product_groups` 為準。AI tools 與 view 仍讀這些欄位，改讀 `product_groups` 後再移除 |

## 5. 清理紀錄

**2026-10-09**（使用者決定，`supabase/migrations/20261009102350_cleanup_deprecated.sql`，測試 `supabase/tests/cleanup_deprecated.test.sql`）：棄用的資料表連同舊的編輯紀錄一起移除，不再顯示 R1 之前的角色編輯紀錄。

- 移除資料表：`organization_roles`、`user_organization_roles`（R1 改為固定角色後不再讀寫）、`shipment_history`（從未有資料，出貨紀錄在 `shipping_items`），以及它們在 `record_audit_logs` 中的紀錄。
- 移除欄位：`purchase_orders.order_id`（舊的一對一欄位，全部為空值，改用 `purchase_order_relations`）、`user_organizations.invited_role_id`（邀請直接寫 `role`）、`organizations.settings`（沒有功能讀寫）。
- 移除函式 `create_default_organization_roles`；`order_product_is_purchased`、`api_release_orders`、`cancel_order`、`cancel_purchase_order` 改為只看 `purchase_order_relations`。

**2026-10-09**（`supabase/migrations/20261009133702_function_hardening.sql`，測試 `supabase/tests/function_hardening.test.sql`）：刪除沒有任何呼叫的函式 `is_admin`、`get_user_organizations`、`ensure_user_profile`、`generate_order_number`；固定 `handle_new_user`、`set_current_quantity`、`update_updated_at`、`update_updated_by` 的 `search_path`；觸發器函式不再開放用戶端呼叫。

**2026-10-09**（`supabase/migrations/20261009140512_private_definer_functions.sql`，測試 `supabase/tests/private_definer_functions.test.sql`）：以函式擁有者身分執行的業務 API、組織與成員 RPC、權限函式移到不公開的 `private` schema，`public` 留同名的包裝函式（[API.md](./API.md) §2.1）；`api_assign_document_number` 移到 `private`，不再能從 `/rpc` 呼叫。
