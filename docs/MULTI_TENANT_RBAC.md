# 多租戶角色與權限規劃

> 狀態：草案，待確認（2026-10-07）
> 範圍：組織（租戶）內的角色、權限鍵、資料庫 RLS／RPC、前端守門、AI tools 權限
> 相關文件：[QUERY_AGENT_PHASE0.md](./QUERY_AGENT_PHASE0.md)（§4.2 權限與組織、D1–D5）

## 1. 背景與目標

權限管理頁可以設定 29 個權限鍵，但實際生效的很少：

- **資料庫**：只有 `canViewUsers`、`canCreateUsers`、`canEditUsers` 用在 RLS；產品、訂單、採購、庫存、出貨、客戶、工廠的資料表只檢查「是否為組織成員」
- **前端**：只有產品頁（查看、新增）、用戶頁、權限頁有檢查；路由與側邊選單不看權限
- **AI**：Phase 0 已讓每個 tool 依資料庫權限鍵過濾，是目前唯一完整生效的一層

另外，盤點時發現數個**跨組織的安全漏洞**（§2.1），必須先修。

目標：

1. 一份權限目錄，資料庫、前端、AI 三層都從這份目錄取用
2. 權限由資料庫強制（RLS／RPC），前端與 AI 只是讓畫面和工具清單與之一致
3. 任何人都無法把自己或他人的權限提升到超過自己
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
| S6 | `profiles`、`user_operation_logs` 仍以 legacy 函式 `is_admin()`（`profiles.role`）判斷 | `profiles.role = 'admin'` 的使用者可查看與修改**所有組織**的使用者資料 | 「Admins can …」系列 policy |
| S7 | 編輯成員角色時，前端先刪除再新增。非擁有者的 DELETE 被 RLS 擋下但不報錯，INSERT 卻因 S2 成功 | 有 `canEditUsers` 的人改別人的角色時，對方會**同時保有新舊角色**（權限取聯集） | `src/components/user/EditUserDialog.tsx` |

### 2.2 設計問題

| # | 問題 | 位置 |
|---|------|------|
| P1 | 權限鍵清單寫死在 4 個地方：`CreateRoleDialog`、`EditRoleDialog`、`useOrganizationPermissions`（擁有者清單）、`mcp-server/src/tools/types.ts` | 新增鍵時容易漏改 |
| P2 | 擁有者角色列存放 `canManageOrganization`、`canViewAll` 等 6 個沒有任何地方檢查的鍵；擁有者權限其實來自 `organizations.owner_id` | `create_default_organization_roles` |
| P3 | 「編輯權限」鍵沒有作用：角色的新增、編輯、停用只看是否為擁有者（前端與 RLS 皆是） | `OrganizationRoleManagement.tsx`、`organization_roles` RLS |
| P4 | `/permission` 與 `/organization-roles` 顯示同一個元件，但檢查不同的鍵（`canViewPermissions`、`canManageRoles`） | `PermissionManagement.tsx`、`OrganizationRolePage.tsx` |
| P5 | 貨架（`warehouses`）沒有權限鍵 | — |
| P6 | 沒有角色之間的依賴：可以給「新增出貨」卻不給「查看訂單」，結果畫面能開但選不到訂單 | — |
| P7 | 跨領域的連動以觸發器完成（例如入庫後 `recompute_purchase_order_receipts` 更新採購品項），觸發器以呼叫者身分執行。若直接對業務表加上權限 RLS，沒有「編輯採購」的倉管將**無法入庫** | `recompute_*`、`update_*_status` |

## 3. 決策

| 決策 | 內容 | 狀態 |
|------|------|------|
| R1 | 租戶＝組織。擁有者由 `organizations.owner_id` 決定，自動擁有全部權限，不以角色表示 | 建議 |
| R2 | 沿用現有 `can<動作><模組>` 命名，保留已在使用的鍵，避免遷移 AI tools、trace policy 與既有角色資料 | 建議 |
| R3 | 權限目錄存在資料庫表 `permission_definitions`，前端角色對話框從表讀取；兩端的 TypeScript 常數由測試比對 | 建議 |
| R4 | 資料庫是唯一的強制層。業務表的權限 RLS 隨 Phase 1 各流程上線（與該流程的 RPC 一起），不一次全改（原因見 P7） | 建議 |
| R5 | 防提權：指派角色、編輯角色只能給出「自己也擁有」的權限；不能修改自己的角色；不能修改擁有者 | 建議 |
| R6 | 系統角色（`is_system_role`）可編輯權限、不可刪除（維持現狀）；目錄新增鍵時，遷移只為系統角色**補上**範本預設值，不移除組織已調整的權限 | 待確認 |
| R7 | 新增系統角色「採購」 | 待確認 |
| R8 | 刪除權限只在功能存在時才新增鍵。目前只有產品保留 `canDeleteProducts`；訂單、採購、出貨的「取消／作廢」於 Phase 1 定義 RPC 時再新增 | 建議 |
| R9 | 轉移擁有權、刪除組織只限擁有者，不設權限鍵 | 建議 |

## 4. 設計

### 4.1 租戶模型

```
organizations (owner_id) ── 1:N ── user_organizations (成員資格：invited / active / disabled)
       │                                   │
       └── 1:N ── organization_roles ── N:M ── user_organization_roles
                  (permissions jsonb)
```

- 使用者可屬於多個組織；每個請求的權限都以「目前選擇的組織」計算（Phase 0 §4.2）
- 一位成員可有多個角色，權限取聯集
- 成員停用（`is_active = false`）後，所有權限檢查皆為 false（`user_has_organization_permission` 已是如此）
- 權限判斷**只有一個函式**：`user_has_organization_permission(auth.uid(), organization_id, key)`。它已包含成員資格與擁有者判斷，RLS 用它就同時完成組織隔離

### 4.2 權限目錄

V＝查看、C＝新增、E＝編輯、D＝刪除。「新」為本次新增，「刪」為移除。

| 模組 | 權限鍵 | 說明 |
|------|--------|------|
| 產品 | `canViewProducts`、`canCreateProducts`、`canEditProducts`、`canDeleteProducts` | 刪除功能於 Phase 1 主檔維護實作 |
| 客戶 | `canViewCustomers`、`canCreateCustomers`、`canEditCustomers` | |
| 工廠 | `canViewFactories`、`canCreateFactories`、`canEditFactories` | |
| 貨架 | 新 `canViewShelves`、新 `canCreateShelves`、新 `canEditShelves` | 新增、改名貨架 |
| 訂單 | `canViewOrders`、`canCreateOrders`、`canEditOrders` | 含品項與指定工廠 |
| 採購 | `canViewPurchases`、`canCreatePurchases`、`canEditPurchases` | |
| 庫存 | `canViewInventory`、`canCreateInventory`、`canEditInventory` | 新增＝入庫；編輯＝調整捲號、移架 |
| 出貨 | `canViewShipping`、`canCreateShipping`、`canEditShipping` | |
| 用戶 | `canViewUsers`、`canCreateUsers`、`canEditUsers` | 新增＝邀請；編輯＝修改資料、指派角色、停用成員 |
| 權限 | `canViewPermissions`、`canEditPermissions` | 編輯＝新增、編輯、停用角色 |
| 系統設定 | `canViewSystemSettings`、`canEditSystemSettings` | 組織資訊、通知、庫存閾值、郵件；可查看組織內的 Query trace（已實作） |
| （移除） | 刪 `canManageOrganization`、`canManageUsers`、`canManageRoles`、`canViewAll`、`canEditAll`、`canDeleteAll` | 沒有任何地方檢查（P2）；`/organization-roles` 改用 `canViewPermissions` |

`permission_definitions` 欄位：`key`（PK）、`module`、`action`、`label`（中文）、`description`、`sort_order`、`requires text[]`（依賴的鍵）。

**依賴（`requires`）**：勾選某個鍵時，角色對話框自動勾選它依賴的鍵；資料庫以觸發器檢查角色的 `permissions` 只含目錄中的鍵、且依賴完整。

- 每個 C／E／D 依賴同模組的 V
- `canCreateOrders` → 客戶、產品、工廠的 V
- `canCreatePurchases` → 訂單、工廠、產品的 V
- `canCreateInventory` → 採購、產品、貨架的 V
- `canCreateShipping` → 訂單、客戶、庫存的 V
- `canViewInventory` → 產品的 V
- `canCreateUsers`、`canEditUsers` → `canViewUsers`、`canViewPermissions`（選角色需要看得到角色）

### 4.3 系統角色範本

建立組織時產生；擁有者不是角色（R1）。「–」＝無。

| 模組 | 管理員 | 業務 | 採購（新，R7） | 倉管 | 會計 | 助理 |
|------|--------|------|----------------|------|------|------|
| 產品 | VCED | V | V | V | V | VCE |
| 客戶 | VCE | VCE | V | V | V | VCE |
| 工廠 | VCE | V | VCE | – | V | VCE |
| 貨架 | VCE | – | – | VCE | V | VCE |
| 訂單 | VCE | VCE | V | V | V | VCE |
| 採購 | VCE | V | VCE | V | V | VCE |
| 庫存 | VCE | V | V | VCE | V | VCE |
| 出貨 | VCE | V | V | VCE | V | VCE |
| 用戶 | VCE | – | – | – | – | – |
| 權限 | VE | – | – | – | – | – |
| 系統設定 | VE | – | – | – | – | – |

與目前預設值的差異：倉管新增「客戶 V」（建立出貨的依賴）與貨架；管理員、助理、會計新增貨架；採購為新角色。

### 4.4 三層強制

| 層 | 做法 | 角色 |
|----|------|------|
| 資料庫 | RLS：SELECT → V、INSERT → C、UPDATE → E、DELETE → D，條件一律為 `user_has_organization_permission(auth.uid(), organization_id, '<鍵>')`。子表（品項、關聯、捲號）以父表的 `organization_id` 判斷；新增父單時一起寫入的子表，C 或 E 皆可 | **唯一的強制層** |
| 資料庫 RPC | 跨領域的任務（入庫、出貨扣庫存、更新訂單狀態）做成 `SECURITY DEFINER` RPC，在函式開頭檢查**任務本身**的權限鍵（例如入庫檢查 `canCreateInventory`），並以 `allInOrganization` 的方式確認引用資料屬於同一組織。連動的觸發器改由 RPC 呼叫或同樣改為 definer（解決 P7） | 對應 Phase 0 D1 |
| 前端 | 一份 `ROUTE_PERMISSIONS`（路徑 → V 鍵）同時用於路由守門與側邊選單；新增／編輯／刪除按鈕各自以 `PermissionGuard` 包住；沒有 E 的人開啟詳細資料時為唯讀 | 只負責一致的畫面 |
| AI | 每個 tool 宣告的 `permission` 必須等於它呼叫的 RPC 檢查的鍵。P0-5 的確認端點在**確認當下**重新檢查權限（草稿到確認之間權限可能被收回） | 已實作，Phase 1 沿用 |

不新增「只看角色、不看組織」的 PERMISSIVE policy（`CLAUDE.md` Security Rules）。

### 4.5 防止提權（R5）

成員與角色的寫入**只能透過 RPC**，移除用戶端直接寫入 `user_organizations`、`user_organization_roles`、`organization_roles` 的 policy（同時修正 S1–S3、S7）。

| RPC | 需要的鍵 | 額外規則 |
|-----|----------|----------|
| `save_organization_role` | `canEditPermissions` | 角色的權限 ⊆ 呼叫者的權限（擁有者除外）；鍵必須在目錄中且依賴完整 |
| `set_member_roles(user_id, role_ids[])` | `canEditUsers` | 一次替換全部角色（交易內完成）；角色必須屬於同一組織；角色權限 ⊆ 呼叫者的權限；不能修改自己；不能修改擁有者 |
| `set_member_active` | `canEditUsers` | 不能停用自己與擁有者 |
| 邀請、接受邀請 | `canCreateUsers` | 已有 RPC；指派的角色同樣受 ⊆ 規則限制 |
| `transfer_organization_ownership`、`delete_organization` | 僅擁有者 | 已有 |

### 4.6 AI 的範圍

- 業務 tools 依 Phase 1 流程新增，權限鍵見 §4.4
- 用戶、權限、系統設定：依 Phase 0 D3，只提供唯讀 tools（例如 `list_members` 需 `canViewUsers`、`list_roles` 需 `canViewPermissions`），不提供寫入
- 每個新的寫入 tool 都要有一個「沒有權限的角色」eval 案例（Phase 0 §4.7）

## 5. 實作順序

| 步驟 | 內容 | 驗證方式 |
|------|------|----------|
| R0 安全修補 | 修正 S1–S7：移除 S1–S3 的 policy，改以 `set_member_roles` RPC 寫入（`EditUserDialog` 同步改用）；S4–S5 改為依父表組織判斷；S6 移除 `is_admin()` policy | 以兩個組織的測試帳號在 rollback 交易中逐條重現 S1–S7，修正前成功、修正後被拒；邀請、接受邀請、建立組織、編輯成員的流程手動驗證；Supabase security advisor |
| R1 權限目錄與角色 | `permission_definitions` 表與依賴檢查；遷移既有角色（移除 P2 的鍵、為系統角色補上貨架鍵，R6）；`save_organization_role` RPC 與「編輯權限」生效（P3）；角色對話框改從目錄讀取（P1）；系統角色範本更新與「採購」（R7） | 權限矩陣測試（見下）；前端測試；`mcp-server` 的 `PermissionKey` 與目錄比對的測試 |
| R2 前端守門 | `ROUTE_PERMISSIONS`、側邊選單、各頁按鈕與唯讀模式；合併 `/permission` 與 `/organization-roles`（P4） | 以每個系統角色登入，逐頁檢查選單與按鈕（瀏覽器實測） |
| R3 訂單主流程 | 隨 Phase 1 第 1 條流程：客戶、訂單、採購、入庫、庫存、出貨相關資料表的權限 RLS，以及跨領域 RPC | 權限矩陣測試；eval 無退步並新增無權限案例 |
| R4 主檔維護 | 隨 Phase 1 第 2 條流程：產品、工廠、貨架的權限 RLS；產品刪除 | 同上 |
| R5 管理功能 | 隨 Phase 1 第 3 條流程：用戶、權限、系統設定的 UI API 與 AI 唯讀 tools | 同上 |

R0 不依賴其他步驟，建議**立即處理**。R1、R2 可與 Phase 1 第 1 條流程並行。

**權限矩陣測試**：一支腳本以每個系統角色的測試帳號，在 rollback 交易中對每個受保護的操作（查表、寫表、呼叫 RPC）執行一次，結果與 §4.3 範本比對，並包含「另一個組織的資料」必須一律被拒。每個步驟都加入對應的列，作為 migration 的自動驗證（目前 migration 沒有自動測試）。

所有 migration 先提出內容，經確認後才套用。

## 6. 完成標準

- 權限管理頁的每個勾選項目，都在資料庫有對應的檢查，且有矩陣測試覆蓋
- 沒有任何 policy 的條件是 `true` 或只看 legacy `profiles.role`
- 一般成員無法透過 API 讓自己或他人取得超過自己的權限
- 前端選單、按鈕、AI tools 與資料庫判斷一致：看得到的就能做，做不了的就看不到

## 7. 不在範圍

- 資料列層級的權限（例如業務只能看自己負責的客戶）。若需要，於 Phase 1 之後另行規劃
- 欄位層級的權限（例如會計才能看單價）
- 跨組織的平台管理員
