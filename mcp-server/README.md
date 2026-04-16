# Weave Flow ERP — MCP Server

讓 Claude 或任何支援 MCP 的 AI 用自然語言操作 WeaveFlow ERP 的後端資料。

## 工具清單

| 分類 | 工具 | 說明 |
|------|------|------|
| 客戶 | `list_customers` | 列出客戶，支援搜尋 |
| 客戶 | `get_customer` | 取得單一客戶完整資料 |
| 客戶 | `create_customer` | 建立新客戶 |
| 訂單 | `list_orders` | 列出銷售訂單，支援狀態篩選 |
| 訂單 | `get_order` | 取得訂單詳情含品項 |
| 訂單 | `create_order` | 建立新銷售訂單 |
| 訂單 | `update_order_status` | 更新訂單/付款/出貨狀態 |
| 產品 | `list_products` | 列出產品目錄 |
| 產品 | `get_product` | 取得產品完整規格 |
| 庫存 | `get_inventory_summary` | 查詢各品項庫存（A/B/C/D 級） |
| 庫存 | `get_low_stock_alerts` | 列出庫存不足警示 |
| 採購單 | `list_purchase_orders` | 列出採購單 |
| 採購單 | `get_purchase_order` | 取得採購單詳情含品項 |
| 出貨 | `list_shippings` | 列出出貨記錄 |
| 出貨 | `get_shipping` | 取得出貨單詳情含卷號 |
| 工廠 | `list_factories` | 列出工廠資料 |

## 安裝與設定

### 1. 安裝依賴並編譯

```bash
cd mcp-server
npm install
npm run build
```

### 2. 設定環境變數

複製 `.env.example` 為 `.env` 並填入：

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ORGANIZATION_ID=your-organization-uuid
```

> **注意：** 使用 Service Role Key，此 key 可繞過 RLS，請妥善保管，僅用於伺服器端。

### 3. 加入 Claude Code（.mcp.json）

在專案根目錄或 `~/.claude/` 建立或更新 `.mcp.json`：

```json
{
  "mcpServers": {
    "weave-flow-erp": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "ORGANIZATION_ID": "your-organization-uuid"
      }
    }
  }
}
```

重啟 Claude Code 後即可使用。

## 使用範例

```
列出所有未付款的訂單
幫我查詢客戶「台灣布業」的所有訂單
現在哪些產品庫存不足？
建立一張給客戶 XXX 的新訂單
```
