# 權限

> 現況文件（2026-10-09）。設計與決策過程見 [requirements/MULTI_TENANT_RBAC.md](./requirements/MULTI_TENANT_RBAC.md)。

## 1. 組織與角色

- 每個組織的資料互相隔離；使用者可以屬於多個組織，畫面右上角切換目前的組織。
- 每位成員在一個組織中只有一個角色。角色固定為四種，不能自訂：

| 角色 | 來源 | 可以做的事 |
|------|------|------------|
| 擁有者 | `organizations.owner_id`（每個組織一位） | 管理員的所有權限，另外可以轉移擁有權、刪除組織 |
| 管理員 `admin` | `user_organizations.role` | 所有業務功能、用戶管理、組織設定 |
| 編輯者 `editor` | 同上 | 業務資料的查看、新增、編輯（含停用、取消）；查看用戶與組織設定 |
| 訪客 `viewer` | 同上 | 只能查看業務資料；看不到用戶管理與組織管理 |

權限頁（`/organization-roles`）以表格列出每個角色能做的事，資料來自 `role_permissions`。

## 2. 權限鍵

| 範圍 | 查看 | 新增 | 編輯（含停用、取消） |
|------|------|------|----------------------|
| 產品 | `canViewProducts` | `canCreateProducts` | `canEditProducts` |
| 訂單 | `canViewOrders` | `canCreateOrders` | `canEditOrders` |
| 採購 | `canViewPurchases` | `canCreatePurchases` | `canEditPurchases` |
| 貨架 | `canViewShelves` | `canCreateShelves` | `canEditShelves` |
| 庫存（入庫） | `canViewInventory` | `canCreateInventory` | `canEditInventory` |
| 出貨 | `canViewShipping` | `canCreateShipping` | `canEditShipping` |
| 工廠 | `canViewFactories` | `canCreateFactories` | `canEditFactories` |
| 客戶 | `canViewCustomers` | `canCreateCustomers` | `canEditCustomers` |
| 用戶 | `canViewUsers` | `canCreateUsers`（邀請） | `canEditUsers`（改角色、停用） |
| 組織 | `canViewPermissions`、`canViewSystemSettings` | — | `canEditSystemSettings` |

業務資料不實際刪除：主檔停用、單據取消，都屬於「編輯」。

## 3. 檢查在哪裡發生

唯一的判斷函式是 `user_has_organization_permission(使用者, 組織, 權限鍵)`（實作在 `private` schema，RLS policy 直接呼叫實作；`public` 的同名函式是供前端與 AI 以 RPC 呼叫的包裝），以下各層都使用它：

| 層 | 做法 |
|----|------|
| 資料庫 RLS（真正的限制） | 業務資料表：SELECT 需要查看鍵、INSERT 需要新增鍵、UPDATE 需要編輯鍵；主檔與單據沒有 DELETE；明細與關聯依上層單據的鍵，且不能關聯到其他組織的資料。成員與角色的寫入只能經由 RPC |
| 業務 API | 每支 API 開頭檢查該動作的權限鍵，並確認引用的資料都屬於同一組織（[API.md](./API.md) §2.1） |
| 前端 | 路由與側邊選單依查看鍵顯示；新增、編輯、停用、取消按鈕依對應的鍵顯示；沒有編輯鍵時開啟的是唯讀詳情。只負責畫面一致，不是安全邊界 |
| AI | 每個 tool 宣告所需的權限鍵；AI 提出的寫入在使用者確認時重新檢查成員資格與權限 |

## 4. 防止越權

- 管理員可以指派管理員、編輯者、訪客；不能改自己的角色，也不能改擁有者。擁有者只能經由轉移產生。
- AI 查詢紀錄（`query_traces`）只有本人可以看。
- 匿名請求讀不到也寫不了任何業務資料。
