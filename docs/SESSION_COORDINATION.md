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
| 2026-10-07 | AI → RBAC | 本文件建立；請確認 §1 擁有權與 §4 契約 | |
