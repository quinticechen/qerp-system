-- 業務 API 的錯誤以 PostgREST 自訂錯誤回報，HTTP 狀態依錯誤類別（docs/BUSINESS_API.md §2.3）。先載入 _helpers.sql 再執行本檔。

-- api_fail() keeps the code, hint and message and picks the HTTP status from the code
do $$
declare
  v_case record;
  v_state text;
  v_message text;
  v_detail text;
begin
  for v_case in
    select * from (values
      ('42501', 'forbidden', 403), ('P0002', 'order_not_found', 404), ('23505', 'customer_name_taken', 409),
      ('55000', 'order_cancelled', 409), ('22023', 'items_required', 400)
    ) as t(code, hint, status)
  loop
    begin
      perform public.api_fail(v_case.code, v_case.hint, '測試訊息「甲」');
      raise exception 'FAIL: api_fail did not raise';
    exception when sqlstate 'PGRST' then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    end;
    perform pg_temp.check(v_message::json->>'code' = v_case.code and v_message::json->>'hint' = v_case.hint
      and v_message::json->>'message' = '測試訊息「甲」', v_case.code || ': the response keeps code, hint and message, got ' || v_message);
    perform pg_temp.check((v_detail::json->>'status')::int = v_case.status,
      v_case.code || ': HTTP status ' || v_case.status || ', got ' || coalesce(v_detail, 'none'));
    -- PostgREST rejects a DETAIL without headers (PGRST121) and answers 500
    perform pg_temp.check(json_typeof(v_detail::json->'headers') = 'object', v_case.code || ': DETAIL carries headers, got ' || coalesce(v_detail, 'none'));
  end loop;
end $$;

-- Real API errors go through it, so refusals are 4xx instead of 500
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_detail text;
  v_message text;
begin
  perform pg_temp.act_as((fx->>'user_id')::uuid);
  begin
    perform public.cancel_purchase_order((fx->>'org_id')::uuid, (fx->>'po_id')::uuid);
  exception when sqlstate 'PGRST' then
    get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
  end;
  execute 'reset role';
  perform pg_temp.check(v_message::json->>'hint' = 'purchase_order_received' and (v_detail::json->>'status')::int = 409,
    'refusing to cancel a received purchase order answers 409, got ' || coalesce(v_message, 'no error') || ' / ' || coalesce(v_detail, ''));

  -- No business function raises a bare SQLSTATE with a hint any more
  perform pg_temp.check(not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~* 'HINT\s*=\s*''' ),
    'every hinted error goes through api_fail()');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
