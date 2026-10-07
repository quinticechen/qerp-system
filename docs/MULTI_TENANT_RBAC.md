# 多租戶角色與權限規劃

> 狀態：角色模型已確認（2026-10-07）；R0 已套用（`20261007164641_rbac_r0_security_hardening.sql`），回滾測試 `supabase/tests/rbac_r0_security.test.sql` 通過，用戶頁修改角色待瀏覽器實測
> 範圍：組織（租戶）內的角色、權限鍵、資料庫 RLS／RPC、前端守門、AI tools 權限
> 相關文件：[QUERY_AGENT_PHASE0.md](./QUERY_AGENT_PHASE0.md)（§4.2 權限與組織、D1–D5）、[SESSION_COORDINATION.md](./SESSION_COORDINATION.md)

## 1. 背景與目標

權限管理頁可以設定 29 個權限鍵，但實際生效的很少：

- **資料庫**：只有 `canViewUsers`、`canCreateUsers`、`canEditUsers` 用在 RLS；產品、訂單、採購、庫存、出貨、客戶、工廠的資料表只檢查「是否為組織成員」
- **前端**：只有產品頁（查看、新增）、用戶頁、權限頁有檢查；路由與側邊選單不看權限
- **AI**：Phase 0 已讓每個 tool 依資料庫權限鍵過濾，是目前唯一完整生效的一層

另外，盤點時發現數個**跨組織的安全漏洞**（§2.1），必須先修。

所有業務與成員資料表都有操作紀錄（`record_audit_logs`，記錄誰在何時改了什麼），因此不需要逐項勾選的細緻權限。改為**固定的四種角色**（§4.2）。

目標：

1. 角色固定為擁有者、管理員、編輯者、訪客，每位成員在每個組織只有一個角色
2. 權限由資料庫強制（RLS／RPC），前端與 AI 只是讓畫面和工具清單與之一致
3. 任何人都無法把自己的權限提升到超過自己的角色
4. 每條 Phase 1 業務流程完成時，該流程的權限一併到位，不另開一輪

## 2. 現況

### 2.1 安全漏洞（依線上 `pg_policies` 判斷，尚未實際攻擊測試）

| # | 問題 | 影響 | 位置 |
|---|------|------|------|
| S1 | `user_organizations` 的 INSERT policy 只檢查 `user_id = auth.uid()` | 任何登入者只要知道組織 ID，就能把自己加為該組織的**有效成員** | policy「Users can insert own memberships」 |
| S2 | `user_organization_roles` 的 INSERT policy 只檢查 `user_id = auth.uid() OR granted_by = auth.uid()`，不檢查呼叫者權限，也不檢查角色是否屬於該組織 | 搭配 S1，可替自己指派任一角色（例如管理員），**取得任意組織的完整權限**；任何成員也能替他人加角色 | policy「System can assign roles」 |
| S3 | `organization_roles` 的 INSERT policy 為 `true` | 任何登入者可在任意組織建立任意權限的角色。Phase 0 已封鎖函式 `create_default_organization_roles`，但這條 policy 仍在 | policy「System can create default roles」 |
| S4 | `order_factories`、`purchase_order_relations` 的 SELECT／INSERT／UPDATE／DELETE 全為 `true`，且開放給 `public` | **未登入者**只要有前端內嵌的 anon key，就能讀取、修改、刪除**所有組織**的訂單與工廠、採購單關聯（已確認 `anon` 具備這兩張表的 SELECT／DELETE 權限） | 兩張表的全部 policy |
| S5 | `order_products`、`purchase_order_items` 另有 SELECT `true`；`shipping_items`、`shipment_history` 另有 INSERT `true` | 可讀取所有組織的訂單品項與採購品項；可寫入其他組織的出貨資料。原本的 `org_isolation_*` policy 因 OR 語意失效 | 「Authenticated users can …」系列 policy |
| S6 | `profiles`、`user_operation_logs` 仍以 legacy 函式 `is_admin()`（`profiles.role`）判斷 | 目前無法利用：`is_admin()` 已固定回傳 `false`（migration `neutralize_dangling_is_admin_functions`），`profiles.role` 欄位也已不存在。屬於清理項目，避免日後有人改回 `is_admin()` 時重新開放跨組織存取 | 「Admins can …」系列 policy |
| S7 | 編輯成員角色時，前端先刪除再新增。非擁有者的 DELETE 被 RLS 擋下但不報錯，INSERT 卻因 S2 成功 | 有 `canEditUsers` 的人改別人的角色時，對方會**同時保有新舊角色**（權限取聯集） | `src/components/user/EditUserDialog.tsx` |

### 2.2 設計問題

| # | 問題 | 處理 |
|---|------|------|
| P1 | 權限鍵清單寫死在 4 個地方：`CreateRoleDialog`、`EditRoleDialog`、`useOrganizationPermissions`（擁有者清單）、`mcp-server/src/tools/types.ts` | 角色固定後，對照表只存在資料庫（§4.3） |
| P2 | 擁有者角色列存放 `canManageOrganization`、`canViewAll` 等 6 個沒有任何地方檢查的鍵 | 移除 |
| P3 | 「編輯權限」鍵沒有作用：角色的新增、編輯、停用只看是否為擁有者 | 角色不再可編輯，移除此鍵 |
| P4 | `/permission` 與 `/organization-roles` 顯示同一個元件，但檢查不同的鍵 | 合併為一頁，改為唯讀的角色說明 |
| P5 | 貨架（`warehouses`）沒有權限鍵 | 新增 |
| P6 | 可自訂角色時，可能給「新增出貨」卻不給「查看訂單」 | 角色固定後不會發生 |
| P7 | 跨領域的連動以觸發器完成（例如入庫後 `recompute_purchase_order_receipts` 更新採購品項），觸發器以呼叫者身分執行。直接對業務表加上權限 RLS，可能讓沒有該表權限的人操作失敗 | 業務表 RLS 隨 Phase 1 的 RPC 上線（R4） |
| P8 | 一位成員可有多個角色，權限取聯集 | 改為一人一個角色 |

### 2.3 現有資料（2026-10-07）

3 個組織皆只有系統角色，沒有自訂角色。實際指派：擁有者角色 3 筆、管理員 3 筆；業務、助理、會計、倉管 0 筆。沒有成員同時擁有多個角色。遷移不會改變任何人實際可做的事。

## 3. 決策

| 決策 | 內容 | 狀態 |
|------|------|------|
| R1 | 租戶＝組織。擁有者由 `organizations.owner_id` 決定 | ✅ 已確認 |
| R2 | 四種固定角色：擁有者、管理員、編輯者、訪客（§4.2）；不提供自訂角色 | ✅ 已確認 |
| R3 | 每位成員在每個組織只有一個角色 | ✅ 已確認 |
| R4 | 轉移擁有權、刪除組織只限擁有者 | ✅ 已確認 |
| R5 | 業務資料不實際刪除：產品、工廠、客戶等改為「停用」，訂單、採購、出貨改為「取消」，皆屬於「編輯」權限；業務資料表不開放 DELETE | ✅ 已確認 |
| R6 | 防提權：管理員可以指派管理員、編輯者、訪客；不能修改自己的角色；不能修改擁有者；擁有者只能經由轉移產生 | ✅ 已確認 |
| R7 | 訪客看不到用戶管理與組織管理 | ✅ 已確認 |
| R8 | AI 查詢紀錄（`query_traces`）只有本人可以查看，不依權限開放給其他成員 | ✅ 已確認 |
| R9 | **權限鍵保留**作為檢查單位，角色只是固定的權限鍵組合。`user_has_organization_permission()` 的介面不變，AI tools 與 RPC 不需修改 | ✅ 已確認 |
| R10 | 角色存在成員資格上（`user_organizations.role`），角色與權限鍵的對照表為全域表 `role_permissions`，取代每個組織各自的 `organization_roles`、`user_organization_roles` | ✅ 已確認 |

R9 的理由：權限鍵是兩個 Session 之間的契約（SESSION_COORDINATION.md §4）。保留它，簡化只發生在「角色 → 權限鍵」這一層；之後若需要更細的角色，只要新增對照表的列。

## 4. 設計

### 4.1 租戶模型

```
organizations (owner_id)
       │
       └── 1:N ── user_organizations (user_id, role, is_active)
                         │
                         └── role ── role_permissions (role, permission_key)  ← 全域，所有組織共用
```

- 使用者可屬於多個組織；每個請求的權限都以「目前選擇的組織」計算（Phase 0 §4.2）
- `role` 為 `admin`、`editor`、`viewer` 其中之一。擁有者不存在 `role` 欄位，由 `owner_id` 判斷，擁有全部權限
- 成員停用（`is_active = false`）後，所有權限檢查皆為 false
- 權限判斷**只有一個函式**：`user_has_organization_permission(auth.uid(), organization_id, key)`，改為讀取 `user_organizations.role` 與 `role_permissions`。它已包含成員資格與擁有者判斷，RLS 用它就同時完成組織隔離

### 4.2 角色

| 功能 | 擁有者 | 管理員 | 編輯者 | 訪客 |
|------|--------|--------|--------|------|
| 產品、訂單、採購、貨架、庫存、出貨、工廠、客戶 | 查看、新增、編輯 | 查看、新增、編輯 | 查看、新增、編輯 | 查看 |
| 用戶管理 | 查看、邀請、編輯 | 查看、邀請、編輯 | 查看 | – |
| 組織管理（角色說明、組織設定） | 查看、編輯 | 查看、編輯 | 查看 | – |
| 轉移擁有權、刪除組織 | ✅ | – | – | – |

- 「編輯」包含停用與取消（R5）
- 用戶管理的「編輯」包含修改資料、指派角色、停用成員，受 R6 限制
- 舊角色對應：擁有者角色 → 擁有者（`owner_id` 不變）；管理員 → 管理員；業務、助理、倉管 → 編輯者；會計 → 訪客

### 4.3 權限鍵

| 模組 | 權限鍵 | 擁有者、管理員 | 編輯者 | 訪客 |
|------|--------|:---:|:---:|:---:|
| 產品 | `canViewProducts` | ✅ | ✅ | ✅ |
| | `canCreateProducts`、`canEditProducts` | ✅ | ✅ | |
| 客戶 | `canViewCustomers` | ✅ | ✅ | ✅ |
| | `canCreateCustomers`、`canEditCustomers` | ✅ | ✅ | |
| 工廠 | `canViewFactories` | ✅ | ✅ | ✅ |
| | `canCreateFactories`、`canEditFactories` | ✅ | ✅ | |
| 貨架（新） | `canViewShelves` | ✅ | ✅ | ✅ |
| | `canCreateShelves`、`canEditShelves` | ✅ | ✅ | |
| 訂單 | `canViewOrders` | ✅ | ✅ | ✅ |
| | `canCreateOrders`、`canEditOrders` | ✅ | ✅ | |
| 採購 | `canViewPurchases` | ✅ | ✅ | ✅ |
| | `canCreatePurchases`、`canEditPurchases` | ✅ | ✅ | |
| 庫存（新增＝入庫） | `canViewInventory` | ✅ | ✅ | ✅ |
| | `canCreateInventory`、`canEditInventory` | ✅ | ✅ | |
| 出貨 | `canViewShipping` | ✅ | ✅ | ✅ |
| | `canCreateShipping`、`canEditShipping` | ✅ | ✅ | |
| 用戶 | `canViewUsers` | ✅ | ✅ | |
| | `canCreateUsers`（邀請）、`canEditUsers` | ✅ | | |
| 組織 | `canViewPermissions`、`canViewSystemSettings` | ✅ | ✅ | |
| | `canEditSystemSettings` | ✅ | | |

移除的鍵：`canDeleteProducts`（R5）、`canEditPermissions`（角色不可編輯）、`canManageOrganization`、`canManageUsers`、`canManageRoles`、`canViewAll`、`canEditAll`、`canDeleteAll`（P2）。

新增、編輯仍分成兩個鍵，雖然目前角色不區分。這是 AI tools 已使用的契約（R9），之後若出現「只能新增、不能修改」的角色也不必改動檢查點。

### 4.4 三層強制

| 層 | 做法 | 角色 |
|----|------|------|
| 資料庫 | RLS：SELECT → 查看鍵、INSERT → 新增鍵、UPDATE → 編輯鍵，條件一律為 `user_has_organization_permission(auth.uid(), organization_id, '<鍵>')`。業務主表**沒有 DELETE policy**（R5）。子表（品項、關聯、捲號）以父表的 `organization_id` 判斷；編輯父單時替換品項需要刪除子表列，以父表的編輯鍵允許 | **唯一的強制層** |
| 資料庫 RPC | 跨領域的任務（入庫、出貨扣庫存、取消訂單）做成 RPC，在函式開頭檢查**任務本身**的權限鍵，並確認引用資料屬於同一組織。連動的觸發器由 RPC 呼叫或改為 definer（P7） | 由 AI Session 撰寫（SESSION_COORDINATION.md §4） |
| 前端 | 一份 `ROUTE_PERMISSIONS`（路徑 → 查看鍵）同時用於路由守門與側邊選單；新增、編輯、停用、取消按鈕以 `PermissionGuard` 包住；沒有編輯鍵的人開啟詳細資料時為唯讀 | 只負責一致的畫面 |
| AI | 每個 tool 宣告的 `permission` 必須等於它呼叫的 RPC 檢查的鍵。P0-5 的確認端點在**確認當下**重新檢查權限 | 已實作，Phase 1 沿用 |

不新增「只看角色、不看組織」的 PERMISSIVE policy（`CLAUDE.md` Security Rules）。

### 4.5 防止提權（R6）

成員與角色的寫入**只能透過 RPC**，移除用戶端直接寫入 `user_organizations`、`user_organization_roles`、`organization_roles` 的 policy（同時修正 S1–S3、S7）。

| RPC | 需要的鍵 | 規則 |
|-----|----------|------|
| `set_member_role(organization_id, user_id, role)` | `canEditUsers` | `role` 只能是 `admin`、`editor`、`viewer`；不能修改自己；不能修改擁有者 |
| `set_member_active(organization_id, user_id, is_active)` | `canEditUsers` | 不能停用自己與擁有者 |
| 邀請、接受邀請 | `canCreateUsers` | 已有 RPC，改為指定 `role` |
| `transfer_organization_ownership`、`delete_organization` | 僅擁有者 | 已有。轉移後，原擁有者成為管理員 |

### 4.6 AI 的範圍

- 業務 tools 依 Phase 1 流程新增，權限鍵見 §4.3
- 用戶、組織管理：依 Phase 0 D3，只提供唯讀 tools（例如 `list_members` 需 `canViewUsers`），不提供寫入
- AI 查詢紀錄只有本人可查看（R8）。現有的「具 `canViewSystemSettings` 者可看組織內全部 trace」policy 需移除（`query_traces` 屬 AI Session，已在 SESSION_COORDINATION.md §6 提出）
- eval 的角色 fixtures 改為管理員、編輯者、訪客；「沒有權限」的案例改以訪客測試

## 5. 實作順序

| 步驟 | 內容 | 驗證方式 |
|------|------|----------|
| R0 安全修補 | 修正 S1–S7：移除 S1–S3 的 policy；`EditUserDialog` 改用 RPC 修改角色；S4–S5 改為依父表組織判斷；S6 移除 `is_admin()` policy | 以兩個組織的測試帳號在 rollback 交易中逐條重現 S1–S7，修正前成功、修正後被拒；邀請、接受邀請、建立組織、編輯成員手動驗證；Supabase security advisor |
| R1 固定角色 | `user_organizations.role`、`role_permissions`；遷移現有指派（§4.2 對應）；改寫 `user_has_organization_permission` 的實作（介面不變）；`set_member_role`、`set_member_active` RPC；邀請流程改為指定角色。前端：權限 hooks 改讀 `role`，用戶管理改為三選一的角色選單，權限頁改為唯讀角色說明（合併 P4），移除角色新增／編輯對話框。`organization_roles`、`user_organization_roles` 在前端與 AI 都不再讀取後才移除 | 權限矩陣測試（見下）；前端測試；以每種角色登入檢查用戶管理與權限頁 |
| R2 前端守門 | `ROUTE_PERMISSIONS`、側邊選單、各頁按鈕與唯讀模式 | 以每種角色登入，逐頁檢查選單與按鈕（瀏覽器實測） |
| R3 停用與取消 | 業務主表移除 DELETE；產品、工廠、客戶、貨架有「停用」狀態，訂單、採購、出貨有「取消」狀態（缺少的欄位隨對應流程補上） | 權限矩陣測試含「任何角色都無法刪除業務主表」 |
| R4 業務表 RLS | 隨 Phase 1 各流程：該流程的 RPC 上線後收緊對應資料表（SESSION_COORDINATION.md §5） | 權限矩陣測試；eval 無退步 |

R0 不依賴其他步驟，建議**立即處理**。R1、R2 可與 Phase 1 第 1 條流程並行。

**權限矩陣測試**：一支腳本以每種角色的測試帳號，在 rollback 交易中對每個受保護的操作（查表、寫表、呼叫 RPC）執行一次，結果與 §4.3 比對，並包含「另一個組織的資料」必須一律被拒。每個步驟都加入對應的列，作為 migration 的自動驗證（目前 migration 沒有自動測試）。

所有 migration 先提出內容，經確認後才套用。

## 6. 完成標準

- 每種角色可做與不可做的事，都在資料庫有對應的檢查，且有矩陣測試覆蓋
- 沒有任何 policy 的條件是 `true` 或只看 legacy `profiles.role`
- 一般成員無法透過 API 讓自己或他人取得超過自己角色的權限
- 前端選單、按鈕、AI tools 與資料庫判斷一致：看得到的就能做，做不了的就看不到

## 7. 不在範圍

- 自訂角色、逐項勾選權限
- 資料列層級的權限（例如業務只能看自己負責的客戶）
- 欄位層級的權限（例如只有管理員看得到單價）
- 跨組織的平台管理員
