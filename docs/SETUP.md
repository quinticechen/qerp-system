
# 紡織業 ERP 系統設置指南

## 專案概述

這是一個基於現代 Web 技術棧構建的紡織業 ERP 系統，採用 React + TypeScript + Tailwind CSS + shadcn/ui 技術方案，旨在提供完整的企業資源管理解決方案。

## 技術棧

- **前端框架**: React 18 + TypeScript
- **建構工具**: Vite
- **UI 框架**: Tailwind CSS + shadcn/ui
- **狀態管理**: React Query + Zustand (待實現)
- **路由**: React Router DOM
- **開發工具**: ESLint + TypeScript

## 快速開始

### 環境要求

- Node.js 18+ 
- npm 或 yarn 或 pnpm

### 安裝步驟

1. **克隆專案**
```bash
git clone <repository-url>
cd textile-erp-system
```

2. **安裝依賴**
```bash
npm install
```

3. **啟動開發服務器**
```bash
npm run dev
```

4. **開啟瀏覽器**
訪問 `http://localhost:8080`

## 專案結構

```
src/
├── components/          # 可重用組件
│   └── ui/             # shadcn/ui 組件
├── pages/              # 頁面組件
│   ├── Index.tsx       # 主頁面
│   ├── Login.tsx       # 登入頁面
│   └── Dashboard.tsx   # 儀表板
├── hooks/              # 自定義 Hooks
├── lib/                # 工具函數
├── App.tsx             # 應用根組件
├── main.tsx           # 應用入口點
└── index.css          # 全局樣式

docs/
├── PRD.md             # 產品需求文件
├── ARCHITECTURE.md    # 技術架構文件
└── SETUP.md          # 設置指南
```

## 功能模組

### 已實現
- ✅ 登入頁面設計
- ✅ 儀表板基礎架構
- ✅ 專案文檔結構

### 規劃中
- 🔄 用戶認證系統 (Supabase)
- 🔄 產品管理模組
- 🔄 訂單管理系統
- 🔄 庫存管理模組
- 🔄 採購管理系統
- 🔄 出貨管理模組
- 🔄 報表分析功能
- 🔄 權限管理系統

## 設計系統

### 配色方案
- **主色調**: 藍色系 (Blue 500-600)
- **輔助色**: 灰色系 (Slate 50-900)
- **狀態色**: 
  - 成功: Green 500-600
  - 警告: Orange 500-600
  - 錯誤: Red 500-600
  - 資訊: Blue 500-600

### 組件庫
使用 shadcn/ui 作為基礎組件庫，提供：
- 表單組件 (Input, Button, Label)
- 布局組件 (Card, Tabs)
- 反饋組件 (Toast, Dialog)
- 數據展示組件 (Table, Chart)

## 開發規範

### 代碼風格
- 使用 TypeScript 進行類型檢查
- 遵循 ESLint 規則
- 組件採用函數式組件 + Hooks
- 使用 Tailwind CSS 進行樣式設計

### 命名規範
- 組件: PascalCase (例: `UserProfile`)
- 文件: kebab-case (例: `user-profile.tsx`)
- 變數: camelCase (例: `userName`)
- 常數: UPPER_SNAKE_CASE (例: `API_BASE_URL`)

### 提交規範
使用 Conventional Commits：
- `feat`: 新功能
- `fix`: 修復 bug
- `docs`: 文檔更新
- `style`: 代碼格式調整
- `refactor`: 代碼重構
- `test`: 測試相關
- `chore`: 其他雜項

## 部署說明

### 生產環境建構
```bash
npm run build
```

### 預覽生產版本
```bash
npm run preview
```

## 後續開發計畫

1. **Phase 1**: 用戶認證與基礎架構
2. **Phase 2**: 核心業務模組 (訂單、庫存)
3. **Phase 3**: 進階功能 (報表、權限)
4. **Phase 4**: 移動端適配與優化

## 聯絡資訊

如有問題或建議，請聯絡開發團隊。
