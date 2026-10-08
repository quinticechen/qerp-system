-- 業務 API A5：出貨單（docs/BUSINESS_API.md）。先載入 _helpers.sql 再執行本檔。
-- Fixture: order (product 1, 100kg) with one shipping of 40kg from a roll of 100kg (60kg left).

-- Add a roll of a product to the fixture's receiving batch (test setup)
create or replace function pg_temp.add_roll(fx jsonb, product uuid, weight numeric)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.inventory_rolls (inventory_id, product_id, warehouse_id, roll_number, quantity, current_quantity)
  values ((fx->>'inventory_id')::uuid, product, (fx->>'warehouse_id')::uuid, 'T-' || gen_random_uuid(), weight, weight)
  returning id into v_id;
  return v_id;
end $$;

-- create_shipping writes the shipping and its rolls, takes the stock and updates the order's progress
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_date text := to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD');
  v_roll uuid := (fx->>'roll_id')::uuid;
  v_second uuid;
  v_result jsonb;
  v_over jsonb;
  v_shipping public.shippings%rowtype;
begin
  v_second := pg_temp.add_roll(fx, (fx->>'product_id')::uuid, 100);

  v_result := pg_temp.call_as(v_editor, format('select public.create_shipping(%L, %L, %L, %L, %L)', v_org, fx->>'order_id',
    jsonb_build_array(jsonb_build_object('inventory_roll_id', v_roll, 'shipped_quantity', 30)), '2026-10-05', '第二批'));
  select * into v_shipping from public.shippings where id = (v_result->>'id')::uuid;

  -- seed_fixture already created today's first shipping for this organization
  perform pg_temp.check(v_result->>'number' = 'O' || v_date || '0002', 'the shipping is numbered O<date>, got ' || coalesce(v_result->>'number', 'none'));
  perform pg_temp.check(v_shipping.customer_id = (fx->>'customer_id')::uuid and v_shipping.user_id = v_editor and v_shipping.status = 'shipped'
    and v_shipping.shipping_date = '2026-10-05' and v_shipping.note = '第二批' and v_shipping.total_shipped_quantity = 30 and v_shipping.total_shipped_rolls = 1,
    'the shipping takes the order''s customer and records its totals');
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = v_roll) = 30, 'the stock is taken from the roll');
  perform pg_temp.check((select shipped_quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 70, 'the order line counts both shippings');
  perform pg_temp.check((select shipping_status from public.orders where id = (fx->>'order_id')::uuid) = 'partial_shipped', 'the order is partly shipped');

  perform pg_temp.check(v_result->'summary'->>'title' = '建立出貨單', 'the summary has a title');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '客戶', 'value', '測試客戶'),
      jsonb_build_object('label', '出貨日期', 'value', '2026-10-05'),
      jsonb_build_object('label', '產品 1', 'value', public.api_product_label((fx->>'product_id')::uuid) || ' × 1 卷，共 30 公斤'),
      jsonb_build_object('label', '合計', 'value', '1 卷，30 公斤')),
    'the summary describes the shipping, got ' || (v_result->'summary'->'fields')::text);

  v_over := pg_temp.call_as(v_editor, format('select public.create_shipping(%L, %L, %L)', v_org, fx->>'order_id',
    jsonb_build_array(jsonb_build_object('inventory_roll_id', v_second, 'shipped_quantity', 40))));
  perform pg_temp.check((select shipping_status from public.orders where id = (fx->>'order_id')::uuid) = 'shipped', 'the order is fully shipped');
  perform pg_temp.check(v_over->'summary'->'fields' @> jsonb_build_array(jsonb_build_object('label', '超過訂單量',
      'value', public.api_product_label((fx->>'product_id')::uuid) || ' 已出貨 110 公斤，訂購 100 公斤')),
    'shipping beyond the order is allowed and flagged, got ' || (v_over->'summary'->'fields')::text);
end $$;

-- A dry run takes no stock, stores nothing and shows the same summary
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_items jsonb := jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 10));
  v_shippings int;
  v_logs int;
  v_preview jsonb;
  v_real jsonb;
begin
  select count(*) into v_shippings from public.shippings where organization_id = v_org;
  select count(*) into v_logs from public.record_audit_logs where organization_id = v_org;

  v_preview := pg_temp.call_as(v_editor, format('select public.create_shipping(%L, %L, %L, p_dry_run => true)', v_org, fx->>'order_id', v_items));
  perform pg_temp.check((v_preview->>'dry_run')::boolean and v_preview->>'id' is null and v_preview->>'number' is null, 'a dry run has no id or number');
  perform pg_temp.check((select count(*) from public.shippings where organization_id = v_org) = v_shippings, 'a dry run stores no shipping');
  perform pg_temp.check((select count(*) from public.record_audit_logs where organization_id = v_org) = v_logs, 'a dry run leaves no audit trail');
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = (fx->>'roll_id')::uuid) = 60, 'a dry run takes no stock');
  perform pg_temp.check((select shipped_quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 40, 'a dry run leaves the order alone');

  v_real := pg_temp.call_as(v_editor, format('select public.create_shipping(%L, %L, %L)', v_org, fx->>'order_id', v_items));
  perform pg_temp.check(v_preview->'summary' = v_real->'summary', 'the dry run shows the same summary as the real call');
end $$;

-- create_shipping refuses bad input and needs canCreateShipping
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_good jsonb := jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 10));
  v_cancelled uuid;
  v_other_product_roll uuid;
  v_call text := 'select public.create_shipping(%L, %L, %L)';
begin
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'cancelled') returning id into v_cancelled;
  v_other_product_roll := pg_temp.add_roll(fx, (fx->>'product2_id')::uuid, 50);

  perform pg_temp.check_api_error_as(v_viewer, format(v_call, v_org, fx->>'order_id', v_good), '42501', 'forbidden', 'a viewer cannot ship');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, other->>'order_id', v_good), 'P0002', 'order_not_found',
    'another organization''s order is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, v_cancelled, v_good), '55000', 'order_cancelled', 'a cancelled order cannot be shipped');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'order_id', '[]'), '22023', 'items_required', 'a shipping needs a roll');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'order_id',
      jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 0))),
    '22023', 'invalid_quantity', 'the weight must be positive');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'order_id',
      jsonb_build_array(jsonb_build_object('inventory_roll_id', other->>'roll_id', 'shipped_quantity', 1))),
    'P0002', 'roll_not_found', 'another organization''s roll is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'order_id',
      jsonb_build_array(jsonb_build_object('inventory_roll_id', v_other_product_roll, 'shipped_quantity', 1))),
    '22023', 'roll_not_in_order', 'a roll of a product not on the order cannot be shipped for it');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'order_id',
      jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 61))),
    '55000', 'insufficient_stock', 'a roll cannot ship more than it holds');
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = (fx->>'roll_id')::uuid) = 60, 'a refused shipping takes no stock');
end $$;

-- update_shipping changes the date, note and rolls, moving only the difference in stock
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_number text := (select shipping_number from public.shippings where id = (fx->>'shipping_id')::uuid);
  v_changes jsonb;
  v_preview jsonb;
  v_result jsonb;
begin
  v_changes := jsonb_build_object('shipping_date', '2026-10-06', 'note', '改重',
    'items', jsonb_build_array(jsonb_build_object('id', fx->>'shipping_item_id', 'inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 50)));

  v_preview := pg_temp.call_as(v_editor, format('select public.update_shipping(%L, %L, %L, true)', v_org, fx->>'shipping_id', v_changes));
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = (fx->>'roll_id')::uuid) = 60, 'a dry run moves no stock');

  v_result := pg_temp.call_as(v_editor, format('select public.update_shipping(%L, %L, %L)', v_org, fx->>'shipping_id', v_changes));
  perform pg_temp.check(v_preview->'summary' = v_result->'summary', 'the dry run shows the same summary');
  perform pg_temp.check(v_result->'summary'->>'title' = '修改出貨單 ' || v_number and v_result->>'number' = v_number, 'the summary names the shipping');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '備註', 'value', '（空白） → 改重'),
      jsonb_build_object('label', '修改布卷', 'value',
        public.api_shipped_roll_label((fx->>'roll_id')::uuid, 40) || ' → ' || public.api_shipped_roll_label((fx->>'roll_id')::uuid, 50))),
    'the summary lists the changes, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = (fx->>'roll_id')::uuid) = 50, 'only the extra 10kg is taken');
  perform pg_temp.check((select shipping_date = '2026-10-06' and total_shipped_quantity = 50 from public.shippings where id = (fx->>'shipping_id')::uuid),
    'the shipping is updated with its new total');
  perform pg_temp.check((select shipped_quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 50, 'the order line follows');

  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_shipping(%L, %L, %L)', v_org, fx->>'shipping_id', '{"note":"x"}'),
    '42501', 'forbidden', 'a viewer cannot edit shippings');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_shipping(%L, %L, %L)', v_org, fx->>'shipping_id', '{"order_id":"x"}'),
    '22023', 'unknown_field', 'the order of a shipping cannot be changed');
end $$;

-- cancel_shipping puts the stock back and recalculates the order; a cancelled shipping is frozen
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_shipping uuid := (fx->>'shipping_id')::uuid;
  v_result jsonb;
begin
  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, fx->>'order_id'),
    '55000', 'order_has_shipments', 'an order with a live shipping cannot be cancelled');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.cancel_shipping(%L, %L)', v_org, v_shipping), '42501', 'forbidden', 'a viewer cannot cancel');

  v_result := pg_temp.call_as(v_editor, format('select public.cancel_shipping(%L, %L, %L, true)', v_org, v_shipping, '客戶退回'));
  perform pg_temp.check((select status from public.shippings where id = v_shipping) = 'shipped', 'a dry run cancels nothing');
  perform pg_temp.check(v_result->'summary'->'fields' = jsonb_build_array(
      jsonb_build_object('label', '狀態', 'value', '已出貨 → 已取消'),
      jsonb_build_object('label', '歸還庫存', 'value', '1 卷，40 公斤'),
      jsonb_build_object('label', '取消原因', 'value', '客戶退回')),
    'the summary shows the cancellation and the stock returned, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.call_as(v_editor, format('select public.cancel_shipping(%L, %L, %L)', v_org, v_shipping, '客戶退回'));
  perform pg_temp.check((select status = 'cancelled' and cancelled_at is not null and cancel_reason = '客戶退回' from public.shippings where id = v_shipping),
    'the shipping is cancelled with its reason');
  perform pg_temp.check((select current_quantity = 100 and not is_allocated from public.inventory_rolls where id = (fx->>'roll_id')::uuid), 'the stock is back on the roll');
  perform pg_temp.check((select shipped_quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 0, 'the order line no longer counts it');
  perform pg_temp.check((select shipping_status from public.orders where id = (fx->>'order_id')::uuid) = 'not_started', 'the order is back to not shipped');
  perform pg_temp.check(exists (select 1 from public.shipping_items where shipping_id = v_shipping), 'the shipped rolls stay on record');

  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_shipping(%L, %L)', v_org, v_shipping),
    '55000', 'shipping_already_cancelled', 'a shipping is cancelled once');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_shipping(%L, %L, %L)', v_org, v_shipping, '{"note":"x"}'),
    '55000', 'shipping_cancelled', 'a cancelled shipping cannot be edited');
  perform pg_temp.check_raises_as(v_editor, format('select public.save_shipping_items(%L, %L)', v_shipping,
      jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 1))),
    '已取消', 'the items of a cancelled shipping cannot be saved directly either');

  -- With its only shipping cancelled, the order is now held back only by its purchase order
  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, fx->>'order_id'),
    '55000', 'order_has_purchase_orders', 'a cancelled shipping no longer blocks cancelling the order');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
