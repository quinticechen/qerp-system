-- 自動產生（build-run.sh），請勿手動修改。
-- 結果為 "ALL TESTS PASSED" 代表通過；"FAIL: ..." 或其他錯誤代表未通過。
-- 最後一定會丟出例外，整批 SQL 會回滾，不會留下任何變更。

-- ===== migration: 20261009101856_api_fail_headers.sql
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
  insert into public.purchase_orders (factory_id, user_id, organization_id, order_id)
  values (v_factory, v_user, v_org, v_order) returning id into v_po;
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
-- (docs/BUSINESS_API.md §2.3): the given SQLSTATE and HINT code
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

-- ===== test: api_http_status.test.sql
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
