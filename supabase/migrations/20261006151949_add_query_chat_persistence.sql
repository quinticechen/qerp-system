-- Query 助理對話紀錄持久化：取代原本只存在瀏覽器 localStorage 的做法，
-- 讓對話紀錄可以跨裝置、並成為之後 eval / 長期記憶功能的資料基礎。

CREATE TABLE public.query_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '新對話',
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.query_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.query_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_query_sessions_user_id ON public.query_sessions(user_id);
CREATE INDEX idx_query_messages_session_id ON public.query_messages(session_id);

ALTER TABLE public.query_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.query_messages ENABLE ROW LEVEL SECURITY;

-- query_sessions：完全自己擁有，比照 user_organizations 等 self-owned 表的政策寫法
CREATE POLICY "Users can view own query sessions"
  ON public.query_sessions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own query sessions"
  ON public.query_sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own query sessions"
  ON public.query_sessions FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own query sessions"
  ON public.query_sessions FOR DELETE
  USING (user_id = auth.uid());

-- query_messages：透過 parent session 的擁有關係判斷
CREATE POLICY "Users can view own query messages"
  ON public.query_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.query_sessions qs
    WHERE qs.id = session_id AND qs.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own query messages"
  ON public.query_messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.query_sessions qs
    WHERE qs.id = session_id AND qs.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete own query messages"
  ON public.query_messages FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.query_sessions qs
    WHERE qs.id = session_id AND qs.user_id = auth.uid()
  ));

-- 新增訊息時順便把 session 的 updated_at 往前推，讓「依最近更新排序」不用額外應用層邏輯
CREATE OR REPLACE FUNCTION public.touch_query_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.query_sessions SET updated_at = now() WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_touch_query_session_updated_at
AFTER INSERT ON public.query_messages
FOR EACH ROW EXECUTE FUNCTION public.touch_query_session_updated_at();
