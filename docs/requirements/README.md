# 開發需求文件

這裡放「要做什麼、為什麼、怎麼決定」的文件：需求、計畫、設計選項與決策紀錄。系統**現在是什麼樣子**寫在上一層 [docs/](../) 的現況文件。

## 規則

1. 新的需求或規劃先在這裡寫一份文件，再開始實作。
2. 需求做完（或其中一個階段做完）時，**同一次修改**要更新上一層對應的現況文件，例如：
   - 新增或修改 API → [API.md](../API.md)
   - 資料表、欄位變更 → [DATABASE_TABLES.md](../DATABASE_TABLES.md)
   - 權限變更 → [PERMISSIONS.md](../PERMISSIONS.md)
   - 使用者看得到的功能 → [FEATURES.md](../FEATURES.md)
   - 套件、服務、技術選型 → [DEPENDENCIES.md](../DEPENDENCIES.md)、[SERVICES.md](../SERVICES.md)、[TECH_STACK.md](../TECH_STACK.md)
   - AI Agent、Eval → [AGENT.md](../AGENT.md)、[EVALS.md](../EVALS.md)
3. 需求文件保留決策與過程，不需要隨程式更新；在文件開頭標註狀態（規劃中、進行中、已完成）與完成日期。

## 索引

| 文件 | 內容 | 負責 | 狀態 |
|------|------|------|------|
| [PRD.md](./PRD.md) | 產品需求（紡織業 ERP 整體） | — | 參考 |
| [MULTI_TENANT_RBAC.md](./MULTI_TENANT_RBAC.md) | 多租戶角色與權限（R0–R4） | RBAC Session | 已完成（2026-10-09） |
| [PHASE1_BUSINESS_API.md](./PHASE1_BUSINESS_API.md) | Phase 1 業務 API 的計畫與決策（A1–A6、B1–B8） | RBAC Session | 已完成（2026-10-09） |

AI Agent 的規劃文件（`QUERY_AGENT_PHASE0.md`、`QUERY_AGENT_PHASE1.md`、`QUERY_AGENT_TPM_ALIGNMENT.md`、`QUERY_AGENT_ARCHITECTURE_EVAL.md`）目前仍在上一層，將由 AI Session 移到這裡（[SESSION_COORDINATION.md](../SESSION_COORDINATION.md) §6）。
