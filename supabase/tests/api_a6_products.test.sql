-- 業務 API A6：產品（母）與顏色（子）（docs/BUSINESS_API.md §7）。先載入 _helpers.sql 再執行本檔。

-- Products written without a product (legacy pages, tools, the fixture) are filed under a product of the same name
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_user uuid := (fx->>'user_id')::uuid;
  v_color public.products_new%rowtype;
  v_group public.product_groups%rowtype;
  v_again uuid;
begin
  select * into v_color from public.products_new where id = (fx->>'product_id')::uuid;
  select * into v_group from public.product_groups where id = v_color.group_id;
  perform pg_temp.check(v_group.organization_id = v_org and v_group.name = v_color.name, 'a product inserted by name gets a product of that name');

  insert into public.products_new (name, color, user_id, organization_id)
  values ('  ' || upper(v_group.name) || ' ', '紅', v_user, v_org) returning group_id into v_again;
  perform pg_temp.check(v_again = v_group.id, 'a second color with the same name (any case or spacing) joins the same product');
  perform pg_temp.check((select name from public.products_new where group_id = v_group.id and color = '紅') = v_group.name,
    'the color takes the product''s spelling of the name');

  perform pg_temp.check(not exists (select 1 from public.products_new where group_id is null), 'every color belongs to a product');
  perform pg_temp.check(not exists (
      select 1 from public.products_new p join public.product_groups g on g.id = p.group_id
      where p.name <> g.name or p.category <> g.category or p.unit_of_measure <> g.unit_of_measure),
    'every color carries its product''s name, category and unit');
end $$;

-- create_product creates the product and its colors, and summarizes them
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_colors jsonb := jsonb_build_array(
    jsonb_build_object('color', '米白', 'color_code', 'W01', 'color_hex', '#F5F0E6', 'stock_threshold', 50),
    jsonb_build_object('color', ' 深藍 '));
  v_result jsonb;
  v_group public.product_groups%rowtype;
begin
  v_result := pg_temp.call_as(v_editor, format('select public.create_product(%L, %L, %L, %L)', v_org, ' 天絲棉 ', v_colors, '胚布'));
  select * into v_group from public.product_groups where id = (v_result->>'id')::uuid;

  perform pg_temp.check(v_group.name = '天絲棉' and v_group.category = '胚布' and v_group.unit_of_measure = 'KG' and v_group.is_active
    and v_group.created_by = v_editor and v_group.organization_id = v_org, 'the product is stored, trimmed, with its creator');
  perform pg_temp.check((select count(*) from public.products_new where group_id = v_group.id) = 2, 'both colors are stored');
  perform pg_temp.check(exists (
      select 1 from public.products_new where group_id = v_group.id and color = '米白' and color_code = 'W01' and color_hex = '#F5F0E6'
        and stock_thresholds = 50 and status = 'Available' and name = '天絲棉' and category = '胚布' and user_id = v_editor),
    'a color keeps its code, hex, threshold and the product''s name and category');
  perform pg_temp.check(exists (select 1 from public.products_new where group_id = v_group.id and color = '深藍' and color_code is null),
    'a color is trimmed and its optional fields stay empty');

  perform pg_temp.check(v_result->'summary'->>'title' = '建立產品', 'the summary has a title');
  perform pg_temp.check(v_result->'summary'->'fields' = jsonb_build_array(
      jsonb_build_object('label', '產品名稱', 'value', '天絲棉'),
      jsonb_build_object('label', '類別', 'value', '胚布'),
      jsonb_build_object('label', '單位', 'value', 'KG'),
      jsonb_build_object('label', '顏色 1', 'value', '米白（色號 W01），安全庫存 50 公斤'),
      jsonb_build_object('label', '顏色 2', 'value', '深藍')),
    'the summary lists the product and its colors in order, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.check(exists (select 1 from public.record_audit_logs where table_name = 'product_groups' and record_id = v_group.id and action = 'INSERT'),
    'creating a product is in the product''s history');
end $$;

-- A dry run of create_product stores nothing and shows the same summary
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_colors jsonb := jsonb_build_array(jsonb_build_object('color', '黑', 'stock_threshold', 10));
  v_groups int;
  v_logs int;
  v_preview jsonb;
  v_real jsonb;
begin
  select count(*) into v_groups from public.product_groups where organization_id = v_org;
  select count(*) into v_logs from public.record_audit_logs where organization_id = v_org;

  v_preview := pg_temp.call_as(v_editor, format('select public.create_product(%L, %L, %L, p_dry_run => true)', v_org, '試算布', v_colors));
  perform pg_temp.check((v_preview->>'dry_run')::boolean and v_preview->>'id' is null, 'a dry run has no id');
  perform pg_temp.check((select count(*) from public.product_groups where organization_id = v_org) = v_groups, 'a dry run stores no product');
  perform pg_temp.check((select count(*) from public.record_audit_logs where organization_id = v_org) = v_logs, 'a dry run leaves no audit trail');

  v_real := pg_temp.call_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, '試算布', v_colors));
  perform pg_temp.check(v_preview->'summary' = v_real->'summary', 'the dry run shows the same summary as the real call');
end $$;

-- create_product refuses bad input, taken names and duplicate colors, and needs canCreateProducts
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_one jsonb := jsonb_build_array(jsonb_build_object('color', '白'));
  v_taken text;
begin
  select name into v_taken from public.product_groups where id = (select group_id from public.products_new where id = (fx->>'product_id')::uuid);

  perform pg_temp.check_api_error_as(v_viewer, format('select public.create_product(%L, %L, %L)', v_org, '新布', v_one),
    '42501', 'forbidden', 'a viewer cannot create products');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_product(%L, %L, %L)', other->>'org_id', '新布', v_one),
    '42501', 'forbidden', 'nobody can create products in another organization');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, '  ', v_one),
    '22023', 'name_required', 'a product needs a name');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, '新布', '[]'),
    '22023', 'colors_required', 'a product needs at least one color');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, '新布', '[{"color":" "}]'),
    '22023', 'color_required', 'every color needs a name');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, '新布', '[{"color":"白","color_hex":"white"}]'),
    '22023', 'invalid_color_hex', 'a color value must be #RRGGBB');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, '新布', '[{"color":"白","stock_threshold":-1}]'),
    '22023', 'invalid_stock_threshold', 'a threshold cannot be negative');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, '新布',
      '[{"color":"白","color_code":"A1"},{"color":" 白","color_code":"a1"}]'),
    '23505', 'product_color_taken', 'the same color and code cannot appear twice');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, upper(v_taken), v_one),
    '23505', 'product_name_taken', 'a product name is unique within the organization');

  -- The same name in another organization is fine, as are the same color with different codes (B5)
  perform pg_temp.call_as((other->>'user_id')::uuid, format('select public.create_product(%L, %L, %L)', other->>'org_id', v_taken, v_one));
  perform pg_temp.call_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, '新布',
    '[{"color":"白","color_code":"A1"},{"color":"白","color_code":"A2"},{"color":"白"}]'));
  perform pg_temp.check((select count(*) from public.products_new p join public.product_groups g on g.id = p.group_id
      where g.organization_id = v_org and g.name = '新布') = 3, 'one color can come in several codes');
end $$;

-- update_product renames the product for all its colors; the edit is in the product's history
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_product uuid;
  v_other_name text;
  v_preview jsonb;
  v_result jsonb;
begin
  v_product := (pg_temp.call_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, '府綢',
    '[{"color":"白"},{"color":"黑"}]'))->>'id')::uuid;
  select name into v_other_name from public.products_new where id = (fx->>'product_id')::uuid;

  v_preview := pg_temp.call_as(v_editor, format('select public.update_product(%L, %L, %L, true)', v_org, v_product, '{"name":"精梳府綢","unit_of_measure":"碼"}'));
  perform pg_temp.check((select name from public.product_groups where id = v_product) = '府綢', 'a dry run changes nothing');

  v_result := pg_temp.call_as(v_editor, format('select public.update_product(%L, %L, %L)', v_org, v_product, '{"name":"精梳府綢","unit_of_measure":"碼"}'));
  perform pg_temp.check(v_preview->'summary' = v_result->'summary', 'the dry run shows the same summary');
  perform pg_temp.check(v_result->'summary'->>'title' = '修改產品「府綢」', 'the summary names the product, got ' || (v_result->'summary'->>'title'));
  perform pg_temp.check(v_result->'summary'->'fields' = jsonb_build_array(
      jsonb_build_object('label', '產品名稱', 'value', '府綢 → 精梳府綢'),
      jsonb_build_object('label', '單位', 'value', 'KG → 碼')),
    'the summary lists only the changed fields, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check(not exists (select 1 from public.products_new where group_id = v_product and (name <> '精梳府綢' or unit_of_measure <> '碼')),
    'every color follows the product');

  perform pg_temp.check(exists (select 1 from public.record_audit_logs where table_name = 'product_groups' and record_id = v_product
      and action = 'UPDATE' and changed_fields @> array['name', 'unit_of_measure']), 'the edit is in the product''s history');
  perform pg_temp.check(not exists (select 1 from public.record_audit_logs l join public.products_new p on p.id = l.record_id
      where l.table_name = 'products_new' and p.group_id = v_product and l.action = 'UPDATE'),
    'the colors'' histories do not repeat the product''s edit');

  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_product(%L, %L, %L)', v_org, v_product, '{"name":"x"}'),
    '42501', 'forbidden', 'a viewer cannot edit products');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_product(%L, %L, %L)', v_org, v_product, format('{"name":%s}', to_jsonb(v_other_name))),
    '23505', 'product_name_taken', 'a product cannot take another product''s name');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_product(%L, %L, %L)', v_org, v_product, '{"color":"紅"}'),
    '22023', 'unknown_field', 'colors are edited on the color, not the product');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_product(%L, %L, %L)', v_org, (fx->>'product_id')::uuid, '{"name":"x"}'),
    'P0002', 'product_not_found', 'a color id is not a product id');

  -- Renaming to the same name with another case is allowed
  perform pg_temp.call_as(v_editor, format('select public.update_product(%L, %L, %L)', v_org, v_product, '{"name":"精梳府綢 "}'));
end $$;

-- Colors: add, edit and disable each have their own history; they are checked against the product's other colors
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_product uuid;
  v_white uuid;
  v_red uuid;
  v_result jsonb;
begin
  v_product := (pg_temp.call_as(v_editor, format('select public.create_product(%L, %L, %L)', v_org, '帆布', '[{"color":"白","color_code":"C1"}]'))->>'id')::uuid;
  select id into v_white from public.products_new where group_id = v_product;

  v_result := pg_temp.call_as(v_editor, format('select public.add_product_color(%L, %L, %L, %L, %L, %s)', v_org, v_product, '紅', 'R1', '#C0392B', 20));
  v_red := (v_result->>'id')::uuid;
  perform pg_temp.check(v_result->'summary'->>'title' = '新增顏色到「帆布」', 'the summary names the product');
  perform pg_temp.check(exists (select 1 from public.products_new where id = v_red and group_id = v_product and name = '帆布'
      and color = '紅' and color_code = 'R1' and color_hex = '#C0392B' and stock_thresholds = 20 and status = 'Available'),
    'the color is added to the product');
  perform pg_temp.check_api_error_as(v_editor, format('select public.add_product_color(%L, %L, %L, %L)', v_org, v_product, '白', 'c1'),
    '23505', 'product_color_taken', 'a color and code already on the product cannot be added again');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.add_product_color(%L, %L, %L)', v_org, v_product, '綠'),
    '42501', 'forbidden', 'a viewer cannot add colors');
  perform pg_temp.check_api_error_as((other->>'user_id')::uuid, format('select public.add_product_color(%L, %L, %L)', other->>'org_id', v_product, '綠'),
    'P0002', 'product_not_found', 'a product in another organization is not found');

  v_result := pg_temp.call_as(v_editor, format('select public.update_product_color(%L, %L, %L)', v_org, v_red, '{"color_code":"R2","stock_threshold":null}'));
  perform pg_temp.check(v_result->'summary'->'fields' = jsonb_build_array(
      jsonb_build_object('label', '色號', 'value', 'R1 → R2'),
      jsonb_build_object('label', '安全庫存', 'value', '20 公斤 → （空白）')),
    'the summary lists the changed color fields, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check((select color_code = 'R2' and stock_thresholds is null from public.products_new where id = v_red), 'the color is updated');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_product_color(%L, %L, %L)', v_org, v_red, '{"color":"白","color_code":"C1"}'),
    '23505', 'product_color_taken', 'a color cannot become another color of the same product');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_product_color(%L, %L, %L)', v_org, v_red, '{"name":"x"}'),
    '22023', 'unknown_field', 'the product name is edited on the product');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_product_color(%L, %L, %L)', v_org, v_product, '{"color":"x"}'),
    'P0002', 'product_color_not_found', 'a product id is not a color id');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_product_color(%L, %L, %L)', v_org, v_red, '{"color":"x"}'),
    '42501', 'forbidden', 'a viewer cannot edit colors');

  perform pg_temp.call_as(v_editor, format('select public.set_product_color_active(%L, %L, false)', v_org, v_red));
  perform pg_temp.check((select status from public.products_new where id = v_red) = 'Unavailable', 'a disabled color is unavailable');
  perform pg_temp.call_as(v_editor, format('select public.set_product_color_active(%L, %L, true)', v_org, v_red));
  perform pg_temp.check((select status from public.products_new where id = v_red) = 'Available', 'a color can be enabled again');

  perform pg_temp.check((select count(*) from public.record_audit_logs where table_name = 'products_new' and record_id = v_red) = 4,
    'the color''s history has its creation, edit, disabling and enabling');
  perform pg_temp.check(not exists (select 1 from public.record_audit_logs where table_name = 'product_groups' and record_id = v_product and action = 'UPDATE'),
    'editing a color leaves the product''s history alone');
end $$;

-- Disabling a product: existing order lines keep it, new lines cannot use any of its colors
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_group uuid := (select group_id from public.products_new where id = (fx->>'product_id')::uuid);
  v_line uuid := (select id from public.order_products where order_id = (fx->>'order_id')::uuid limit 1);
  v_result jsonb;
begin
  v_result := pg_temp.call_as(v_owner, format('select public.set_product_active(%L, %L, false)', v_org, v_group));
  perform pg_temp.check(v_result->'summary'->'fields' = jsonb_build_array(jsonb_build_object('label', '狀態', 'value', '啟用 → 停用')),
    'the summary shows the status change, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check(not (select is_active from public.product_groups where id = v_group), 'the product is disabled');

  perform pg_temp.check_api_error_as(v_owner, format('select public.create_order(%L, %L, %L)', v_org, fx->>'customer_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 1, 'unit_price', 1))),
    '22023', 'product_unavailable', 'a color of a disabled product cannot be ordered');
  perform pg_temp.call_as(v_owner, format('select public.update_order(%L, %L, %L)', v_org, fx->>'order_id', jsonb_build_object('items',
    jsonb_build_array(jsonb_build_object('id', v_line, 'product_id', fx->>'product_id', 'quantity', 120, 'unit_price', 10)))));
  perform pg_temp.check((select quantity from public.order_products where id = v_line) = 120, 'an existing line keeps its disabled product');

  perform pg_temp.check_api_error_as(v_owner, format('select public.set_product_active(%L, %L, null)', v_org, v_group),
    '22023', 'is_active_required', 'enable or disable must be stated');
end $$;

-- product_catalog lists each color with its product and stock, for members who may view products
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_row record;
  v_visible int;
  v_groups int;
begin
  update public.products_new set stock_thresholds = 150 where id = (fx->>'product_id')::uuid;

  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into v_row from public.product_catalog where color_id = (fx->>'product_id')::uuid;
  select count(*) into v_visible from public.product_catalog where organization_id = (other->>'org_id')::uuid;
  select count(*) into v_groups from public.product_groups where organization_id = v_org;
  execute 'reset role';

  perform pg_temp.check(v_row.product_id is not null and v_row.organization_id = v_org and v_row.product_is_active and v_row.color_is_active,
    'a viewer sees the color with its product');
  perform pg_temp.check(v_row.stock_quantity = 60 and v_row.stock_rolls = 1, 'the color shows its stock, got ' || coalesce(v_row.stock_quantity::text, 'none'));
  perform pg_temp.check(v_row.is_low_stock, 'stock under the threshold is low');
  perform pg_temp.check(v_visible = 0, 'another organization''s catalog is hidden');
  perform pg_temp.check(v_groups = 2, 'a viewer can read the organization''s products');

  perform pg_temp.check_raises_as(v_viewer, format('insert into public.product_groups (organization_id, name) values (%L, %L)', v_org, 'x'),
    'permission denied', 'products cannot be written directly');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.api_check_product_name(uuid, text, uuid)', 'EXECUTE'), 'product helpers are internal');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
