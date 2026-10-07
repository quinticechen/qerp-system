-- Query 請求追蹤（docs/QUERY_AGENT_PHASE0.md §4.6，P0-6；D8 已同意建立）
-- mcp-server 以使用者 JWT 在每次 /query 結束時寫入一筆；保留 30 天，由 mcp-server 寫入後
-- 順手刪除該使用者過期的紀錄（不需 pg_cron）。

CREATE TABLE public.query_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.query_sessions(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  -- 最終回覆所用的模型；有降級時 fallback_from 為第一個失敗的模型
  model text,
  fallback_from text,
  route jsonb,
  -- [{ phase, model, duration_ms, error? }]
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ agent, tools: [{ name, args }] }]
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX query_traces_organization_created_idx ON public.query_traces (organization_id, created_at DESC);
CREATE INDEX query_traces_user_created_idx ON public.query_traces (user_id, created_at DESC);

ALTER TABLE public.query_traces ENABLE ROW LEVEL SECURITY;

-- 只能為自己、在自己所屬的組織寫入
CREATE POLICY "Users can insert own query traces in their organizations"
  ON public.query_traces FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (public.user_belongs_to_organization(auth.uid(), organization_id)
         OR public.is_organization_owner(auth.uid(), organization_id))
  );

-- 自己的紀錄；可檢視系統設定的成員（管理員、擁有者）可看組織內全部，用於排查問題
CREATE POLICY "Users can view own query traces"
  ON public.query_traces FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Org members with canViewSystemSettings can view organization query traces"
  ON public.query_traces FOR SELECT TO authenticated
  USING (public.user_has_organization_permission(auth.uid(), organization_id, 'canViewSystemSettings'));

-- 保留期限：只能刪除自己超過 30 天的紀錄
CREATE POLICY "Users can delete own expired query traces"
  ON public.query_traces FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND created_at < now() - interval '30 days');
