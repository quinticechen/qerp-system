-- 業務 API A4：入庫（進貨單）（docs/API.md）。先載入 _helpers.sql 再執行本檔。
-- Fixture: purchase order (product 1, 100kg ordered, fully received) with one receiving batch holding one roll
-- (100kg received, 40kg shipped); product 2 is not on the purchase order.

-- receive_inventory writes the batch and its rolls, numbers both and updates the purchase order's progress
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_date text := to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD');
  v_po uuid;
  v_rolls jsonb;
  v_result jsonb;
  v_inventory public.inventories%rowtype;
begin
  v_po := (pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L)', v_org, fx->>'factory_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 100, 'unit_price', 5),
                      jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 50, 'unit_price', 5))))->>'id')::uuid;

  v_rolls := jsonb_build_array(
    jsonb_build_object('product_id', fx->>'product_id', 'quantity', 40, 'warehouse_id', fx->>'warehouse_id', 'shelf', ' B-03 '),
    jsonb_build_object('product_id', fx->>'product_id', 'quantity', 35.5, 'warehouse_id', fx->>'warehouse_id', 'quality', 'B'),
    jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 60, 'warehouse_id', fx->>'warehouse_id', 'roll_number', 'MY-ROLL-' || v_org));

  v_result := pg_temp.call_as(v_editor, format('select public.receive_inventory(%L, %L, %L, %L, %L)', v_org, v_po, v_rolls, '2026-10-01', '第一批'));
  select * into v_inventory from public.inventories where id = (v_result->>'id')::uuid;

  -- seed_fixture already created today's first receiving batch for this organization
  perform pg_temp.check(v_result->>'number' = 'I' || v_date || '0002', 'the batch is numbered I<date>, got ' || coalesce(v_result->>'number', 'none'));
  perform pg_temp.check(v_inventory.receipt_number = v_result->>'number' and v_inventory.purchase_order_id = v_po
    and v_inventory.factory_id = (fx->>'factory_id')::uuid and v_inventory.user_id = v_editor and v_inventory.arrival_date = '2026-10-01'
    and v_inventory.note = '第一批', 'the batch keeps the purchase order''s factory, its date and note');
  perform pg_temp.check((select count(*) from public.inventory_rolls where inventory_id = v_inventory.id) = 3, 'all rolls are stored');
  perform pg_temp.check(exists (select 1 from public.inventory_rolls where inventory_id = v_inventory.id and quantity = 40 and current_quantity = 40
      and quality = 'A' and shelf = 'B-03' and roll_number ~ '^R\d{15}$'), 'a roll without a number gets one, with grade A and a trimmed shelf');
  perform pg_temp.check(exists (select 1 from public.inventory_rolls where inventory_id = v_inventory.id and roll_number = 'MY-ROLL-' || v_org),
    'a roll number given by the caller is kept');

  perform pg_temp.check((select received_quantity from public.purchase_order_items where purchase_order_id = v_po and product_id = (fx->>'product_id')::uuid) = 75.5,
    'the purchase order item counts what was received');
  perform pg_temp.check((select status from public.purchase_orders where id = v_po) = 'partial_received', 'the purchase order is partly received');

  perform pg_temp.check(v_result->'summary'->>'title' = '入庫', 'the summary has a title');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '工廠', 'value', '測試工廠'),
      jsonb_build_object('label', '到貨日期', 'value', '2026-10-01'),
      jsonb_build_object('label', '產品 1', 'value', public.api_product_label((fx->>'product_id')::uuid) || ' × 2 卷，共 75.5 公斤'),
      jsonb_build_object('label', '產品 2', 'value', public.api_product_label((fx->>'product2_id')::uuid) || ' × 1 卷，共 60 公斤'),
      jsonb_build_object('label', '合計', 'value', '3 卷，135.5 公斤'),
      jsonb_build_object('label', '超過採購量', 'value', public.api_product_label((fx->>'product2_id')::uuid) || ' 已入庫 60 公斤，採購 50 公斤')),
    'the summary describes the batch and flags over-receipt, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.check((pg_temp.call_as((other->>'user_id')::uuid, format('select public.receive_inventory(%L, %L, %L)', other->>'org_id', other->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'quantity', 1, 'warehouse_id', other->>'warehouse_id')))))->>'number'
    = 'I' || v_date || '0002', 'another organization counts its own numbers');
end $$;

-- A dry run stores nothing, leaves the purchase order alone and shows the same summary
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_rolls jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'warehouse_id', fx->>'warehouse_id', 'roll_number', 'DRY-1'));
  v_batches int;
  v_logs int;
  v_received numeric;
  v_preview jsonb;
  v_real jsonb;
begin
  select count(*) into v_batches from public.inventories where organization_id = v_org;
  select count(*) into v_logs from public.record_audit_logs where organization_id = v_org;
  select received_quantity into v_received from public.purchase_order_items where id = (fx->>'po_item_id')::uuid;

  v_preview := pg_temp.call_as(v_editor, format('select public.receive_inventory(%L, %L, %L, p_dry_run => true)', v_org, fx->>'po_id', v_rolls));
  perform pg_temp.check((v_preview->>'dry_run')::boolean and v_preview->>'id' is null and v_preview->>'number' is null, 'a dry run has no id or number');
  perform pg_temp.check((select count(*) from public.inventories where organization_id = v_org) = v_batches, 'a dry run stores no batch');
  perform pg_temp.check((select count(*) from public.record_audit_logs where organization_id = v_org) = v_logs, 'a dry run leaves no audit trail');
  perform pg_temp.check((select received_quantity from public.purchase_order_items where id = (fx->>'po_item_id')::uuid) = v_received,
    'a dry run leaves the purchase order''s progress alone');

  v_real := pg_temp.call_as(v_editor, format('select public.receive_inventory(%L, %L, %L)', v_org, fx->>'po_id', v_rolls));
  perform pg_temp.check(v_preview->'summary' = v_real->'summary', 'the dry run shows the same summary as the real call');
end $$;

-- receive_inventory refuses bad input and needs canCreateInventory
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_good jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'warehouse_id', fx->>'warehouse_id'));
  v_po uuid;
  v_call text := 'select public.receive_inventory(%L, %L, %L)';
begin
  perform pg_temp.check_api_error_as(v_viewer, format(v_call, v_org, fx->>'po_id', v_good), '42501', 'forbidden', 'a viewer cannot receive goods');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, other->>'po_id', v_good), 'P0002', 'purchase_order_not_found',
    'another organization''s purchase order is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id', '[]'), '22023', 'rolls_required', 'a batch needs a roll');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 10, 'warehouse_id', fx->>'warehouse_id'))),
    '22023', 'product_not_on_purchase_order', 'only products on the purchase order can be received');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'quantity', 10, 'warehouse_id', fx->>'warehouse_id'))),
    'P0002', 'product_not_found', 'another organization''s product is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'warehouse_id', other->>'warehouse_id'))),
    'P0002', 'warehouse_not_found', 'another organization''s warehouse is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 0, 'warehouse_id', fx->>'warehouse_id'))),
    '22023', 'invalid_quantity', 'a roll must weigh something');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 1, 'warehouse_id', fx->>'warehouse_id',
        'roll_number', (select roll_number from public.inventory_rolls where id = (fx->>'roll_id')::uuid)))),
    '23505', 'roll_number_taken', 'roll numbers are unique');

  v_po := (pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L)', v_org, fx->>'factory_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 10, 'unit_price', 5))))->>'id')::uuid;
  perform pg_temp.call_as(v_editor, format('select public.cancel_purchase_order(%L, %L)', v_org, v_po));
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, v_po, v_good), '55000', 'purchase_order_cancelled',
    'a cancelled purchase order cannot be received');
end $$;

-- update_inventory changes the date, note and rolls; shipped rolls keep their lock rules
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_inventory uuid := (fx->>'inventory_id')::uuid;
  v_receipt text := (select receipt_number from public.inventories where id = (fx->>'inventory_id')::uuid);
  v_roll public.inventory_rolls%rowtype;
  v_changes jsonb;
  v_preview jsonb;
  v_result jsonb;
begin
  select * into v_roll from public.inventory_rolls where id = (fx->>'roll_id')::uuid;
  v_changes := jsonb_build_object(
    'arrival_date', '2026-10-02',
    'note', '補登',
    'rolls', jsonb_build_array(
      jsonb_build_object('id', v_roll.id, 'product_id', v_roll.product_id, 'quantity', 110, 'warehouse_id', v_roll.warehouse_id, 'quality', 'B'),
      jsonb_build_object('product_id', fx->>'product_id', 'quantity', 20, 'warehouse_id', fx->>'warehouse_id', 'roll_number', 'ADD-' || v_org)));

  v_preview := pg_temp.call_as(v_editor, format('select public.update_inventory(%L, %L, %L, true)', v_org, v_inventory, v_changes));
  perform pg_temp.check((select quantity from public.inventory_rolls where id = v_roll.id) = 100, 'a dry run changes nothing');

  v_result := pg_temp.call_as(v_editor, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory, v_changes));
  perform pg_temp.check(v_preview->'summary' = v_result->'summary', 'the dry run shows the same summary');
  perform pg_temp.check(v_result->'summary'->>'title' = '修改進貨單 ' || v_receipt and v_result->>'number' = v_receipt, 'the summary names the batch');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '備註', 'value', '（空白） → 補登'),
      jsonb_build_object('label', '修改布卷', 'value',
        public.api_roll_label(v_roll.roll_number, v_roll.product_id, 100, 'A', v_roll.warehouse_id, null) || ' → '
        || public.api_roll_label(v_roll.roll_number, v_roll.product_id, 110, 'B', v_roll.warehouse_id, null)),
      jsonb_build_object('label', '新增布卷', 'value', public.api_roll_label('ADD-' || v_org, (fx->>'product_id')::uuid, 20, 'A', (fx->>'warehouse_id')::uuid, null))),
    'the summary lists the changes, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check((select quantity = 110 and current_quantity = 70 and quality = 'B' from public.inventory_rolls where id = v_roll.id),
    'the roll keeps its shipped weight when its received weight changes');
  perform pg_temp.check((select arrival_date = '2026-10-02' and note = '補登' from public.inventories where id = v_inventory), 'the batch is updated');

  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory, '{"note":"x"}'),
    '42501', 'forbidden', 'a viewer cannot edit batches');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory, '{"factory_id":"x"}'),
    '22023', 'unknown_field', 'the factory follows the purchase order');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory,
      jsonb_build_object('rolls', jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 1, 'warehouse_id', fx->>'warehouse_id')))),
    '55000', 'roll_shipped', 'a shipped roll cannot be removed');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory,
      jsonb_build_object('rolls', jsonb_build_array(jsonb_build_object('id', v_roll.id, 'product_id', v_roll.product_id, 'quantity', 30, 'warehouse_id', v_roll.warehouse_id)))),
    '55000', 'quantity_below_shipped', 'a roll cannot weigh less than what was shipped from it');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory,
      jsonb_build_object('rolls', jsonb_build_array(
        jsonb_build_object('id', v_roll.id, 'product_id', v_roll.product_id, 'quantity', 110, 'warehouse_id', v_roll.warehouse_id),
        jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 1, 'warehouse_id', fx->>'warehouse_id')))),
    '22023', 'product_not_on_purchase_order', 'an added roll must be for a product on the purchase order');
end $$;

-- update_inventory_roll changes one roll and shows it on the card
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_roll public.inventory_rolls%rowtype;
  v_shelf uuid;
  v_result jsonb;
begin
  select * into v_roll from public.inventory_rolls where id = (fx->>'roll_id')::uuid;
  insert into public.warehouses (name, organization_id) values ('二號倉', v_org) returning id into v_shelf;

  v_result := pg_temp.call_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id,
    jsonb_build_object('warehouse_id', v_shelf, 'shelf', 'C-01', 'quality', 'C')));
  perform pg_temp.check((select warehouse_id = v_shelf and shelf = 'C-01' and quality = 'C' and quantity = 100 and current_quantity = 60
      from public.inventory_rolls where id = v_roll.id), 'the roll moves and is regraded, its weights unchanged');
  perform pg_temp.check(v_result->>'number' = v_roll.roll_number and v_result->'summary'->>'title' = '修改布卷 ' || v_roll.roll_number, 'the card names the roll');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(jsonb_build_object('label', '修改布卷', 'value',
      public.api_roll_label(v_roll.roll_number, v_roll.product_id, 100, 'A', v_roll.warehouse_id, null) || ' → '
      || public.api_roll_label(v_roll.roll_number, v_roll.product_id, 100, 'C', v_shelf, 'C-01'))),
    'the card shows the roll before and after, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check(public.api_roll_label(v_roll.roll_number, v_roll.product_id, 100, 'C', v_shelf, 'C-01') like '%（C 級，倉庫 二號倉 C-01）',
    'the roll label shows grade, warehouse and shelf');

  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, '{"shelf":"x"}'),
    '42501', 'forbidden', 'a viewer cannot edit rolls');
  perform pg_temp.check_api_error_as((other->>'user_id')::uuid, format('select public.update_inventory_roll(%L, %L, %L)', other->>'org_id', v_roll.id, '{"shelf":"x"}'),
    'P0002', 'roll_not_found', 'another organization''s roll is not found');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, '{"quantity":10}'),
    '55000', 'quantity_below_shipped', 'a roll cannot weigh less than what was shipped');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, '{"quality":"E"}'),
    '22023', 'invalid_quality', 'grades are A, B, C, D or defective');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, '{"product_id":"x"}'),
    '22023', 'unknown_field', 'a single roll''s product is not changed here');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
