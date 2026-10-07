-- Query 待確認操作（草稿＋確認，docs/QUERY_AGENT_PHASE0.md §4.3，P0-5；D8 已同意建立）
--
-- AI 的寫入工具只建立草稿；使用者在確認卡片按「確認」後，mcp-server 才執行寫入。
-- 狀態：pending →（確認）executing → confirmed／failed；pending →（取消）cancelled；逾時 expired
-- 以 id 作為冪等鍵：只有搶到 pending → executing 的那一次會執行，重複確認回傳同一結果。

CREATE TABLE public.query_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.query_sessions(id) ON DELETE CASCADE,
  tool text NOT NULL,
  payload jsonb NOT NULL,
  -- 卡片顯示內容（名稱而非 ID）：{ title, fields: [{ label, value }] }
  summary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'executing', 'confirmed', 'cancelled', 'expired', 'failed')),
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  decided_at timestamptz
);

CREATE INDEX query_pending_actions_session_idx ON public.query_pending_actions (session_id, created_at);
CREATE INDEX query_pending_actions_user_idx ON public.query_pending_actions (user_id, created_at DESC);

ALTER TABLE public.query_pending_actions ENABLE ROW LEVEL SECURITY;

-- 只能為自己、在自己所屬的組織建立草稿
CREATE POLICY "Users can insert own pending actions in their organizations"
  ON public.query_pending_actions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND (public.user_belongs_to_organization(auth.uid(), organization_id)
         OR public.is_organization_owner(auth.uid(), organization_id))
  );

CREATE POLICY "Users can view own pending actions"
  ON public.query_pending_actions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 只能推進自己尚未完成的草稿（pending／executing）；完成後不可再改
CREATE POLICY "Users can update own unfinished pending actions"
  ON public.query_pending_actions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status IN ('pending', 'executing'))
  WITH CHECK (user_id = auth.uid());
