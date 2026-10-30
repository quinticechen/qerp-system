-- Query 回覆的讚／倒讚（docs/requirements/QUERY_AGENT_LANGFUSE.md §2.4）
--
-- 存在 query_messages.metadata.feedback：{ "value": "up" | "down", "at": <時間> }；value 為 null 時移除。
-- query_messages 沒有 UPDATE policy（使用者不能改訊息內容），所以由這支函式只改 feedback：
-- 只限自己對話中的 assistant 文字回覆。實作放 private（SECURITY DEFINER），public 為包裝函式。

CREATE OR REPLACE FUNCTION private.set_query_message_feedback(p_message_id uuid, p_value text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_metadata jsonb;
BEGIN
  IF p_value IS NOT NULL AND p_value NOT IN ('up', 'down') THEN
    RAISE EXCEPTION '回饋只能是讚或倒讚' USING ERRCODE = '22023', HINT = 'invalid_feedback';
  END IF;

  UPDATE public.query_messages m
     SET metadata = CASE
           WHEN p_value IS NULL THEN m.metadata - 'feedback'
           ELSE m.metadata || jsonb_build_object('feedback', jsonb_build_object('value', p_value, 'at', now()))
         END
   WHERE m.id = p_message_id
     AND m.role = 'assistant'
     AND m.kind = 'text'
     AND EXISTS (
       SELECT 1 FROM public.query_sessions s
        WHERE s.id = m.session_id AND s.user_id = auth.uid()
     )
  RETURNING m.metadata INTO v_metadata;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這則回覆' USING ERRCODE = 'P0002', HINT = 'not_found';
  END IF;
  RETURN v_metadata;
END;
$function$;

REVOKE ALL ON FUNCTION private.set_query_message_feedback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.set_query_message_feedback(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_query_message_feedback(p_message_id uuid, p_value text)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.set_query_message_feedback(p_message_id, p_value);
$function$;

REVOKE ALL ON FUNCTION public.set_query_message_feedback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_query_message_feedback(uuid, text) TO authenticated, service_role;
