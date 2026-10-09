-- 業務 API A6：貨架（docs/API.md）。先載入 _helpers.sql 再執行本檔。
-- Fixture: one shelf (測試倉) holding one roll with 60kg left.

-- create_shelf and update_shelf: names are unique within the organization
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_result jsonb;
  v_preview jsonb;
  v_shelf uuid;
begin
  v_preview := pg_temp.call_as(v_editor, format('select public.create_shelf(%L, %L, %L, true)', v_org, ' 1A 上 ', '一樓'));
  perform pg_temp.check(not exists (select 1 from public.warehouses where organization_id = v_org and name = '1A 上'), 'a dry run stores no shelf');

  v_result := pg_temp.call_as(v_editor, format('select public.create_shelf(%L, %L, %L)', v_org, ' 1A 上 ', '一樓'));
  v_shelf := (v_result->>'id')::uuid;
  perform pg_temp.check(v_preview->'summary' = v_result->'summary', 'the dry run shows the same summary');
  perform pg_temp.check((select name = '1A 上' and location = '一樓' and is_active from public.warehouses where id = v_shelf), 'the shelf is stored, trimmed and active');
  perform pg_temp.check(v_result->'summary' = jsonb_build_object('title', '建立貨架', 'fields', jsonb_build_array(
      jsonb_build_object('label', '貨架名稱', 'value', '1A 上'), jsonb_build_object('label', '位置', 'value', '一樓'))),
    'the summary shows the shelf, got ' || (v_result->'summary')::text);

  perform pg_temp.check_api_error_as(v_viewer, format('select public.create_shelf(%L, %L)', v_org, '2B'), '42501', 'forbidden', 'a viewer cannot create shelves');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_shelf(%L, %L)', v_org, ' '), '22023', 'name_required', 'a shelf needs a name');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_shelf(%L, %L)', v_org, '1a 上'), '23505', 'shelf_name_taken', 'shelf names are unique');
  -- The same name in another organization is fine
  perform pg_temp.call_as((other->>'user_id')::uuid, format('select public.create_shelf(%L, %L)', other->>'org_id', '1A 上'));

  v_result := pg_temp.call_as(v_editor, format('select public.update_shelf(%L, %L, %L)', v_org, v_shelf, '{"name":"1A 下","location":""}'));
  perform pg_temp.check(v_result->'summary'->>'title' = '修改貨架「1A 上」', 'the summary names the shelf');
  perform pg_temp.check(v_result->'summary'->'fields' = jsonb_build_array(
      jsonb_build_object('label', '貨架名稱', 'value', '1A 上 → 1A 下'), jsonb_build_object('label', '位置', 'value', '一樓 → （空白）')),
    'the summary lists the changes, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check((select name = '1A 下' and location is null from public.warehouses where id = v_shelf), 'the shelf is renamed and its location cleared');

  perform pg_temp.check_api_error_as(v_editor, format('select public.update_shelf(%L, %L, %L)', v_org, v_shelf, '{"name":"測試倉"}'),
    '23505', 'shelf_name_taken', 'a shelf cannot take another shelf''s name');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_shelf(%L, %L, %L)', v_org, v_shelf, '{"name":"x"}'),
    '42501', 'forbidden', 'a viewer cannot rename shelves');
  perform pg_temp.check_api_error_as((other->>'user_id')::uuid, format('select public.update_shelf(%L, %L, %L)', other->>'org_id', v_shelf, '{"name":"x"}'),
    'P0002', 'shelf_not_found', 'another organization''s shelf is not found');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_shelf(%L, %L, %L)', v_org, v_shelf, '{"is_active":false}'),
    '22023', 'unknown_field', 'disabling goes through set_shelf_active');
end $$;

-- A disabled shelf keeps its rolls but gets no new ones
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_shelf uuid := (fx->>'warehouse_id')::uuid;
  v_spare uuid;
  v_result jsonb;
  v_roll public.inventory_rolls%rowtype;
begin
  select * into v_roll from public.inventory_rolls where id = (fx->>'roll_id')::uuid;
  insert into public.warehouses (name, organization_id) values ('備用倉', v_org) returning id into v_spare;

  v_result := pg_temp.call_as(v_editor, format('select public.set_shelf_active(%L, %L, false)', v_org, v_shelf));
  perform pg_temp.check(v_result->'summary'->'fields' = jsonb_build_array(
      jsonb_build_object('label', '狀態', 'value', '啟用 → 停用'), jsonb_build_object('label', '仍有庫存', 'value', '1 卷，60 公斤')),
    'disabling warns about the stock still on the shelf, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check(not (select is_active from public.warehouses where id = v_shelf), 'the shelf is disabled');

  perform pg_temp.check_api_error_as(v_editor, format('select public.receive_inventory(%L, %L, %L)', v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 5, 'warehouse_id', v_shelf))),
    '22023', 'warehouse_inactive', 'new rolls cannot go on a disabled shelf');

  -- The roll already on it can be edited in place, but not moved back onto it once moved away
  perform pg_temp.call_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, '{"shelf":"B-01"}'));
  perform pg_temp.check((select shelf from public.inventory_rolls where id = v_roll.id) = 'B-01', 'a roll on a disabled shelf can still be edited');
  perform pg_temp.call_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, jsonb_build_object('warehouse_id', v_spare)));
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, jsonb_build_object('warehouse_id', v_shelf)),
    '22023', 'warehouse_inactive', 'a roll cannot be moved onto a disabled shelf');

  perform pg_temp.call_as(v_editor, format('select public.set_shelf_active(%L, %L, true)', v_org, v_shelf));
  perform pg_temp.call_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, jsonb_build_object('warehouse_id', v_shelf)));
  perform pg_temp.check((select warehouse_id from public.inventory_rolls where id = v_roll.id) = v_shelf, 'an enabled shelf takes rolls again');

  perform pg_temp.check_api_error_as(v_editor, format('select public.set_shelf_active(%L, %L, null)', v_org, v_shelf),
    '22023', 'is_active_required', 'enable or disable must be stated');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
