# Phase 1 業務 API：計畫與決策

> 需求文件（RBAC Session）。原 `docs/BUSINESS_API.md` 的計畫、進度與決策；各 API 的現況規格已移到 [../API.md](../API.md)（§2 共用規則、§3 業務 API）。Phase 1 業務 API 已全部完成（2026-10-09）。

## 1. 目標

把 12 個功能的寫入打包成資料庫 API（RPC），讓前端與 AI tools 呼叫同一份邏輯：

1. 權限、組織範圍、資料驗證都在 API 內完成，前端與 AI 不再各寫一份
2. 每個寫入 API 都有試算模式，AI 的確認卡片與真正寫入走同一段驗證
3. 前端改用 API 後，業務表的 RLS 才依權限鍵收緊（MULTI_TENANT_RBAC.md R4）

讀取：單表讀取維持直接查表＋RLS（Phase 0 D1）；跨表的讀取（例如訂單含品項與出貨進度）視 AI 的需求提供 RPC 或 `security_invoker` view。

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
4. [API.md](../API.md) §3 補上 API 說明（參數、回傳、錯誤代碼）
5. SESSION_COORDINATION.md §5 標為「API 完成」，通知 AI Session
6. 之後由 RBAC Session 收緊該組資料表的 RLS（R4）

## 6. 決策

| # | 問題 | 建議 |
|---|------|------|
| B1 | 錯誤格式：SQLSTATE 表示類別、`HINT` 放固定代碼、訊息為中文（[API.md](../API.md) §2.3） | 採用 |
| B2 | 單據的試算以子交易真的寫入再回滾（[API.md](../API.md) §2.4），並改由 API 依組織產生編號（[API.md](../API.md) §2.5） | ✅ 已確認（2026-10-08） |
| B3 | 出貨單目前沒有狀態欄位。「取消出貨」要不要提供？提供的話：新增狀態欄位，取消時歸還布卷庫存並重算訂單出貨進度 | ✅ 已確認提供（2026-10-08） |
| B4 | 客戶、工廠、貨架新增 `is_active`；停用的資料不出現在新單據的選單，但既有單據照常顯示 | 採用 |
| B5 | 產品的 `UNIQUE (name, color, color_code)` 是全域的，兩個組織不能有同名同色的產品 | ✅ 已確認改為組織內唯一（A6；產品結構另見 B7） |
| B6 | 同一組織內客戶、工廠不可重名 | 採用（只在建立與改名時檢查，不影響既有資料） |
| B7 | 產品改為兩層：產品（母）＋顏色（子），見 §7 | ✅ 已確認（2026-10-08） |
| B8 | 交易單據統一編號「字母＋YYYYMMDD＋四位流水號」（B 訂單、P 採購單、I 進貨單、O 出貨單），見 [API.md](../API.md) §2.5；既有單據保留原編號 | ✅ 已確認（2026-10-08） |

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
