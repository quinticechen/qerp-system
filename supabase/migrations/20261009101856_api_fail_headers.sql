-- 修正 api_fail()：PostgREST 的自訂錯誤要求 DETAIL 同時有 status 與 headers，
-- 只有 status 時會回 500「Could not parse JSON in the RAISE SQLSTATE 'PGRST' error」，訊息也看不到。

CREATE OR REPLACE FUNCTION public.api_fail(p_code text, p_hint text, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE SQLSTATE 'PGRST' USING
    MESSAGE = json_build_object('code', p_code, 'message', p_message, 'details', NULL, 'hint', p_hint)::text,
    DETAIL = json_build_object(
      'status', CASE p_code
        WHEN '42501' THEN 403
        WHEN 'P0002' THEN 404
        WHEN '23505' THEN 409
        WHEN '55000' THEN 409
        ELSE 400 END,
      'headers', json_build_object())::text;
END;
$function$;
