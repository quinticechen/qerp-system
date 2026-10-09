-- 業務 API A1：客戶與工廠（docs/API.md）。先載入 _helpers.sql 再執行本檔。

-- create_customer: editors create, viewers and outsiders are refused; anonymous callers cannot call it at all
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_result jsonb;
  v_row public.customers%rowtype;
begin
  v_result := pg_temp.call_as(v_editor, format(
    'select public.create_customer(%L, %L, %L, p_phone => %L, p_email => %L, p_note => %L)',
    v_org, '  永泰布行 ', '陳先生', '0912345678', 'chen@example.com', ''));
  select * into v_row from public.customers where id = (v_result->>'id')::uuid;

  perform pg_temp.check(v_row.organization_id = v_org, 'the customer is created in the organization');
  perform pg_temp.check(v_row.name = '永泰布行', 'names are trimmed, got ' || coalesce(v_row.name, 'none'));
  perform pg_temp.check(v_row.note is null, 'empty text is stored as null');
  perform pg_temp.check(v_row.is_active, 'new customers are active');
  perform pg_temp.check((v_result->>'dry_run')::boolean = false and v_result->>'number' is null, 'the result follows the write-API shape');
  perform pg_temp.check(v_result->'summary'->>'title' = '建立客戶', 'the summary has a title');
  perform pg_temp.check(v_result->'summary'->'fields' @> '[{"label": "名稱", "value": "永泰布行"}, {"label": "手機", "value": "0912345678"}]',
    'the summary lists the values by label');
  perform pg_temp.check(not (v_result->'summary'->'fields' @> '[{"label": "備註"}]'), 'empty values are left out of the summary');

  perform pg_temp.check_api_error_as(v_viewer,
    format('select public.create_customer(%L, %L, %L, p_phone => %L)', v_org, '新客戶', '王小姐', '0911'),
    '42501', 'forbidden', 'a viewer cannot create customers');
  perform pg_temp.check_api_error_as((other->>'user_id')::uuid,
    format('select public.create_customer(%L, %L, %L, p_phone => %L)', v_org, '新客戶', '王小姐', '0911'),
    '42501', 'forbidden', 'another organization''s owner cannot create customers here');
  perform pg_temp.check(not has_function_privilege('anon',
    'public.create_customer(uuid, text, text, text, text, text, text, text, text, boolean)', 'EXECUTE'),
    'anonymous callers cannot call create_customer');
end $$;

-- Dry runs validate and describe the customer exactly like the real call, without writing anything
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_before int;
  v_preview jsonb;
  v_real jsonb;
  v_statement text;
begin
  select count(*) into v_before from public.customers where organization_id = v_org;
  v_statement := format('select public.create_customer(%L, %L, %L, p_landline_phone => %L, p_address => %L, p_dry_run => %s)',
    v_org, '豐年紡織', '林經理', '02-2345-6789', '台北市', '%s');

  v_preview := pg_temp.call_as(v_editor, format(v_statement, 'true'));
  perform pg_temp.check((select count(*) from public.customers where organization_id = v_org) = v_before, 'a dry run writes nothing');
  perform pg_temp.check((v_preview->>'dry_run')::boolean and v_preview->>'id' is null, 'a dry run reports itself and has no id');

  v_real := pg_temp.call_as(v_editor, format(v_statement, 'false'));
  perform pg_temp.check(v_preview->'summary' = v_real->'summary', 'the dry run shows the same summary as the real call');

  -- The dry run runs every check too, including the duplicate-name rule the real call just made relevant
  perform pg_temp.check_api_error_as(v_editor, format(v_statement, 'true'),
    '23505', 'customer_name_taken', 'a dry run reports the same errors');
end $$;

-- Customer rules: required name and contact, a phone, a valid email, and unique names within the organization
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
begin
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_customer(%L, %L, %L, p_phone => %L)', v_org, '  ', '陳先生', '0911'),
    '22023', 'name_required', 'a name is required');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_customer(%L, %L, %L, p_phone => %L)', v_org, '甲', null, '0911'),
    '22023', 'contact_person_required', 'a contact person is required');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_customer(%L, %L, %L)', v_org, '甲', '陳先生'),
    '22023', 'phone_required', 'a mobile or landline number is required');
  perform pg_temp.check_api_error_as(v_editor,
    format('select public.create_customer(%L, %L, %L, p_phone => %L, p_email => %L)', v_org, '甲', '陳先生', '0911', 'not-an-email'),
    '22023', 'invalid_email', 'the email must look like an address');
  -- seed_fixture created 測試客戶; names compare without case or surrounding spaces
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_customer(%L, %L, %L, p_phone => %L)', v_org, ' 測試客戶 ', '陳先生', '0911'),
    '23505', 'customer_name_taken', 'names are unique within the organization');

  -- Another organization may use the same name
  perform pg_temp.call_as((other->>'user_id')::uuid,
    format('select public.create_customer(%L, %L, %L, p_phone => %L)', (other->>'org_id')::uuid, '甲', '陳先生', '0911'));
  perform pg_temp.call_as(v_editor, format('select public.create_customer(%L, %L, %L, p_phone => %L)', v_org, '甲', '陳先生', '0911'));
end $$;

-- update_customer changes only the given fields, lists exactly what changed, and stays inside the organization
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_customer uuid;
  v_result jsonb;
  v_row public.customers%rowtype;
begin
  v_customer := (pg_temp.call_as(v_editor, format(
    'select public.create_customer(%L, %L, %L, p_phone => %L, p_email => %L)', v_org, '永泰布行', '陳先生', '0911', 'a@b.co'))->>'id')::uuid;

  v_result := pg_temp.call_as(v_editor, format('select public.update_customer(%L, %L, %L, true)',
    v_org, v_customer, '{"phone": "0922", "email": ""}'));
  perform pg_temp.check((select phone from public.customers where id = v_customer) = '0911', 'a dry run changes nothing');
  perform pg_temp.check(v_result->'summary'->'fields' = '[{"label": "手機", "value": "0911 → 0922"}, {"label": "電子郵件", "value": "a@b.co → （空白）"}]',
    'the summary lists only the changed fields, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check(v_result->'summary'->>'title' = '修改客戶「永泰布行」', 'the title names the customer');

  perform pg_temp.call_as(v_editor, format('select public.update_customer(%L, %L, %L)', v_org, v_customer, '{"phone": "0922", "email": ""}'));
  select * into v_row from public.customers where id = v_customer;
  perform pg_temp.check(v_row.phone = '0922' and v_row.email is null and v_row.name = '永泰布行' and v_row.contact_person = '陳先生',
    'only the given fields change; an empty value clears the field');

  perform pg_temp.check_api_error_as(v_editor, format('select public.update_customer(%L, %L, %L)', v_org, v_customer, '{"phone": "", "landline_phone": ""}'),
    '22023', 'phone_required', 'the merged customer must still have a phone');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_customer(%L, %L, %L)', v_org, v_customer, '{"organization_id": "x"}'),
    '22023', 'unknown_field', 'only customer fields can be changed');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_customer(%L, %L, %L)', v_org, v_customer, '{"name": "測試客戶"}'),
    '23505', 'customer_name_taken', 'renaming cannot collide with another customer');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_customer(%L, %L, %L)', v_org, v_customer, '{"phone": "1"}'),
    '42501', 'forbidden', 'a viewer cannot edit customers');
  perform pg_temp.check_api_error_as(v_editor,
    format('select public.update_customer(%L, %L, %L)', v_org, (other->>'customer_id')::uuid, '{"phone": "1"}'),
    'P0002', 'customer_not_found', 'another organization''s customer is reported as not found');
  perform pg_temp.check_api_error_as((other->>'user_id')::uuid,
    format('select public.update_customer(%L, %L, %L)', (other->>'org_id')::uuid, v_customer, '{"phone": "1"}'),
    'P0002', 'customer_not_found', 'a customer cannot be reached through another organization');

  -- Keeping its own name is not a collision
  perform pg_temp.call_as(v_editor, format('select public.update_customer(%L, %L, %L)', v_org, v_customer, '{"name": " 永泰布行 "}'));
end $$;

-- set_customer_active disables and re-enables customers
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_customer uuid := (fx->>'customer_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_result jsonb;
begin
  v_result := pg_temp.call_as(v_editor, format('select public.set_customer_active(%L, %L, false, true)', v_org, v_customer));
  perform pg_temp.check((select is_active from public.customers where id = v_customer), 'a dry run leaves the customer active');
  perform pg_temp.check(v_result->'summary' = '{"title": "停用客戶「測試客戶」", "fields": [{"label": "狀態", "value": "啟用 → 停用"}]}',
    'the summary describes the change, got ' || (v_result->'summary')::text);

  perform pg_temp.call_as(v_editor, format('select public.set_customer_active(%L, %L, false)', v_org, v_customer));
  perform pg_temp.check(not (select is_active from public.customers where id = v_customer), 'the customer is disabled');
  perform pg_temp.check((select count(*) from public.orders where customer_id = v_customer) = 1, 'existing orders keep the customer');

  perform pg_temp.call_as(v_editor, format('select public.set_customer_active(%L, %L, true)', v_org, v_customer));
  perform pg_temp.check((select is_active from public.customers where id = v_customer), 'the customer is enabled again');

  perform pg_temp.check_api_error_as(v_viewer, format('select public.set_customer_active(%L, %L, false)', v_org, v_customer),
    '42501', 'forbidden', 'a viewer cannot disable customers');
  perform pg_temp.check_api_error_as(v_editor, format('select public.set_customer_active(%L, %L, false)', v_org, gen_random_uuid()),
    'P0002', 'customer_not_found', 'an unknown customer is reported as not found');
end $$;

-- Factories follow the same rules with their own permissions
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_factory uuid;
  v_preview jsonb;
  v_result jsonb;
begin
  v_preview := pg_temp.call_as(v_editor, format('select public.create_factory(%L, %L, %L, p_phone => %L, p_dry_run => true)', v_org, '大明染整', '黃廠長', '0933'));
  perform pg_temp.check(not exists (select 1 from public.factories where name = '大明染整'), 'a factory dry run writes nothing');
  v_result := pg_temp.call_as(v_editor, format('select public.create_factory(%L, %L, %L, p_phone => %L)', v_org, '大明染整', '黃廠長', '0933'));
  v_factory := (v_result->>'id')::uuid;
  perform pg_temp.check(v_preview->'summary' = v_result->'summary' and v_result->'summary'->>'title' = '建立工廠', 'the factory summary matches its dry run');

  perform pg_temp.check_api_error_as(v_editor, format('select public.create_factory(%L, %L, %L, p_phone => %L)', v_org, '測試工廠', '甲', '1'),
    '23505', 'factory_name_taken', 'factory names are unique within the organization');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.create_factory(%L, %L, %L, p_phone => %L)', v_org, '乙廠', '甲', '1'),
    '42501', 'forbidden', 'a viewer cannot create factories');

  v_result := pg_temp.call_as(v_editor, format('select public.update_factory(%L, %L, %L)', v_org, v_factory, '{"address": "彰化縣"}'));
  perform pg_temp.check((select address from public.factories where id = v_factory) = '彰化縣', 'the factory is updated');
  perform pg_temp.check(v_result->'summary'->>'title' = '修改工廠「大明染整」', 'the factory update summary names it');
  perform pg_temp.check_api_error_as(v_editor,
    format('select public.update_factory(%L, %L, %L)', v_org, (other->>'factory_id')::uuid, '{"address": "x"}'),
    'P0002', 'factory_not_found', 'another organization''s factory is reported as not found');

  perform pg_temp.call_as(v_editor, format('select public.set_factory_active(%L, %L, false)', v_org, v_factory));
  perform pg_temp.check(not (select is_active from public.factories where id = v_factory), 'the factory is disabled');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.set_factory_active(%L, %L, true)', v_org, v_factory),
    '42501', 'forbidden', 'a viewer cannot enable factories');
end $$;

-- The shared helpers are internal: signed-in users cannot call them directly
do $$
begin
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.api_require_permission(uuid, text)', 'EXECUTE'),
    'api_require_permission is internal');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.api_result(boolean, uuid, text, text, jsonb)', 'EXECUTE'),
    'api_result is internal');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
