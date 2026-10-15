-- AI 查詢紀錄只有本人可查看（MULTI_TENANT_RBAC.md R8；SESSION_COORDINATION.md §6 2026-10-07 請求）。
-- 移除 20261007140000_add_query_traces.sql 中讓組織管理員讀取他人紀錄的 policy；
-- 保留 "Users can view own query traces"。
DROP POLICY IF EXISTS "Org members with canViewSystemSettings can view organization query traces"
  ON public.query_traces;
