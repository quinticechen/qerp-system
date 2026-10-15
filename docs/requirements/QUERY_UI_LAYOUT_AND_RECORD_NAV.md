# Query：確認後打開紀錄、電腦版的顯示方式

> 狀態：已完成（2026-10-15）。負責：AI Session（Query 前端）；業務頁面以網址打開紀錄的部分由 AI Session 代為實作（RBAC Session 閒置，使用者直接交代），見 [SESSION_COORDINATION.md](../SESSION_COORDINATION.md) §6。
> 取代 [QUERY_AGENT_TPM_ALIGNMENT.md](./QUERY_AGENT_TPM_ALIGNMENT.md) §3.2 2026-10-14 的「跳到紀錄預覽」決定。
> 完成後更新：[FEATURES.md](../FEATURES.md) §5、[AGENT.md](../AGENT.md)。

## 1. 確認後打開剛寫入的紀錄

### 1.1 流程

1. Agent 在必填欄位齊全時建立草稿，對話中出現確認卡片，卡片上有「確認」「取消」
2. 使用者按「確認」→ 後端以業務 API 寫入（`POST /query/actions/:id/confirm`，與現在相同）
3. 寫入成功後，ERP 切換到該紀錄所屬的頁面，並打開那筆紀錄的資料視窗（查看模式）。例如建立訂單 → `/order`，打開新訂單
4. 按「取消」、草稿過期或寫入失敗時不切換頁面

### 1.2 工具與頁面的對應

確認的回應帶有寫入紀錄的 `id`（業務 API 的回傳，[API.md](../API.md) §2.2）。

| 工具 | 頁面 | 打開 |
|------|------|------|
| `create_customer`、`update_customer`、`set_customer_active` | `/customer` | 客戶 |
| `create_factory`、`update_factory`、`set_factory_active` | `/factory` | 工廠 |
| `create_order`、`update_order_status`、`update_order`、`cancel_order` | `/order` | 訂單 |
| `create_purchase_order`、`update_purchase_order`、`cancel_purchase_order` | `/purchase` | 採購單 |
| `receive_inventory`、`update_inventory` | `/inventory`（入庫記錄分頁） | 進貨單 |
| `update_inventory_roll` | `/inventory` | 不打開（布卷沒有獨立的資料視窗） |
| `create_shipping`、`update_shipping`、`cancel_shipping` | `/shipping` | 出貨單 |
| `create_product`、`update_product`、`set_product_active` | `/product` | 產品 |
| `add_product_color`、`update_product_color`、`set_product_color_active` | `/product` | 顏色 |
| `create_shelf`、`update_shelf`、`set_shelf_active` | `/shelf` | 貨架 |

### 1.3 頁面如何打開紀錄

網址帶 `?open=<紀錄 id>`（入庫另帶 `tab=records`）。頁面讀到後打開該紀錄的資料視窗，並從網址移除參數，重新整理或返回時不會再打開。紀錄還沒載入時，等資料到了再打開；不在目前清單中（例如被篩選掉）時不打開。

### 1.4 Query 面板的配合

- 浮動、側邊欄：切換頁面後面板保持開啟，使用者可以繼續對話
- 全螢幕：切換頁面後改為側邊欄，讓使用者看得到打開的紀錄
- 手機：關閉對話頁，回到 ERP 的該頁面

## 2. 電腦版的顯示方式

| 方式 | 版面 | 預設 |
|------|------|------|
| 浮動（Floating） | 現在的樣子：右下角 380×580 的面板 | ✅ |
| 側邊欄（Sidebar） | Query 佔滿右側全高，ERP 整體往左縮，不被遮住；寬度預設與浮動相同（380px），拖曳左邊緣調整（320px 到畫面寬度的一半） | |
| 全螢幕（Full Screen） | Query 佔滿整個畫面 | |

- 標題列右側的按鈕由左到右：歷史紀錄、顯示方式、新增對話、刪除對話、關閉（2026-10-15 使用者指定）。「顯示方式」的圖示為目前的方式，點擊後出現三個圖示供切換；所有按鈕只有圖示，名稱放在 `aria-label` 與 `title`
- 刪除對話（標題列或歷史紀錄中的刪除）前請使用者確認，說明無法復原
- 記住使用者上次選的方式與側邊欄寬度（瀏覽器本機，讀不到時用預設值）
- 側邊欄與全螢幕開啟時不顯示右下角的 Query 按鈕；以標題列的關閉按鈕關閉
- 手機維持現在的全螢幕對話頁，不提供切換

## 3. 驗證

- `scripts/verify-query-ui.py`（Query 面板的開關、對話）
- 前端型別檢查與 build
- 手動：三種顯示方式切換、側邊欄拖曳、確認卡片後跳頁並打開紀錄（訂單、客戶、產品顏色、入庫）
