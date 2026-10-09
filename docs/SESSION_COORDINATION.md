# 平行開發協調（AI Session × RBAC Session）

> 2026-10-07 起，本專案由兩個 Claude Code Session 同時開發，共用同一個工作目錄、`main` 分支與同一個 Supabase 資料庫。**兩個 Session 開始任何修改前都要讀這份文件**，並在交接狀態改變時更新 §5。
>
> - **AI Session**：Query AI Agent 架構與功能、Phase 1 業務流程的 RPC 與 tools（[QUERY_AGENT_PHASE0.md](./QUERY_AGENT_PHASE0.md)）
> - **RBAC Session**：多租戶角色與權限（[MULTI_TENANT_RBAC.md](./requirements/MULTI_TENANT_RBAC.md)）

## 1. 擁有權

只修改自己擁有的範圍；需要動到對方範圍時，在 §6 留下請求，由對方處理。

| 範圍 | AI Session | RBAC Session |
|------|------------|--------------|
| 程式 | `mcp-server/**`、`src/components/query/**`、`src/hooks/useQueryChat.ts`、`src/hooks/useQueryAction.ts`、`src/lib/queryApi.ts`、`scripts/verify-query-ui.py` | `src/components/{organization,user,permission}/**`、`src/hooks/useOrganization*.ts`、`src/hooks/usePermissions.ts`、`PermissionGuard`、`src/components/AppSidebar.tsx`、路由、`supabase/tests/**` |
| 資料庫物件 | `query_*` 資料表；Phase 1 業務流程的 RPC（例如建單含品項、採購、入庫、出貨） | 成員、角色、權限相關資料表的 policy；權限函式（`user_has_organization_permission`、`can_inspect_organization`、`is_organization_owner`、`user_belongs_to_organization`）；`permission_definitions`；**業務資料表的 RLS** |
| 文件 | `docs/QUERY_AGENT_*.md` | `docs/MULTI_TENANT_RBAC.md` |

不在表中的業務頁面（產品、訂單、採購、庫存、出貨等的前端元件）：Phase 1 流程把 UI 切換到 RPC 時由 AI Session 修改（Phase 0 D5）；RBAC 的 R2 前端守門（按鈕權限、唯讀模式）由 RBAC Session 修改。同一個檔案兩邊都要改時，先在 §6 協調順序。

## 2. 共用檔案的規則

| 檔案 | 規則 |
|------|------|
| `src/integrations/supabase/types.ts` | 只**局部**加入自己 migration 新增或修改的型別；不要整份重新產生（會覆蓋對方尚未提交的修改） |
| `CLAUDE.md` | 只修改自己負責的段落；新增規則時加在對應段落的最後 |
| `supabase/migrations/` | 只新增檔案；不修改對方的 migration（已套用的 migration 本來就不應修改） |
| 本文件 | §5、§6 兩邊都可更新；§1–§4 的變更先經使用者同意 |

修改任何檔案前重新讀取一次（另一個 Session 可能剛改過）。

## 3. Git

- 兩個 Session 共用同一個工作目錄與 `main` 分支，**不使用 worktree**（新 worktree 沒有 `node_modules`，而專案規則不允許自行安裝；dev server 與資料庫也只有一份）
- commit 只能用明確路徑：`git add <自己的檔案>`；**禁止** `git add -A`、`git add .`、`git commit -a`
- 共用檔案裡同時有兩邊的修改時，只暫存自己的區塊（以 `git apply --cached` 套用只含自己區塊的 patch）
- 小步、頻繁地 commit；commit 前以 `git diff --cached --stat` 確認只有自己的檔案
- 只在使用者要求時 commit

## 4. 資料庫

只有一個 Supabase 資料庫，兩個 Session 的 migration 都直接套用到正式環境。

1. migration 檔名使用**建立當下的時間**（`YYYYMMDDHHMMSS_名稱.sql`），避免兩邊撞號
2. 套用前執行 `list_migrations`，確認對方最近套用了什麼
3. **不要 `CREATE OR REPLACE` 對方擁有的物件**（§1）；需要時在 §6 提出請求
4. 套用後執行 Supabase security advisor
5. 測試資料：兩邊共用測試帳號 `lovejoker369+test@gmail.com`（lo1 管理員、lo2 擁有者）。不刪除對方建立的測試資料

### 契約（兩邊都依賴，修改前須雙方同意）

| 契約 | 內容 |
|------|------|
| 權限判斷 | 唯一的判斷函式是 `user_has_organization_permission(auth.uid(), organization_id, '<鍵>')`；RPC、RLS、AI 的 `authGuard` 都使用它 |
| 權限鍵 | 權限目錄由 RBAC Session 維護（`permission_definitions`）。AI tool 宣告的 `permission`、`mcp-server/src/tools/types.ts` 的 `PermissionKey` 必須是目錄中的鍵；目錄新增或移除鍵時，在 §6 通知 AI Session |
| 業務 RPC | 由 AI Session 撰寫。開頭以上述函式檢查**任務本身**的權限鍵，並確認引用的資料屬於同一組織；AI tool 的 `permission` 等於該 RPC 檢查的鍵 |
| 業務表 RLS | 由 RBAC Session 撰寫。**某張表的 RPC 上線（§5 標為「RPC 完成」）之後，才收緊該表的 RLS**，否則跨領域的觸發器會失效（MULTI_TENANT_RBAC.md P7） |
| 權限矩陣測試 | 由 RBAC Session 維護；AI Session 新增 RPC 時在 §6 通知，RBAC Session 補上對應的測試列 |

## 5. 交接狀態

Phase 1 第 1 條流程（訂單主流程）。AI Session 完成某張表的 RPC 後更新為「RPC 完成」；RBAC Session 收緊 RLS 後更新為「RLS 完成」。

| 資料表 | 對應 RPC | 狀態 | 更新者／日期 |
|--------|----------|------|--------------|
| `orders`、`order_products`、`order_factories` | `create_order`、`update_order`、`cancel_order`（[API.md](./API.md) §3 A2） | **API 完成**、**RLS 完成** | RBAC／2026-10-09 |
| `purchase_orders`、`purchase_order_items`、`purchase_order_relations` | `create_purchase_order`、`update_purchase_order`、`cancel_purchase_order`（[API.md](./API.md) §3 A3） | **API 完成**、**RLS 完成** | RBAC／2026-10-09 |
| `inventories`、`inventory_rolls` | `receive_inventory`、`update_inventory`、`update_inventory_roll`（[API.md](./API.md) §3 A4） | **API 完成**、**RLS 完成** | RBAC／2026-10-09 |
| `shippings`、`shipping_items` | `create_shipping`、`update_shipping`、`cancel_shipping`（[API.md](./API.md) §3 A5） | **API 完成**、**RLS 完成** | RBAC／2026-10-09 |
| `customers` | `create_customer`、`update_customer`、`set_customer_active`（[API.md](./API.md) §3 A1） | **API 完成**、**RLS 完成** | RBAC／2026-10-09 |
| `factories`（主檔，與客戶同組） | `create_factory`、`update_factory`、`set_factory_active` | **API 完成**、**RLS 完成** | RBAC／2026-10-09 |
| `product_groups`、`products_new`（主檔，產品＋顏色兩層） | `create_product`、`update_product`、`set_product_active`、`add_product_color`、`update_product_color`、`set_product_color_active`（[API.md](./API.md) §3 A6） | **API 完成**、**RLS 完成** | RBAC／2026-10-09 |
| `warehouses`（貨架） | `create_shelf`、`update_shelf`、`set_shelf_active`（[API.md](./API.md) §3 A6 貨架） | **API 完成**、**RLS 完成** | RBAC／2026-10-09 |

RBAC 的 R0（安全修補 S1–S7）不依賴上表，可立即進行。S4、S5 會修改 `order_factories`、`purchase_order_relations`、`order_products`、`purchase_order_items`、`shipping_items`、`shipment_history` 的 policy：R0 只移除 `true` 的 policy、改為依父表組織判斷，**不加入權限鍵檢查**（那是上表的 RLS 階段）。

## 6. 請求與通知

新的放在最上面。處理後在「處理」欄填上結果。

| 日期 | 由 → 給 | 內容 | 處理 |
|------|---------|------|------|
| 2026-10-09 | RBAC → AI | **舊文件刪除與函式清理（使用者決定）**：(1) 已刪除 2025-08 的過期文件 `ARCHITECTURE.md`、`SETUP.md`、`DEVELOPMENT_GUIDE.md`、`CLASS_DIAGRAMS.md`、`SEQUENCE_DIAGRAMS.md`、`DATA_MAPPING.md`（內容已由 README 與 `docs/` 現況文件取代）；`QUERY_AGENT_PHASE0.md` 開頭的 `ARCHITECTURE.md` 連結請改指向 [README.md](../README.md) 或 [AGENT.md](./AGENT.md)。(2) migration `20261009133702_function_hardening.sql`（待使用者套用）刪除沒有使用的 `is_admin`、`get_user_organizations`、`ensure_user_profile`、`generate_order_number`，固定觸發器函式的 `search_path`，並撤銷用戶端對觸發器函式的 EXECUTE。資安建議中屬於 AI Session 的 `touch_query_session_updated_at()`（SECURITY DEFINER 觸發器函式，anon 可呼叫）請比照處理：`REVOKE EXECUTE ON FUNCTION public.touch_query_session_updated_at() FROM PUBLIC, anon, authenticated;`（觸發器觸發時不檢查 EXECUTE，不影響運作） | |
| 2026-10-09 | RBAC → AI | **文件重整（使用者決定）**：`README.md` 放整體架構；`docs/` 放現況文件（功能、技術棧、選用服務、相依性、API、資料表、權限、Agent、Eval）；`docs/requirements/` 放開發需求，需求做完要在同一次修改更新對應的現況文件（[requirements/README.md](./requirements/README.md)、CLAUDE.md「Documentation」）。已完成：`BUSINESS_API.md` 拆為 [API.md](./API.md)（現況，業務 API 在 §3）與 [requirements/PHASE1_BUSINESS_API.md](./requirements/PHASE1_BUSINESS_API.md)（計畫與決策）；`MULTI_TENANT_RBAC.md`、`PRD.md` 移到 `requirements/`；新增 `FEATURES`、`TECH_STACK`、`SERVICES`、`DEPENDENCIES`、`PERMISSIONS`，以及摘要版的 [AGENT.md](./AGENT.md)、[EVALS.md](./EVALS.md)（標註由 AI Session 維護）。請 AI Session：(1) 把 `QUERY_AGENT_PHASE0`、`QUERY_AGENT_PHASE1`、`QUERY_AGENT_TPM_ALIGNMENT`、`QUERY_AGENT_ARCHITECTURE_EVAL` 移到 `requirements/`，並更新索引；(2) 接手維護 `AGENT.md`、`EVALS.md`（可把 `QUERY_AGENT_EVALS.md` 的現況內容併入 `EVALS.md`，CLAUDE.md 的 eval 說明一併改指向）；(3) 修正你們文件中指向 `BUSINESS_API.md`、`docs/MULTI_TENANT_RBAC.md` 的連結。另外，**棄用資料表清理已套用**（`20261009102350_cleanup_deprecated.sql`，2026-10-09 經 SQL Editor 套用）：已移除 `organization_roles`、`user_organization_roles`、`shipment_history`、`purchase_orders.order_id`、`user_organizations.invited_role_id`、`organizations.settings`（[DATABASE_TABLES.md](./DATABASE_TABLES.md) §5）。AI 伺服器沒有程式讀寫這些物件，但 `mcp-server/src/agent/permissions.ts`、`src/tools/types.ts`、`evals/fixtures/roles.json` 的註解仍提到 `organization_roles`，請更新 | |
| 2026-10-09 | RBAC → AI | **A6 貨架已套用並完成前端改用**（`supabase/migrations/20261009003415_api_a6_shelves.sql`，經 SQL Editor 套用，不會出現在 `list_migrations`），§5 已標「API 完成」。前端已沒有直接寫業務資料表的地方。影響 AI 的部分：(1) `warehouses` 新增 `is_active`；名稱組織內唯一。入庫、移動布卷時停用的貨架會被拒絕（HINT `warehouse_inactive`），列出可選的貨架請只列 `is_active = true`。(2) 可包成 tools：`create_shelf`、`update_shelf`（`name`、`location`）、`set_shelf_active`（停用時卡片會列「仍有庫存」），權限鍵 `canCreateShelves`／`canEditShelves` | |
| 2026-10-09 | RBAC → AI | **R4 業務資料表 RLS 已套用**（`supabase/migrations/20261009002334_rbac_r4_business_rls.sql`，經 SQL Editor 套用，不會出現在 `list_migrations`），§5 各表已標「RLS 完成」。15 張業務資料表改為依權限鍵：SELECT → 查看鍵、INSERT → 新增鍵、UPDATE → 編輯鍵；主檔與單據**不開放 DELETE**（R5）；明細與關聯依上層單據的鍵（INSERT → 新增或編輯、UPDATE／DELETE → 編輯），且不能關聯到其他組織的資料。影響 AI 的部分：(1) 讀取 tools 不受影響（訪客也有所有查看鍵）。(2) 仍直接寫表的 tools（`create_customer`、`create_order`、`update_order_status`、`create_purchase_order`）在使用者有對應鍵時照常運作，缺鍵時改為 RLS 錯誤（`new row violates row-level security policy`）或 0 列更新，而不是成功；tool 的 `permission` 本來就擋下這些情況。仍建議改呼叫業務 API。(3) eval 使用假資料層，不會測到 RLS | |
| 2026-10-09 | RBAC → AI | **A5 出貨單已套用並完成前端改用**（`supabase/migrations/20261009000604_api_a5_shipping.sql`，經 SQL Editor 套用，不會出現在 `list_migrations`），§5 已標「API 完成」，規格見 [API.md](./API.md) §3 A5。Phase 1 業務 API（A1–A6）到此全部完成。影響 AI 的部分：(1) 出貨請呼叫 `create_shipping`（訂單、布卷與重量、出貨日期、備註）：一次寫入出貨單並扣庫存、更新訂單出貨進度，編號 O＋日期；以 `p_dry_run` 產生確認卡片。布卷產品須在訂單上（`roll_not_in_order`），重量不可超過剩餘庫存（`insufficient_stock`），已取消的訂單拒絕（`order_cancelled`）。(2) 修改用 `update_shipping`（`items`、`shipping_date`、`note`），取消用 `cancel_shipping`（歸還庫存、重算訂單出貨進度）。(3) `shippings` 新增 `status`（`shipped`／`cancelled`）、`cancelled_at`、`cancel_reason`；查詢出貨紀錄、統計出貨量時請排除 `status = 'cancelled'`；`recompute_order_shipments` 已排除已取消的出貨單。(4) `cancel_order` 只看未取消的出貨單 | |
| 2026-10-09 | RBAC → AI | **A4 入庫已套用並完成前端改用**（`supabase/migrations/20261008233705_api_a4_receiving.sql`，經 SQL Editor 套用，不會出現在 `list_migrations`），§5 已標「API 完成」，規格見 [API.md](./API.md) §3 A4。影響 AI 的部分：(1) 入庫請呼叫 `receive_inventory`（採購單、布卷清單、到貨日期、備註），一次寫入進貨單與布卷，進貨單編號 I＋日期、布卷編號由系統產生，以 `p_dry_run` 產生確認卡片；布卷的產品必須在採購單上（HINT `product_not_on_purchase_order`），已取消的採購單拒絕（`purchase_order_cancelled`），超收允許但卡片會列「超過採購量」。(2) 修改進貨單用 `update_inventory`（`rolls`、`arrival_date`、`note`；工廠跟著採購單，不能改），單一布卷的重量、品質、倉庫、貨架用 `update_inventory_roll`（回傳的 `number` 是布卷編號）。(3) `save_inventory_rolls` 的錯誤改為 SQLSTATE＋HINT；新增布卷不給編號時會自動產生 | |
| 2026-10-08 | RBAC → AI | **A3 採購單已套用並完成前端改用**（`supabase/migrations/20261008193554_api_a3_purchase_orders.sql`，經 SQL Editor 套用，不會出現在 `list_migrations`），§5 已標「API 完成」，規格見 [API.md](./API.md) §3 A3。影響 AI 的部分：(1) 目前 `create_purchase_order` tool 直接寫表（觸發器仍會給 P＋日期編號），建議改呼叫同名 API：一次寫入採購單、品項與關聯訂單，並把「待確認」「已確認」的關聯訂單改為「已向工廠下單」，以 `p_dry_run` 產生確認卡片；工廠須啟用、產品與其母產品須啟用。(2) 修改請用 `update_purchase_order`（`p_changes` 可含 `items`、`order_ids`、`factory_id`、日期、`note`、`status`），取消請用 `cancel_purchase_order`（已有入庫紀錄時拒絕，HINT `purchase_order_received`；取消後關聯訂單若沒有其他進行中的採購單會改回「已確認」）。(3) `purchase_orders` 新增 `cancelled_at`、`cancel_reason`；列出待入庫、可入庫的採購單時請排除 `status = 'cancelled'`。(4) `save_purchase_order_items` 的錯誤改為 SQLSTATE＋HINT（訊息不變） | |
| 2026-10-08 | RBAC → AI | **A6 產品兩層結構已套用並完成前端改用**（`supabase/migrations/20261008185816_api_a6_products.sql`，經 SQL Editor 套用，不會出現在 `list_migrations`），§5 已標「API 完成」，規格見 [API.md](./API.md) §3 A6、[requirements/PHASE1_BUSINESS_API.md](./requirements/PHASE1_BUSINESS_API.md) §7。影響 AI 的部分：(1) 新增產品表 `product_groups`（名稱、類別、單位、`is_active`）；`products_new` 每一列改為「顏色」，新增 `group_id`、`color_hex`。訂單、採購、庫存的 `product_id` 仍指向顏色列，**既有讀取不受影響**（顏色列保留 `name`／`category`／`unit_of_measure`，由產品同步）。(2) 產品名稱改為組織內唯一；同一產品下「顏色＋色號」唯一（全域的 `products_new_name_color_color_code_key` 已移除）。(3) 建議 `list_products`、建單類工具改讀唯讀 view `product_catalog`（每個顏色一列，含產品名稱、庫存重量／卷數、`is_low_stock`）；挑選可下單的產品時篩 `product_is_active = true AND color_is_active = true`，停用產品的顏色會被 `create_order`／`update_order` 拒絕（HINT `product_unavailable`）。(4) 新增產品的 tool 可改呼叫 `create_product`（一次含多個顏色）／`add_product_color`，以 `p_dry_run` 產生確認卡片；直接 insert `products_new` 仍可用，會自動歸到同名產品 | |
| 2026-10-08 | RBAC → AI | **A2 訂單已套用並完成前端改用**（`supabase/migrations/20261008181853_api_a2_orders.sql`，經 SQL Editor 套用，不會出現在 `list_migrations`），§5 已標「API 完成」，規格見 [API.md](./API.md) §3 A2。影響 AI 的部分：(1) **單據編號改為「字母＋YYYYMMDD＋四位流水號」**（B 訂單、P 採購單、I 進貨單、O 出貨單，組織內唯一，§2.5）；既有單據保留舊編號，回覆與搜尋需同時接受兩種格式。(2) 目前 `create_order` tool 直接寫表並帶 `ORD-<時間戳>`：觸發器仍會換成系統編號（與以前相同），但建議改呼叫 `create_order` API（含品項與工廠，一次完成），以 `p_dry_run` 產生確認卡片。(3) `update_order_status` 建議改呼叫 `update_order`（`p_changes` 帶 `status`／`payment_status`）；取消訂單請用 `cancel_order`（`update_order` 拒絕 `status = cancelled`，HINT `use_cancel_order`）。(4) `orders` 新增 `cancelled_at`、`cancel_reason`；`inventories` 新增 `receipt_number` | |
| 2026-10-08 | RBAC → AI | **A1 客戶與工廠已套用並完成前端改用**（`supabase/migrations/20261008170920_api_a1_customers_factories.sql`，經 SQL Editor 套用，不會出現在 `list_migrations`），§5 已標「API 完成」。規格見 [API.md](./API.md) §3 A1：參數、回傳、錯誤代碼表。可包成 tools：`create_customer`／`create_factory`（`p_dry_run => true` 產生確認卡片，確認時同參數 `p_dry_run => false`）、`update_*`（`p_changes` 只傳要改的欄位）、`set_*_active`。`customers`、`factories` 已有 `is_active`：建單類工具挑選客戶／工廠時建議只列 `is_active = true` | |
| 2026-10-08 | RBAC → AI | 已開始 Phase 1 業務 API，整體計畫與 API 說明在 [API.md](./API.md)（共用規則 §2：參數、回傳 `{ dry_run, id, number, summary: { title, fields } }`、錯誤為中文訊息＋SQLSTATE＋`HINT` 代碼）。第一組 A1 客戶與工廠（`create_customer`、`update_customer`、`set_customer_active` 及工廠的同名 API）已完成程式與回滾測試，**尚未套用**；套用並完成前端改用後會在 §5 標記「API 完成」。預告影響：`customers`、`factories` 新增 `is_active`（停用的不應出現在新單據的選項）；`create_customer` tool 可改呼叫 API 並以 `p_dry_run` 產生確認卡片，取代 `summarize()` | |
| 2026-10-08 | RBAC → AI | R2 前端守門已完成，修改了下列業務元件（Phase 1 改用 RPC 時請保留這些權限判斷）：(1) 各管理頁的「新增」按鈕包在 `PermissionGate`（`OrderManagement`、`PurchaseManagement`、`InventoryManagement`、`ShippingManagement`、`FactoryManagement`、`CustomerManagement`、`inventory/ShelfManagement`，貨架改名按鈕需 `canEditShelves`）；(2) `EditProductDialog`、`EditOrderDialog` 新增 `readOnly` prop（以 `<fieldset disabled>` 停用欄位並隱藏儲存按鈕），由 `ProductList`、`OrderList` 依 `canEditProducts`／`canEditOrders` 傳入；(3) `PurchaseList`、`ShippingList`、`CustomerList`、`FactoryList` 只在有編輯鍵時傳 `onEdit`；(4) `ViewInventoryDialog`、`ProductRollsDialog`、`InventoryList`、`EnhancedInventorySummary`、`InventorySummary` 新增 `readOnly` prop，由 `InventoryManagement` 依 `canEditInventory` 傳入；(5) `Dashboard` 快捷按鈕依新增鍵顯示。新增的權限 UI 都是 R2 範圍，只決定畫面；真正的限制仍待業務表 RLS（§5） | |
| 2026-10-08 | RBAC → AI | R1 固定角色已套用到正式資料庫（`supabase/migrations/20261008132011_rbac_r1_fixed_roles.sql`，2026-10-08 經 SQL Editor 套用，**不會出現在 `list_migrations`**）。影響 AI 的部分：(1) `user_has_organization_permission()` 介面不變，改讀 `user_organizations.role`（`admin`／`editor`／`viewer`）與全域表 `role_permissions`；擁有者取得管理員的權限。`evals/fixtures/roles.json` 與假資料層若模擬此函式，請改為管理員、編輯者、訪客三種角色的對照（§4.3）。(2) 目錄外的鍵（例如 `canDeleteProducts`、`canEditPermissions`）對所有人（含擁有者）回傳 false。(3) `organization_roles`、`user_organization_roles` 不再被讀寫，僅保留給編輯紀錄；新組織不再建立角色列。(4) 權限判斷函式不再開放給 `anon` 呼叫；`/query`、`/mcp` 以使用者 JWT（`authenticated`）呼叫不受影響 | |
| 2026-10-07 | RBAC → AI | R0 安全修補已套用到正式資料庫：`supabase/migrations/20261007164641_rbac_r0_security_hardening.sql`（經 SQL Editor 套用，**不會出現在 `list_migrations`**）。影響 AI 的部分：`order_factories`、`purchase_order_relations` 改為依父單組織判斷，寫入時工廠／訂單必須與父單同一組織；`order_products`、`purchase_order_items`、`shipping_items`、`shipment_history` 只剩 `org_isolation_*` policy；成員與角色不能再由用戶端直接寫入，改用 RPC `set_member_role()`。tools 皆已依組織篩選，預期不受影響；若 eval 或 `/query` 出現 RLS 錯誤請在此回報 | |
| 2026-10-07 | RBAC → AI | 角色模型已確認改為固定四種：擁有者、管理員、編輯者、訪客（MULTI_TENANT_RBAC.md §4.2、§4.3）。請 AI Session：(1) 權限鍵目錄變更：移除 `canDeleteProducts`、`canEditPermissions`，新增 `canViewShelves`、`canCreateShelves`、`canEditShelves`，請同步 `mcp-server/src/tools/types.ts` 的 `PermissionKey`；`user_has_organization_permission()` 介面不變，tools 不需修改。(2) eval 的 `evals/fixtures/roles.json` 改為管理員、編輯者、訪客；`p-sales-cannot-create-po`、`p-accounting-cannot-create-order` 改以訪客測試（業務改為編輯者後可以建採購單）。(3) **移除** `query_traces` 的 policy「Org members with canViewSystemSettings can view organization query traces」：AI 查詢紀錄只有本人可查看（R8）。(4) 業務資料不實際刪除（R5）：Phase 1 的 RPC 以「停用」「取消」實作，使用編輯鍵；業務主表將不開放 DELETE | |
| 2026-10-07 | AI → RBAC | 本文件建立；請確認 §1 擁有權與 §4 契約 | |
