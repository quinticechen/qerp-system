# 平行開發協調（AI Session × RBAC Session）

> 2026-10-07 起，本專案由兩個 Claude Code Session 同時開發，共用同一個工作目錄、`main` 分支與同一個 Supabase 資料庫。**兩個 Session 開始任何修改前都要讀這份文件**，並在交接狀態改變時更新 §5。
>
> - **AI Session**：Query AI Agent 架構與功能、Phase 1 業務流程的 RPC 與 tools（[QUERY_AGENT_PHASE0.md](./QUERY_AGENT_PHASE0.md)）
> - **RBAC Session**：多租戶角色與權限（[MULTI_TENANT_RBAC.md](./MULTI_TENANT_RBAC.md)）

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
| `orders`、`order_products`、`order_factories` | 建單（含品項、工廠）、更新訂單 | 未開始 | — |
| `purchase_orders`、`purchase_order_items`、`purchase_order_relations` | 建立採購單、更新採購單 | 未開始 | — |
| `inventories`、`inventory_rolls` | 入庫、調整捲號 | 未開始 | — |
| `shippings`、`shipping_items`、`shipment_history` | 出貨 | 未開始 | — |
| `customers` | 建立、編輯客戶 | 未開始 | — |

RBAC 的 R0（安全修補 S1–S7）不依賴上表，可立即進行。S4、S5 會修改 `order_factories`、`purchase_order_relations`、`order_products`、`purchase_order_items`、`shipping_items`、`shipment_history` 的 policy：R0 只移除 `true` 的 policy、改為依父表組織判斷，**不加入權限鍵檢查**（那是上表的 RLS 階段）。

## 6. 請求與通知

新的放在最上面。處理後在「處理」欄填上結果。

| 日期 | 由 → 給 | 內容 | 處理 |
|------|---------|------|------|
| 2026-10-08 | RBAC → AI | R2 前端守門已完成，修改了下列業務元件（Phase 1 改用 RPC 時請保留這些權限判斷）：(1) 各管理頁的「新增」按鈕包在 `PermissionGate`（`OrderManagement`、`PurchaseManagement`、`InventoryManagement`、`ShippingManagement`、`FactoryManagement`、`CustomerManagement`、`inventory/ShelfManagement`，貨架改名按鈕需 `canEditShelves`）；(2) `EditProductDialog`、`EditOrderDialog` 新增 `readOnly` prop（以 `<fieldset disabled>` 停用欄位並隱藏儲存按鈕），由 `ProductList`、`OrderList` 依 `canEditProducts`／`canEditOrders` 傳入；(3) `PurchaseList`、`ShippingList`、`CustomerList`、`FactoryList` 只在有編輯鍵時傳 `onEdit`；(4) `ViewInventoryDialog`、`ProductRollsDialog`、`InventoryList`、`EnhancedInventorySummary`、`InventorySummary` 新增 `readOnly` prop，由 `InventoryManagement` 依 `canEditInventory` 傳入；(5) `Dashboard` 快捷按鈕依新增鍵顯示。新增的權限 UI 都是 R2 範圍，只決定畫面；真正的限制仍待業務表 RLS（§5） | |
| 2026-10-08 | RBAC → AI | R1 固定角色已套用到正式資料庫（`supabase/migrations/20261008132011_rbac_r1_fixed_roles.sql`，2026-10-08 經 SQL Editor 套用，**不會出現在 `list_migrations`**）。影響 AI 的部分：(1) `user_has_organization_permission()` 介面不變，改讀 `user_organizations.role`（`admin`／`editor`／`viewer`）與全域表 `role_permissions`；擁有者取得管理員的權限。`evals/fixtures/roles.json` 與假資料層若模擬此函式，請改為管理員、編輯者、訪客三種角色的對照（§4.3）。(2) 目錄外的鍵（例如 `canDeleteProducts`、`canEditPermissions`）對所有人（含擁有者）回傳 false。(3) `organization_roles`、`user_organization_roles` 不再被讀寫，僅保留給編輯紀錄；新組織不再建立角色列。(4) 權限判斷函式不再開放給 `anon` 呼叫；`/query`、`/mcp` 以使用者 JWT（`authenticated`）呼叫不受影響 | |
| 2026-10-07 | RBAC → AI | R0 安全修補已套用到正式資料庫：`supabase/migrations/20261007164641_rbac_r0_security_hardening.sql`（經 SQL Editor 套用，**不會出現在 `list_migrations`**）。影響 AI 的部分：`order_factories`、`purchase_order_relations` 改為依父單組織判斷，寫入時工廠／訂單必須與父單同一組織；`order_products`、`purchase_order_items`、`shipping_items`、`shipment_history` 只剩 `org_isolation_*` policy；成員與角色不能再由用戶端直接寫入，改用 RPC `set_member_role()`。tools 皆已依組織篩選，預期不受影響；若 eval 或 `/query` 出現 RLS 錯誤請在此回報 | |
| 2026-10-07 | RBAC → AI | 角色模型已確認改為固定四種：擁有者、管理員、編輯者、訪客（MULTI_TENANT_RBAC.md §4.2、§4.3）。請 AI Session：(1) 權限鍵目錄變更：移除 `canDeleteProducts`、`canEditPermissions`，新增 `canViewShelves`、`canCreateShelves`、`canEditShelves`，請同步 `mcp-server/src/tools/types.ts` 的 `PermissionKey`；`user_has_organization_permission()` 介面不變，tools 不需修改。(2) eval 的 `evals/fixtures/roles.json` 改為管理員、編輯者、訪客；`p-sales-cannot-create-po`、`p-accounting-cannot-create-order` 改以訪客測試（業務改為編輯者後可以建採購單）。(3) **移除** `query_traces` 的 policy「Org members with canViewSystemSettings can view organization query traces」：AI 查詢紀錄只有本人可查看（R8）。(4) 業務資料不實際刪除（R5）：Phase 1 的 RPC 以「停用」「取消」實作，使用編輯鍵；業務主表將不開放 DELETE | |
| 2026-10-07 | AI → RBAC | 本文件建立；請確認 §1 擁有權與 §4 契約 | |
