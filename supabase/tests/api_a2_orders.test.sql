-- 業務 API A2：訂單（docs/API.md）。先載入 _helpers.sql 再執行本檔。

-- Add an active factory to an organization (test setup)
create or replace function pg_temp.add_factory(org_id uuid, factory_name text, active boolean default true)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.factories (name, organization_id, is_active) values (factory_name, org_id, active) returning id into v_id;
  return v_id;
end $$;

-- create_order writes the order, its lines and factories in one go and numbers it within the organization
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_prefix text := 'B' || to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD');
  v_items jsonb;
  v_result jsonb;
  v_second jsonb;
  v_other jsonb;
  v_order public.orders%rowtype;
begin
  v_items := jsonb_build_array(
    jsonb_build_object('product_id', fx->>'product_id', 'quantity', 100, 'unit_price', 12.5, 'total_rolls', 4),
    jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 20, 'unit_price', 30));

  v_result := pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L, array[%L]::uuid[], %L)',
    v_org, fx->>'customer_id', v_items, fx->>'factory_id', '急件'));
  select * into v_order from public.orders where id = (v_result->>'id')::uuid;

  perform pg_temp.check(v_result->>'number' = v_prefix || '0001', 'the first order of the day is B<date>0001, got ' || coalesce(v_result->>'number', 'none'));
  perform pg_temp.check(v_order.order_number = v_result->>'number' and v_order.organization_id = v_org, 'the order is stored with its number');
  perform pg_temp.check(v_order.status = 'pending' and v_order.user_id = v_editor and v_order.note = '急件', 'the order starts pending and records its creator');
  perform pg_temp.check((select count(*) from public.order_products where order_id = v_order.id) = 2, 'both lines are stored');
  perform pg_temp.check(exists (select 1 from public.order_factories where order_id = v_order.id and factory_id = (fx->>'factory_id')::uuid), 'the factory is assigned');

  perform pg_temp.check(v_result->'summary'->>'title' = '建立訂單', 'the summary has a title');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '客戶', 'value', '測試客戶'),
      jsonb_build_object('label', '品項 1', 'value', public.api_product_label((fx->>'product_id')::uuid) || ' × 100 公斤，單價 12.5'),
      jsonb_build_object('label', '指定工廠', 'value', '測試工廠'),
      jsonb_build_object('label', '訂單總額', 'value', '1850')),
    'the summary describes customer, lines, factory and total, got ' || (v_result->'summary'->'fields')::text);

  v_second := pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L)', v_org, fx->>'customer_id', v_items));
  perform pg_temp.check(v_second->>'number' = v_prefix || '0002', 'the next order is 0002, got ' || coalesce(v_second->>'number', 'none'));

  -- Numbers are counted per organization (Phase 0 F14)
  v_other := pg_temp.call_as((other->>'user_id')::uuid, format('select public.create_order(%L, %L, %L)', other->>'org_id', other->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'quantity', 1, 'unit_price', 1))));
  perform pg_temp.check(v_other->>'number' = v_prefix || '0001', 'another organization starts its own numbering, got ' || coalesce(v_other->>'number', 'none'));
end $$;

-- A dry run validates, describes and numbers nothing: no rows, no audit trail, no gap in the numbering
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'unit_price', 5));
  v_orders int;
  v_logs int;
  v_preview jsonb;
  v_real jsonb;
begin
  select count(*) into v_orders from public.orders where organization_id = v_org;
  select count(*) into v_logs from public.record_audit_logs where organization_id = v_org;

  v_preview := pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L, p_note => %L, p_dry_run => true)',
    v_org, fx->>'customer_id', v_items, '試算'));
  perform pg_temp.check((v_preview->>'dry_run')::boolean and v_preview->>'id' is null and v_preview->>'number' is null, 'a dry run has no id or number');
  perform pg_temp.check((select count(*) from public.orders where organization_id = v_org) = v_orders, 'a dry run stores no order');
  perform pg_temp.check((select count(*) from public.record_audit_logs where organization_id = v_org) = v_logs, 'a dry run leaves no audit trail');

  v_real := pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L, p_note => %L)', v_org, fx->>'customer_id', v_items, '試算'));
  perform pg_temp.check(v_preview->'summary' = v_real->'summary', 'the dry run shows the same summary as the real call');
  perform pg_temp.check(v_real->>'number' like 'B%0001', 'the dry run did not use up a number, got ' || (v_real->>'number'));
end $$;

-- create_order rules
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_line jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'unit_price', 5));
  v_inactive_factory uuid := pg_temp.add_factory((fx->>'org_id')::uuid, '停用工廠', false);
  v_call text := 'select public.create_order(%L, %L, %L, %L::uuid[], p_dry_run => true)';
begin
  perform pg_temp.check_api_error_as(v_viewer, format(v_call, v_org, fx->>'customer_id', v_line, '{}'), '42501', 'forbidden', 'a viewer cannot create orders');
  perform pg_temp.check_api_error_as((other->>'user_id')::uuid, format(v_call, v_org, fx->>'customer_id', v_line, '{}'), '42501', 'forbidden', 'an outsider cannot create orders here');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, other->>'customer_id', v_line, '{}'), 'P0002', 'customer_not_found', 'another organization''s customer is not found');

  update public.customers set is_active = false where id = (fx->>'customer_id')::uuid;
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id', v_line, '{}'), '22023', 'customer_inactive', 'a disabled customer gets no new orders');
  update public.customers set is_active = true where id = (fx->>'customer_id')::uuid;

  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id', '[]', '{}'), '22023', 'items_required', 'an order needs a line');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'quantity', 1, 'unit_price', 1)), '{}'),
    'P0002', 'product_not_found', 'another organization''s product is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 0, 'unit_price', 1)), '{}'),
    '22023', 'invalid_quantity', 'quantities must be positive');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 1, 'unit_price', -1)), '{}'),
    '22023', 'invalid_unit_price', 'prices cannot be negative');

  update public.products_new set status = 'Unavailable' where id = (fx->>'product_id')::uuid;
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id', v_line, '{}'), '22023', 'product_unavailable', 'disabled products cannot be ordered');
  update public.products_new set status = 'Available' where id = (fx->>'product_id')::uuid;

  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id', v_line, array[other->>'factory_id']::text),
    'P0002', 'factory_not_found', 'another organization''s factory is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id', v_line, array[v_inactive_factory]::text),
    '22023', 'factory_inactive', 'a disabled factory cannot be assigned');
end $$;

-- update_order changes only what is given and lists every change, including line changes
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_factory2 uuid := pg_temp.add_factory((fx->>'org_id')::uuid, '第二工廠');
  v_order uuid;
  v_line_id uuid;
  v_changes jsonb;
  v_preview jsonb;
  v_result jsonb;
  v_row public.orders%rowtype;
begin
  v_order := (pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'unit_price', 5)), fx->>'factory_id'))->>'id')::uuid;
  select id into v_line_id from public.order_products where order_id = v_order;

  v_changes := jsonb_build_object(
    'note', '改為急件',
    'payment_status', 'partial_paid',
    'factory_ids', jsonb_build_array(v_factory2),
    'items', jsonb_build_array(
      jsonb_build_object('id', v_line_id, 'product_id', fx->>'product_id', 'quantity', 15, 'unit_price', 5),
      jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 3, 'unit_price', 9)));

  v_preview := pg_temp.call_as(v_editor, format('select public.update_order(%L, %L, %L, true)', v_org, v_order, v_changes));
  perform pg_temp.check((select note from public.orders where id = v_order) is null, 'a dry run changes nothing');
  perform pg_temp.check((select count(*) from public.order_products where order_id = v_order) = 1, 'a dry run adds no line');

  v_result := pg_temp.call_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, v_order, v_changes));
  select * into v_row from public.orders where id = v_order;
  perform pg_temp.check(v_row.note = '改為急件' and v_row.payment_status = 'partial_paid' and v_row.status = 'pending', 'given fields change, others stay');
  perform pg_temp.check((select array_agg(factory_id) from public.order_factories where order_id = v_order) = array[v_factory2], 'factories are replaced');
  perform pg_temp.check((select quantity from public.order_products where id = v_line_id) = 15, 'the line is updated');
  perform pg_temp.check(v_preview->'summary' = v_result->'summary', 'the dry run shows the same summary as the real call');
  perform pg_temp.check(v_result->>'number' = v_row.order_number and v_result->'summary'->>'title' = '修改訂單 ' || v_row.order_number, 'the result names the order');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '付款狀態', 'value', '未付款 → 部分付款'),
      jsonb_build_object('label', '指定工廠', 'value', '測試工廠 → 第二工廠'),
      jsonb_build_object('label', '備註', 'value', '（空白） → 改為急件'),
      jsonb_build_object('label', '修改品項', 'value',
        public.api_product_label((fx->>'product_id')::uuid) || ' × 10 公斤，單價 5 → ' || public.api_product_label((fx->>'product_id')::uuid) || ' × 15 公斤，單價 5'),
      jsonb_build_object('label', '新增品項', 'value', public.api_product_label((fx->>'product2_id')::uuid) || ' × 3 公斤，單價 9')),
    'the summary lists every change, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, v_order, '{"status": "cancelled"}'),
    '22023', 'use_cancel_order', 'cancelling goes through cancel_order');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, v_order, '{"status": "shipped"}'),
    '22023', 'invalid_status', 'only order statuses are accepted');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, v_order, '{"customer_id": "x"}'),
    '22023', 'unknown_field', 'only order fields can be changed');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_order(%L, %L, %L)', v_org, v_order, '{"note": "x"}'),
    '42501', 'forbidden', 'a viewer cannot edit orders');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, other->>'order_id', '{"note": "x"}'),
    'P0002', 'order_not_found', 'another organization''s order is not found');

  -- The fixture order has 40kg shipped on its line: the existing lock rules come back with error codes
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, fx->>'order_id',
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', fx->>'order_product_id', 'product_id', fx->>'product_id', 'quantity', 30, 'unit_price', 10)))),
    '55000', 'quantity_below_shipped', 'a line cannot drop below what has shipped');
end $$;

-- cancel_order refuses orders with shipments or live purchase orders; cancelled orders are frozen
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_line jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'unit_price', 5));
  v_order uuid;
  v_po_order uuid;
  v_result jsonb;
  v_row public.orders%rowtype;
begin
  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, fx->>'order_id'),
    '55000', 'order_has_shipments', 'an order with shipments cannot be cancelled');

  v_po_order := (pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L)', v_org, fx->>'customer_id', v_line))->>'id')::uuid;
  with po as (insert into public.purchase_orders (factory_id, user_id, organization_id) values ((fx->>'factory_id')::uuid, v_editor, v_org) returning id)
  insert into public.purchase_order_relations (purchase_order_id, order_id) select id, v_po_order from po;
  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, v_po_order),
    '55000', 'order_has_purchase_orders', 'an order with a live purchase order cannot be cancelled');

  v_order := (pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L)', v_org, fx->>'customer_id', v_line))->>'id')::uuid;
  perform pg_temp.check_api_error_as(v_viewer, format('select public.cancel_order(%L, %L)', v_org, v_order), '42501', 'forbidden', 'a viewer cannot cancel orders');

  v_result := pg_temp.call_as(v_editor, format('select public.cancel_order(%L, %L, %L, true)', v_org, v_order, '客戶取消'));
  perform pg_temp.check((select status from public.orders where id = v_order) = 'pending', 'a dry run does not cancel');
  perform pg_temp.check(v_result->'summary'->'fields' = '[{"label": "訂單狀態", "value": "待確認 → 已取消"}, {"label": "取消原因", "value": "客戶取消"}]',
    'the summary shows the cancellation, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.call_as(v_editor, format('select public.cancel_order(%L, %L, %L)', v_org, v_order, '客戶取消'));
  select * into v_row from public.orders where id = v_order;
  perform pg_temp.check(v_row.status = 'cancelled' and v_row.cancel_reason = '客戶取消' and v_row.cancelled_at is not null, 'the order is cancelled with its reason');

  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, v_order), '55000', 'order_already_cancelled', 'an order is cancelled once');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, v_order, '{"note": "x"}'),
    '55000', 'order_cancelled', 'a cancelled order cannot be edited');
end $$;

-- Documents members write directly (not yet through an API) are always numbered by the system, within the organization
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_date text := to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD');
  v_po text;
  v_order text;
  v_placeholder text;
  v_receipt text;
begin
  perform pg_temp.act_as(v_owner);
  insert into public.purchase_orders (factory_id, user_id, organization_id) values ((fx->>'factory_id')::uuid, v_owner, v_org) returning po_number into v_po;
  insert into public.orders (order_number, customer_id, user_id, organization_id) values ('temp', (fx->>'customer_id')::uuid, v_owner, v_org) returning order_number into v_order;
  -- The AI create_order tool sends a made-up number; the system number replaces it, as it always has
  insert into public.orders (order_number, customer_id, user_id, organization_id) values ('ORD-1728000000000', (fx->>'customer_id')::uuid, v_owner, v_org) returning order_number into v_placeholder;
  insert into public.inventories (purchase_order_id, factory_id, user_id, organization_id)
  values ((fx->>'po_id')::uuid, (fx->>'factory_id')::uuid, v_owner, v_org) returning receipt_number into v_receipt;
  execute 'reset role';

  -- seed_fixture already created today's first purchase order and receiving batch for this organization
  perform pg_temp.check(v_po = 'P' || v_date || '0002', 'a purchase order inserted by a member is numbered, got ' || coalesce(v_po, 'none'));
  perform pg_temp.check(v_receipt = 'I' || v_date || '0002', 'a receiving batch inserted by a member is numbered, got ' || coalesce(v_receipt, 'none'));
  perform pg_temp.check(v_order = 'B' || v_date || '0001', 'an order inserted with a placeholder is numbered, got ' || coalesce(v_order, 'none'));
  perform pg_temp.check(v_placeholder = 'B' || v_date || '0002', 'a number chosen by the client is replaced, got ' || coalesce(v_placeholder, 'none'));
  perform pg_temp.check(not exists (select 1 from public.inventories where receipt_number is null), 'every receiving batch has a number');

  perform pg_temp.check(not has_function_privilege('authenticated', 'public.api_next_document_number(uuid, text)', 'EXECUTE'), 'numbering is internal');
  perform pg_temp.check_api_error_as((other->>'user_id')::uuid, format('select private.api_assign_document_number(%L, %L)', v_org, 'order'),
    '42501', 'forbidden', 'nobody can read another organization''s numbering');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
