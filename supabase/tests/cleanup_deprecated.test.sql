-- 清理棄用的資料表、欄位與函式（docs/DATABASE_TABLES.md §4）。先載入 _helpers.sql 再執行本檔。

-- The deprecated objects are gone
do $$
begin
  perform pg_temp.check(to_regclass('public.organization_roles') is null, 'organization_roles is dropped');
  perform pg_temp.check(to_regclass('public.user_organization_roles') is null, 'user_organization_roles is dropped');
  perform pg_temp.check(to_regclass('public.shipment_history') is null, 'shipment_history is dropped');
  perform pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public'
      and (table_name, column_name) in (('purchase_orders', 'order_id'), ('user_organizations', 'invited_role_id'), ('organizations', 'settings'))),
    'the deprecated columns are dropped');
  perform pg_temp.check(not exists (select 1 from pg_proc where proname = 'create_default_organization_roles'), 'the role seeding function is dropped');
  perform pg_temp.check(not exists (select 1 from public.record_audit_logs where table_name in ('organization_roles', 'user_organization_roles')),
    'the dropped tables leave no history behind');
  -- Nothing left refers to the dropped column or tables
  perform pg_temp.check(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
      and prosrc ~ '(organization_roles|shipment_history|invited_role_id|po\.order_id)'),
    'no function refers to the dropped objects');
end $$;

-- Purchase orders are linked to orders only through purchase_order_relations, and the rules still hold
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_order uuid;
  v_po uuid;
begin
  perform pg_temp.check(public.order_product_is_purchased((fx->>'order_id')::uuid, (fx->>'product_id')::uuid),
    'a product on a linked purchase order counts as purchased');

  v_order := (pg_temp.call_as(v_owner, format('select public.create_order(%L, %L, %L)', v_org, fx->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 5, 'unit_price', 1))))->>'id')::uuid;
  v_po := (pg_temp.call_as(v_owner, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 5, 'unit_price', 1)), v_order))->>'id')::uuid;
  perform pg_temp.check_api_error_as(v_owner, format('select public.cancel_order(%L, %L)', v_org, v_order),
    '55000', 'order_has_purchase_orders', 'an order with a linked live purchase order cannot be cancelled');

  perform pg_temp.call_as(v_owner, format('select public.cancel_purchase_order(%L, %L)', v_org, v_po));
  perform pg_temp.check((select status from public.orders where id = v_order) = 'confirmed', 'cancelling the purchase order releases the order');
  perform pg_temp.call_as(v_owner, format('select public.cancel_order(%L, %L)', v_org, v_order));
  perform pg_temp.check((select status from public.orders where id = v_order) = 'cancelled', 'then the order can be cancelled');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
