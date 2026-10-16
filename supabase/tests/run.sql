-- 自動產生（build-run.sh），請勿手動修改。
-- 結果為 "ALL TESTS PASSED" 代表通過；"FAIL: ..." 或其他錯誤代表未通過。
-- 最後一定會丟出例外，整批 SQL 會回滾，不會留下任何變更。

-- ===== migration: 20261016060000_query_message_feedback.sql
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

-- ===== _helpers.sql
-- SQL 測試共用工具。
-- 每支測試腳本都在單一交易內執行，並以例外結束（通過時為 'ALL TESTS PASSED'），
-- 因此這裡建立的任何資料都不會被提交到資料庫。

-- Raise a FAIL exception when the condition does not hold
create or replace function pg_temp.check(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'FAIL: %', description;
  end if;
end $$;

-- Switch the current transaction to an authenticated user so RLS and auth.uid() apply
create or replace function pg_temp.act_as(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Create a throwaway user plus an organization with one document of every kind:
-- order -> purchase order -> inventory batch (1 roll of 100kg) -> shipping (40kg from that roll)
create or replace function pg_temp.seed_fixture()
returns jsonb language plpgsql as $$
declare
  fx jsonb := '{}';
  v_user uuid := gen_random_uuid();
  v_org uuid;
  v_customer uuid;
  v_product uuid;
  v_product2 uuid;
  v_order uuid;
  v_order_product uuid;
  v_factory uuid;
  v_po uuid;
  v_po_item uuid;
  v_warehouse uuid;
  v_inventory uuid;
  v_roll uuid;
  v_shipping uuid;
  v_shipping_item uuid;
begin
  insert into auth.users (id, aud, role, email)
  values (v_user, 'authenticated', 'authenticated', 'sql-test-' || v_user || '@example.test');

  insert into public.organizations (name, owner_id) values ('SQL 測試組織', v_user) returning id into v_org;
  insert into public.customers (name, organization_id) values ('測試客戶', v_org) returning id into v_customer;
  insert into public.products_new (name, user_id, organization_id) values ('測試棉布-' || v_user, v_user, v_org) returning id into v_product;
  insert into public.products_new (name, user_id, organization_id) values ('測試麻布-' || v_user, v_user, v_org) returning id into v_product2;

  insert into public.orders (order_number, customer_id, user_id, organization_id)
  values ('TEST', v_customer, v_user, v_org) returning id into v_order;
  insert into public.order_products (order_id, product_id, quantity, unit_price)
  values (v_order, v_product, 100, 10) returning id into v_order_product;

  insert into public.factories (name, organization_id) values ('測試工廠', v_org) returning id into v_factory;
  insert into public.purchase_orders (factory_id, user_id, organization_id)
  values (v_factory, v_user, v_org) returning id into v_po;
  insert into public.purchase_order_relations (purchase_order_id, order_id) values (v_po, v_order);
  insert into public.purchase_order_items (purchase_order_id, product_id, ordered_quantity, unit_price)
  values (v_po, v_product, 100, 5) returning id into v_po_item;

  insert into public.warehouses (name, organization_id) values ('測試倉', v_org) returning id into v_warehouse;
  insert into public.inventories (purchase_order_id, factory_id, user_id, organization_id)
  values (v_po, v_factory, v_user, v_org) returning id into v_inventory;
  insert into public.inventory_rolls (inventory_id, product_id, warehouse_id, roll_number, quantity, current_quantity)
  values (v_inventory, v_product, v_warehouse, 'T-' || v_user, 100, 100) returning id into v_roll;

  insert into public.shippings (order_id, customer_id, total_shipped_quantity, total_shipped_rolls, user_id, organization_id)
  values (v_order, v_customer, 40, 1, v_user, v_org) returning id into v_shipping;
  insert into public.shipping_items (shipping_id, inventory_roll_id, shipped_quantity)
  values (v_shipping, v_roll, 40) returning id into v_shipping_item;
  update public.inventory_rolls set current_quantity = 60 where id = v_roll;

  fx := jsonb_build_object(
    'user_id', v_user, 'org_id', v_org, 'customer_id', v_customer,
    'product_id', v_product, 'product2_id', v_product2,
    'order_id', v_order, 'order_product_id', v_order_product,
    'factory_id', v_factory, 'po_id', v_po, 'po_item_id', v_po_item,
    'warehouse_id', v_warehouse, 'inventory_id', v_inventory, 'roll_id', v_roll,
    'shipping_id', v_shipping, 'shipping_item_id', v_shipping_item
  );
  return fx;
end $$;

-- Run a statement as the given user and require it to fail with a message containing `expected`.
-- The failed statement's subtransaction is rolled back, so later checks see the data unchanged.
create or replace function pg_temp.check_raises_as(user_id uuid, statement text, expected text, description text)
returns void language plpgsql as $$
declare
  v_error text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute statement;
    execute 'reset role';
  exception when others then
    v_error := sqlerrm;
  end;
  execute 'reset role';

  if v_error is null then
    raise exception 'FAIL: % (no error raised)', description;
  end if;
  if position(expected in v_error) = 0 then
    raise exception 'FAIL: % (wrong error: %)', description, v_error;
  end if;
end $$;

-- Add a user to an organization as an active member with the given role ('admin', 'editor' or 'viewer'),
-- bypassing RLS and the membership trigger (test setup runs as the database owner)
create or replace function pg_temp.add_member(org_id uuid, member_role text)
returns uuid language plpgsql as $$
declare
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email)
  values (v_user, 'authenticated', 'authenticated', 'sql-test-' || v_user || '@example.test');
  insert into public.user_organizations (user_id, organization_id, is_active, accepted_at, role)
  values (v_user, org_id, true, now(), member_role);
  return v_user;
end $$;

-- Run a statement as the given user and require it to fail with the business-API error contract
-- (docs/API.md §2.3): the given SQLSTATE and HINT code
create or replace function pg_temp.check_api_error_as(user_id uuid, statement text, expected_state text, expected_hint text, description text)
returns void language plpgsql as $$
declare
  v_state text;
  v_hint text;
  v_message text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute statement;
    execute 'reset role';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_message = message_text;
  end;
  execute 'reset role';

  -- Business APIs raise through api_fail(): SQLSTATE PGRST with the real code, hint and message as JSON
  if v_state = 'PGRST' then
    v_hint := v_message::json->>'hint';
    v_state := v_message::json->>'code';
    v_message := v_message::json->>'message';
  end if;

  if v_state is null then
    raise exception 'FAIL: % (no error raised)', description;
  end if;
  if v_state <> expected_state or coalesce(v_hint, '') <> expected_hint then
    raise exception 'FAIL: % (got % / % / %)', description, v_state, coalesce(v_hint, 'no hint'), v_message;
  end if;
end $$;

-- Run a statement as the given user and return its single jsonb result
create or replace function pg_temp.call_as(user_id uuid, statement text)
returns jsonb language plpgsql as $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute statement into v_result;
  execute 'reset role';
  return v_result;
end $$;

-- ===== test: query_message_feedback.test.sql
-- Query 回覆讚／倒讚的測試（migration 20261016060000_query_message_feedback.sql）。先載入 _helpers.sql 再執行本檔。

-- The owner can rate, change and clear the rating of an assistant reply; only metadata.feedback changes
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_session uuid;
  v_reply uuid;
  v_result jsonb;
  v_row public.query_messages;
begin
  insert into public.query_sessions (user_id, organization_id) values (v_user, (fx->>'org_id')::uuid) returning id into v_session;
  insert into public.query_messages (session_id, role, content, metadata)
  values (v_session, 'assistant', '回覆', '{"trace_id": "t1"}') returning id into v_reply;

  v_result := pg_temp.call_as(v_user, format('select public.set_query_message_feedback(%L, %L)', v_reply, 'down'));
  perform pg_temp.check(v_result->'feedback'->>'value' = 'down', 'thumbs down is stored, got ' || v_result);
  perform pg_temp.check(v_result->>'trace_id' = 't1', 'the rest of metadata is kept');

  v_result := pg_temp.call_as(v_user, format('select public.set_query_message_feedback(%L, %L)', v_reply, 'up'));
  perform pg_temp.check(v_result->'feedback'->>'value' = 'up', 'the rating can change');

  v_result := pg_temp.call_as(v_user, format('select public.set_query_message_feedback(%L, null)', v_reply));
  perform pg_temp.check(not (v_result ? 'feedback'), 'null clears the rating');

  select * into v_row from public.query_messages where id = v_reply;
  perform pg_temp.check(v_row.content = '回覆', 'the content is unchanged');
end $$;

-- Nobody else can rate it, a user message cannot be rated, and only up/down are accepted
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_session uuid;
  v_reply uuid;
  v_question uuid;
begin
  insert into public.query_sessions (user_id, organization_id) values (v_user, (fx->>'org_id')::uuid) returning id into v_session;
  insert into public.query_messages (session_id, role, content) values (v_session, 'assistant', '回覆') returning id into v_reply;
  insert into public.query_messages (session_id, role, content) values (v_session, 'user', '問題') returning id into v_question;

  perform pg_temp.check_raises_as((other->>'user_id')::uuid,
    format('select public.set_query_message_feedback(%L, %L)', v_reply, 'up'), '找不到這則回覆', 'another user cannot rate the reply');
  perform pg_temp.check_raises_as(v_user,
    format('select public.set_query_message_feedback(%L, %L)', v_question, 'up'), '找不到這則回覆', 'a user message cannot be rated');
  perform pg_temp.check_raises_as(v_user,
    format('select public.set_query_message_feedback(%L, %L)', v_reply, 'meh'), '回饋只能是讚或倒讚', 'only up or down');

  -- No UPDATE policy: a direct update changes nothing.
  perform pg_temp.act_as(v_user);
  update public.query_messages set content = '改' where id = v_reply;
  execute 'reset role';
  perform pg_temp.check((select content from public.query_messages where id = v_reply) = '回覆', 'messages still cannot be updated directly');
end $$;


do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
