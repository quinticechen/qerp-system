-- 業務 API A3：採購單（docs/API.md）。先載入 _helpers.sql 再執行本檔。

-- Add an active factory to an organization (test setup; same as in api_a2_orders.test.sql)
create or replace function pg_temp.add_factory(org_id uuid, factory_name text, active boolean default true)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.factories (name, organization_id, is_active) values (factory_name, org_id, active) returning id into v_id;
  return v_id;
end $$;

-- create_purchase_order writes the purchase order, its items and linked orders, numbers it and marks the orders
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_date text := to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD');
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_order uuid;
  v_items jsonb;
  v_result jsonb;
  v_po public.purchase_orders%rowtype;
  v_other jsonb;
begin
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'confirmed') returning id into v_order;

  v_items := jsonb_build_array(
    jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 200, 'unit_price', 4.5, 'ordered_rolls', 8),
    jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 50, 'unit_price', 6));

  v_result := pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[], %L, %L)',
    v_org, fx->>'factory_id', v_items, v_order, v_today + 14, '先做白色'));
  select * into v_po from public.purchase_orders where id = (v_result->>'id')::uuid;

  -- seed_fixture already created today's first purchase order for this organization
  perform pg_temp.check(v_result->>'number' = 'P' || v_date || '0002', 'the purchase order is numbered P<date>, got ' || coalesce(v_result->>'number', 'none'));
  perform pg_temp.check(v_po.po_number = v_result->>'number' and v_po.organization_id = v_org and v_po.user_id = v_editor, 'the purchase order is stored with its number and creator');
  perform pg_temp.check(v_po.status = 'confirmed' and v_po.order_date = v_today and v_po.expected_arrival_date = v_today + 14 and v_po.note = '先做白色',
    'the purchase order is placed today with its arrival date and note');
  perform pg_temp.check((select count(*) from public.purchase_order_items where purchase_order_id = v_po.id) = 2, 'both items are stored');
  perform pg_temp.check(exists (select 1 from public.purchase_order_items where purchase_order_id = v_po.id and product_id = (fx->>'product_id')::uuid
      and ordered_quantity = 200 and ordered_rolls = 8 and unit_price = 4.5 and status = 'pending'), 'an item keeps its quantity, rolls and price');
  perform pg_temp.check(exists (select 1 from public.purchase_order_relations where purchase_order_id = v_po.id and order_id = v_order), 'the order is linked');
  perform pg_temp.check((select status from public.orders where id = v_order) = 'factory_ordered', 'the linked order becomes 已向工廠下單');

  perform pg_temp.check(v_result->'summary'->>'title' = '建立採購單', 'the summary has a title');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '工廠', 'value', '測試工廠'),
      jsonb_build_object('label', '關聯訂單', 'value', (select order_number from public.orders where id = v_order)),
      jsonb_build_object('label', '品項 1', 'value', public.api_product_label((fx->>'product_id')::uuid) || ' × 200 公斤，單價 4.5'),
      jsonb_build_object('label', '預計到貨日期', 'value', (v_today + 14)::text),
      jsonb_build_object('label', '採購總額', 'value', '1200')),
    'the summary describes factory, orders, items, arrival and total, got ' || (v_result->'summary'->'fields')::text);

  v_other := pg_temp.call_as((other->>'user_id')::uuid, format('select public.create_purchase_order(%L, %L, %L)', other->>'org_id', other->>'factory_id',
    jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'ordered_quantity', 1, 'unit_price', 1))));
  perform pg_temp.check(v_other->>'number' = 'P' || v_date || '0002', 'another organization counts its own numbers, got ' || coalesce(v_other->>'number', 'none'));
end $$;

-- A dry run stores nothing, does not touch the linked orders and shows the same summary
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_order uuid;
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 10, 'unit_price', 5));
  v_pos int;
  v_logs int;
  v_preview jsonb;
  v_real jsonb;
begin
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'pending') returning id into v_order;
  select count(*) into v_pos from public.purchase_orders where organization_id = v_org;
  select count(*) into v_logs from public.record_audit_logs where organization_id = v_org;

  v_preview := pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[], p_dry_run => true)',
    v_org, fx->>'factory_id', v_items, v_order));
  perform pg_temp.check((v_preview->>'dry_run')::boolean and v_preview->>'id' is null and v_preview->>'number' is null, 'a dry run has no id or number');
  perform pg_temp.check((select count(*) from public.purchase_orders where organization_id = v_org) = v_pos, 'a dry run stores no purchase order');
  perform pg_temp.check((select count(*) from public.record_audit_logs where organization_id = v_org) = v_logs, 'a dry run leaves no audit trail');
  perform pg_temp.check((select status from public.orders where id = v_order) = 'pending', 'a dry run leaves the order alone');

  v_real := pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id', v_items, v_order));
  perform pg_temp.check(v_preview->'summary' = v_real->'summary', 'the dry run shows the same summary as the real call');
end $$;

-- create_purchase_order refuses bad input and needs canCreatePurchases
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 10, 'unit_price', 5));
  v_inactive uuid;
  v_cancelled uuid;
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_call text := 'select public.create_purchase_order(%L, %L, %L)';
begin
  insert into public.factories (name, organization_id, is_active) values ('停用工廠', v_org, false) returning id into v_inactive;
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'cancelled') returning id into v_cancelled;

  perform pg_temp.check_api_error_as(v_viewer, format(v_call, v_org, fx->>'factory_id', v_items), '42501', 'forbidden', 'a viewer cannot create purchase orders');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, other->>'org_id', other->>'factory_id', v_items), '42501', 'forbidden',
    'nobody can create purchase orders in another organization');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, other->>'factory_id', v_items), 'P0002', 'factory_not_found',
    'another organization''s factory is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, v_inactive, v_items), '22023', 'factory_inactive', 'a disabled factory gets no new purchase orders');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'factory_id', '[]'), '22023', 'items_required', 'a purchase order needs an item');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'factory_id',
      jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'ordered_quantity', 1, 'unit_price', 1))),
    'P0002', 'product_not_found', 'another organization''s product is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'factory_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 0, 'unit_price', 1))),
    '22023', 'invalid_quantity', 'the quantity must be positive');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'factory_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 1, 'unit_price', -1))),
    '22023', 'invalid_unit_price', 'the price cannot be negative');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id', v_items, other->>'order_id'),
    'P0002', 'order_not_found', 'another organization''s order is not found');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id', v_items, v_cancelled),
    '55000', 'order_cancelled', 'a cancelled order cannot be purchased for');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, p_expected_arrival_date => %L)', v_org, fx->>'factory_id', v_items, v_today - 1),
    '22023', 'invalid_expected_arrival_date', 'the arrival date cannot be before the order date');

  update public.products_new set status = 'Unavailable' where id = (fx->>'product_id')::uuid;
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'factory_id', v_items), '22023', 'product_unavailable', 'a disabled product cannot be purchased');
end $$;

-- update_purchase_order changes items, dates, note and linked orders, respecting what has been received
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_first uuid;
  v_second uuid;
  v_po uuid;
  v_number text;
  v_item uuid;
  v_preview jsonb;
  v_result jsonb;
  v_changes jsonb;
begin
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'confirmed') returning id into v_first;
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'confirmed') returning id into v_second;

  v_po := (pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 100, 'unit_price', 5)), v_first))->>'id')::uuid;
  select po_number into v_number from public.purchase_orders where id = v_po;
  select id into v_item from public.purchase_order_items where purchase_order_id = v_po;

  v_changes := jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('id', v_item, 'product_id', fx->>'product_id', 'ordered_quantity', 120, 'unit_price', 5),
      jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 30, 'unit_price', 8)),
    'order_ids', jsonb_build_array(v_second),
    'expected_arrival_date', (v_today + 7)::text,
    'note', '改量');

  v_preview := pg_temp.call_as(v_editor, format('select public.update_purchase_order(%L, %L, %L, true)', v_org, v_po, v_changes));
  perform pg_temp.check((select ordered_quantity from public.purchase_order_items where id = v_item) = 100, 'a dry run changes nothing');
  perform pg_temp.check((select status from public.orders where id = v_second) = 'confirmed', 'a dry run links no order');

  v_result := pg_temp.call_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, v_changes));
  perform pg_temp.check(v_preview->'summary' = v_result->'summary', 'the dry run shows the same summary');
  perform pg_temp.check(v_result->'summary'->>'title' = '修改採購單 ' || v_number and v_result->>'number' = v_number, 'the summary names the purchase order');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '預計到貨日期', 'value', '（空白） → ' || (v_today + 7)::text),
      jsonb_build_object('label', '備註', 'value', '（空白） → 改量'),
      jsonb_build_object('label', '修改品項', 'value', public.api_product_label((fx->>'product_id')::uuid) || ' × 100 公斤，單價 5 → '
        || public.api_product_label((fx->>'product_id')::uuid) || ' × 120 公斤，單價 5'),
      jsonb_build_object('label', '新增品項', 'value', public.api_product_label((fx->>'product2_id')::uuid) || ' × 30 公斤，單價 8')),
    'the summary lists the changes, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.check((select ordered_quantity from public.purchase_order_items where id = v_item) = 120, 'the item is updated');
  perform pg_temp.check((select count(*) from public.purchase_order_items where purchase_order_id = v_po) = 2, 'the new item is added');
  perform pg_temp.check((select status from public.orders where id = v_second) = 'factory_ordered', 'a newly linked order becomes 已向工廠下單');
  perform pg_temp.check((select status from public.orders where id = v_first) = 'confirmed', 'an unlinked order without other purchase orders goes back to 已確認');
  perform pg_temp.check(not exists (select 1 from public.purchase_order_relations where purchase_order_id = v_po and order_id = v_first), 'the old order is unlinked');

  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"note":"x"}'),
    '42501', 'forbidden', 'a viewer cannot edit purchase orders');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"status":"cancelled"}'),
    '22023', 'use_cancel_purchase_order', 'cancelling goes through cancel_purchase_order');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"status":"partial_arrived"}'),
    '22023', 'invalid_status', 'only the listed statuses can be set');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"expected_arrival_date":"明天"}'),
    '22023', 'invalid_date', 'dates must be dates');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"po_number":"x"}'),
    '22023', 'unknown_field', 'the number cannot be changed');

  -- The fixture's purchase order has goods received: the received item is locked and the factory cannot change
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, fx->>'po_id',
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 1, 'unit_price', 1)))),
    '55000', 'item_received', 'a received item cannot be removed');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, fx->>'po_id',
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', fx->>'po_item_id', 'product_id', fx->>'product_id', 'ordered_quantity', 50, 'unit_price', 5)))),
    '55000', 'quantity_below_received', 'the quantity cannot drop below what was received');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, fx->>'po_id',
      jsonb_build_object('factory_id', gen_random_uuid())),
    'P0002', 'factory_not_found', 'a missing factory is not found');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, fx->>'po_id',
      jsonb_build_object('factory_id', pg_temp.add_factory(v_org, '新工廠'))),
    '55000', 'purchase_order_received', 'a purchase order with goods received cannot change factory');
end $$;

-- cancel_purchase_order: refused once goods are received; releases the linked orders; a cancelled one is frozen
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_order uuid;
  v_po uuid;
  v_other_po uuid;
  v_number text;
  v_result jsonb;
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 10, 'unit_price', 5));
begin
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'confirmed') returning id into v_order;
  v_po := (pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id', v_items, v_order))->>'id')::uuid;
  v_other_po := (pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id', v_items, v_order))->>'id')::uuid;
  select po_number into v_number from public.purchase_orders where id = v_po;

  perform pg_temp.check_api_error_as(v_viewer, format('select public.cancel_purchase_order(%L, %L)', v_org, v_po), '42501', 'forbidden', 'a viewer cannot cancel');
  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_purchase_order(%L, %L)', v_org, fx->>'po_id'),
    '55000', 'purchase_order_received', 'a purchase order with goods received cannot be cancelled');

  v_result := pg_temp.call_as(v_editor, format('select public.cancel_purchase_order(%L, %L, %L, true)', v_org, v_po, '工廠缺料'));
  perform pg_temp.check((select status from public.purchase_orders where id = v_po) = 'confirmed', 'a dry run cancels nothing');
  perform pg_temp.check(v_result->'summary'->'fields' = jsonb_build_array(
      jsonb_build_object('label', '狀態', 'value', '已下單 → 已取消'),
      jsonb_build_object('label', '取消原因', 'value', '工廠缺料')),
    'the summary shows the cancellation, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.call_as(v_editor, format('select public.cancel_purchase_order(%L, %L, %L)', v_org, v_po, '工廠缺料'));
  perform pg_temp.check((select status = 'cancelled' and cancelled_at is not null and cancel_reason = '工廠缺料' from public.purchase_orders where id = v_po),
    'the purchase order is cancelled with its reason');
  perform pg_temp.check((select status from public.orders where id = v_order) = 'factory_ordered', 'an order with another live purchase order stays 已向工廠下單');

  perform pg_temp.call_as(v_editor, format('select public.cancel_purchase_order(%L, %L)', v_org, v_other_po));
  perform pg_temp.check((select status from public.orders where id = v_order) = 'confirmed', 'an order without live purchase orders goes back to 已確認');

  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_purchase_order(%L, %L)', v_org, v_po),
    '55000', 'purchase_order_already_cancelled', 'a purchase order is cancelled once');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"note":"x"}'),
    '55000', 'purchase_order_cancelled', 'a cancelled purchase order cannot be edited');
  perform pg_temp.check_raises_as(v_editor, format('select public.save_purchase_order_items(%L, %L)', v_po, v_items),
    '已取消', 'the items of a cancelled purchase order cannot be saved directly either');

  -- The order itself can now be cancelled
  perform pg_temp.call_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, v_order));
  perform pg_temp.check((select status from public.orders where id = v_order) = 'cancelled', 'an order whose purchase orders are all cancelled can be cancelled');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
