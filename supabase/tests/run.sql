-- 自動產生（build-run.sh），請勿手動修改。
-- 結果為 "ALL TESTS PASSED" 代表通過；"FAIL: ..." 或其他錯誤代表未通過。
-- 最後一定會丟出例外，整批 SQL 會回滾，不會留下任何變更。

-- ===== migration: 20261009163659_signup_profile_phone.sql
-- 註冊時把電話一起寫進用戶資料（2026-10-09）
--
-- 邀請新用戶時，前端以 signUp 的 metadata 帶入姓名與電話；handle_new_user 原本只寫姓名，
-- complete_user_invitation 之後再補電話，編輯紀錄因此多出一筆「修改用戶資料」。
-- 改為建立用戶資料時就寫入電話，complete_user_invitation 的更新沒有變化，不會再留下紀錄。

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NULLIF(btrim(NEW.raw_user_meta_data->>'phone'), ''),
    true
  );
  RETURN NEW;
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

-- ===== test: signup_profile_phone.test.sql
-- 註冊時寫入電話（supabase/migrations/20261009163659_signup_profile_phone.sql）。先載入 _helpers.sql 再執行本檔。

-- An invited sign-up keeps its phone on the profile; completing the invitation leaves no extra profile edit
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_admin uuid := pg_temp.add_member(v_org, 'admin');
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (v_user, 'authenticated', 'authenticated', 'sql-test-' || v_user || '@example.test',
    jsonb_build_object('full_name', '王小美', 'phone', '0912345678'));

  perform pg_temp.check((select full_name = '王小美' and phone = '0912345678' from public.profiles where id = v_user),
    'the profile is created with the name and phone from sign-up');

  perform pg_temp.act_as(v_admin);
  perform public.complete_user_invitation(v_user, v_org, 'editor', '王小美', '0912345678');
  execute 'reset role';

  perform pg_temp.check(not exists (select 1 from public.record_audit_logs where table_name = 'profiles' and record_id = v_user and action = 'UPDATE'),
    'completing the invitation adds no profile edit to the history');
  perform pg_temp.check(exists (select 1 from public.record_audit_logs where table_name = 'user_organizations' and parent_id = v_user and action = 'INSERT'),
    'the membership is in the user''s history');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
    'the trigger function stays closed to clients');
end $$;

-- A sign-up without a phone leaves it empty
do $$
declare
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data)
  values (v_user, 'authenticated', 'authenticated', 'sql-test-' || v_user || '@example.test', jsonb_build_object('phone', ' '));
  perform pg_temp.check((select phone is null from public.profiles where id = v_user), 'a blank phone is stored as empty');
end $$;


-- ===== test: function_hardening.test.sql
-- 函式清理與資安建議（supabase/migrations/20261009133702_function_hardening.sql）。先載入 _helpers.sql 再執行本檔。

-- The unused functions are gone; the ones kept have a fixed search_path and are not callable by clients
do $$
declare
  v_name text;
begin
  foreach v_name in array array['is_admin', 'get_user_organizations', 'ensure_user_profile', 'generate_order_number'] loop
    perform pg_temp.check(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name),
      v_name || ' is dropped');
  end loop;

  foreach v_name in array array['handle_new_user', 'set_current_quantity', 'update_updated_at', 'update_updated_by'] loop
    perform pg_temp.check((select proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name)
        @> array['search_path=public'],
      v_name || ' has a fixed search_path');
  end loop;

  foreach v_name in array array['handle_new_user', 'handle_organization_creation', 'update_updated_by', 'update_updated_at', 'set_current_quantity'] loop
    perform pg_temp.check(not has_function_privilege('anon', format('public.%I()', v_name), 'EXECUTE')
        and not has_function_privilege('authenticated', format('public.%I()', v_name), 'EXECUTE'),
      v_name || ' cannot be called by clients');
  end loop;
end $$;

-- The triggers still fire for signed-in users
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_org uuid := gen_random_uuid();
  v_product uuid := (fx->>'product_id')::uuid;
begin
  perform pg_temp.act_as(v_user);

  -- handle_organization_creation: the creator becomes a member of the new organization
  insert into public.organizations (id, name, owner_id) values (v_org, '觸發器測試組織', v_user);
  perform pg_temp.check(exists (select 1 from public.user_organizations where organization_id = v_org and user_id = v_user),
    'creating an organization still adds its owner as a member');

  -- update_updated_by on a product color the user did not edit before
  perform pg_temp.check((select updated_by is distinct from v_user from public.products_new where id = v_product), 'the seeded color was not edited by the user yet');
  update public.products_new set color_code = 'T-1' where id = v_product;
  perform pg_temp.check((select updated_by = v_user from public.products_new where id = v_product),
    'editing a product color still records who edited it');

  execute 'reset role';
end $$;


-- ===== test: audit_user_history.test.sql
-- 用戶編輯紀錄測試。先載入 _helpers.sql 再執行本檔。

-- Membership, role and status changes are filed under the user they belong to
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_owner uuid := (fx->>'user_id')::uuid;
  v_member uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_logs int;
begin
  perform pg_temp.act_as(v_owner);
  perform public.set_member_role((fx->>'org_id')::uuid, v_member, 'viewer');
  perform public.set_member_active((fx->>'org_id')::uuid, v_member, false);
  execute 'reset role';

  select count(*) into v_logs from public.record_audit_logs
  where parent_id = v_member and parent_table = 'profiles' and table_name = 'user_organizations';
  perform pg_temp.check(v_logs >= 3, 'membership, role and status changes are filed under the user, got ' || v_logs);
end $$;

-- A member's profile edits are visible to other members of the organization, not to outsiders
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  outsider jsonb := pg_temp.seed_fixture();
  v_owner uuid := (fx->>'user_id')::uuid;
  v_member uuid := gen_random_uuid();
  v_owner_sees int;
  v_outsider_sees int;
begin
  insert into auth.users (id, aud, role, email)
  values (v_member, 'authenticated', 'authenticated', 'sql-test-' || v_member || '@example.test');
  insert into public.user_organizations (user_id, organization_id, is_active) values (v_member, (fx->>'org_id')::uuid, true);

  perform pg_temp.act_as(v_member);
  update public.profiles set full_name = '新名字' where id = v_member;

  perform pg_temp.act_as(v_owner);
  select count(*) into v_owner_sees from public.record_audit_logs where table_name = 'profiles' and record_id = v_member;
  perform pg_temp.act_as((outsider->>'user_id')::uuid);
  select count(*) into v_outsider_sees from public.record_audit_logs where table_name = 'profiles' and record_id = v_member;
  execute 'reset role';

  perform pg_temp.check(v_owner_sees >= 1, 'a fellow member sees the profile edit, saw ' || v_owner_sees);
  perform pg_temp.check(v_outsider_sees = 0, 'an outsider does not see it, saw ' || v_outsider_sees);
end $$;


-- ===== test: rbac_r1_roles.test.sql
-- RBAC R1 固定角色測試（docs/requirements/MULTI_TENANT_RBAC.md §4）。先載入 _helpers.sql 再執行本檔。

-- Every role holds exactly the permissions of docs/requirements/MULTI_TENANT_RBAC.md §4.3; removed keys are granted to nobody
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_admin uuid := pg_temp.add_member(v_org, 'admin');
  v_editor uuid := pg_temp.add_member(v_org, 'editor');
  v_viewer uuid := pg_temp.add_member(v_org, 'viewer');
  v_view text[] := array[
    'canViewProducts', 'canViewCustomers', 'canViewFactories', 'canViewShelves',
    'canViewOrders', 'canViewPurchases', 'canViewInventory', 'canViewShipping'];
  v_write text[] := array[
    'canCreateProducts', 'canEditProducts', 'canCreateCustomers', 'canEditCustomers',
    'canCreateFactories', 'canEditFactories', 'canCreateShelves', 'canEditShelves',
    'canCreateOrders', 'canEditOrders', 'canCreatePurchases', 'canEditPurchases',
    'canCreateInventory', 'canEditInventory', 'canCreateShipping', 'canEditShipping'];
  v_member_view text[] := array['canViewUsers', 'canViewPermissions', 'canViewSystemSettings'];
  v_admin_only text[] := array['canCreateUsers', 'canEditUsers', 'canEditSystemSettings'];
  v_removed text[] := array[
    'canDeleteProducts', 'canEditPermissions', 'canManageOrganization', 'canManageUsers',
    'canManageRoles', 'canViewAll', 'canEditAll', 'canDeleteAll'];
  v_all text[];
  v_key text;
  v_user uuid;
  v_label text;
  v_expected text[];
begin
  v_all := v_view || v_write || v_member_view || v_admin_only || v_removed;

  perform pg_temp.check(
    (select array_agg(distinct permission_key order by permission_key) from public.role_permissions)
      = (select array_agg(k order by k) from unnest(v_view || v_write || v_member_view || v_admin_only) k),
    'the catalog holds exactly the 30 permission keys');

  for v_user, v_label, v_expected in
    select * from (values
      (v_owner, 'owner', v_view || v_write || v_member_view || v_admin_only),
      (v_admin, 'admin', v_view || v_write || v_member_view || v_admin_only),
      (v_editor, 'editor', v_view || v_write || v_member_view),
      (v_viewer, 'viewer', v_view)
    ) as t(u, l, e)
  loop
    foreach v_key in array v_all loop
      perform pg_temp.check(
        public.user_has_organization_permission(v_user, v_org, v_key) = (v_key = any(v_expected)),
        format('%s %s %s', v_label, case when v_key = any(v_expected) then 'has' else 'lacks' end, v_key));
    end loop;
  end loop;
end $$;

-- Pending, disabled and other organizations' members have no permissions
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_pending uuid := gen_random_uuid();
  v_disabled uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'admin');
begin
  insert into auth.users (id, aud, role, email)
  values (v_pending, 'authenticated', 'authenticated', 'sql-test-' || v_pending || '@example.test');
  insert into public.user_organizations (user_id, organization_id, is_active, accepted_at, role)
  values (v_pending, v_org, false, null, 'admin');
  update public.user_organizations set is_active = false where user_id = v_disabled and organization_id = v_org;

  perform pg_temp.check(not public.user_has_organization_permission(v_pending, v_org, 'canViewOrders'), 'a pending invitee has no permissions');
  perform pg_temp.check(not public.user_has_organization_permission(v_disabled, v_org, 'canViewOrders'), 'a disabled member has no permissions');
  perform pg_temp.check(not public.user_has_organization_permission((other->>'user_id')::uuid, v_org, 'canViewOrders'),
    'another organization''s owner has no permissions here');
end $$;

-- set_member_role: admins change other members' roles; nobody changes their own role or the owner's
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_admin uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'admin');
  v_member uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
begin
  perform pg_temp.act_as(v_admin);
  perform public.set_member_role(v_org, v_member, 'editor');
  execute 'reset role';
  perform pg_temp.check((select role from public.user_organizations where user_id = v_member and organization_id = v_org) = 'editor',
    'an admin can make a viewer an editor');
  perform pg_temp.check(public.user_has_organization_permission(v_member, v_org, 'canCreateOrders'), 'the new editor can create orders');

  perform pg_temp.act_as(v_admin);
  perform public.set_member_role(v_org, v_member, 'admin');
  execute 'reset role';
  perform pg_temp.check(public.user_has_organization_permission(v_member, v_org, 'canEditUsers'), 'an admin can promote a member to admin');

  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_role(%L, %L, %L)', v_org, v_admin, 'viewer'),
    '不能修改自己的角色', 'nobody can change their own role');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_role(%L, %L, %L)', v_org, v_owner, 'viewer'),
    '不能修改擁有者的角色', 'an admin cannot change the owner''s role');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_role(%L, %L, %L)', v_org, v_member, 'owner'),
    '擁有者只能經由轉移擁有權產生', 'nobody can be made owner through a role change');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_role(%L, %L, %L)', v_org, v_member, 'sales'),
    '角色不存在', 'only the three roles can be assigned');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_role(%L, %L, %L)', v_org, (other->>'user_id')::uuid, 'viewer'),
    '此使用者不是組織成員', 'a non-member cannot be given a role');
  perform pg_temp.check_raises_as(v_editor, format('select public.set_member_role(%L, %L, %L)', v_org, v_member, 'viewer'),
    '權限不足', 'an editor cannot change roles');
  perform pg_temp.check_raises_as((other->>'user_id')::uuid, format('select public.set_member_role(%L, %L, %L)', v_org, v_member, 'viewer'),
    '權限不足', 'an outsider cannot change roles');
end $$;

-- set_member_active: admins disable and re-enable members who joined; not themselves, the owner or invitees
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_admin uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'admin');
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_pending uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email)
  values (v_pending, 'authenticated', 'authenticated', 'sql-test-' || v_pending || '@example.test');
  insert into public.user_organizations (user_id, organization_id, is_active, accepted_at, role)
  values (v_pending, v_org, false, null, 'viewer');

  perform pg_temp.act_as(v_admin);
  perform public.set_member_active(v_org, v_editor, false);
  execute 'reset role';
  perform pg_temp.check(not public.user_has_organization_permission(v_editor, v_org, 'canViewOrders'), 'a disabled editor loses access');

  perform pg_temp.act_as(v_admin);
  perform public.set_member_active(v_org, v_editor, true);
  execute 'reset role';
  perform pg_temp.check(public.user_has_organization_permission(v_editor, v_org, 'canCreateOrders'), 're-enabling restores access');

  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_active(%L, %L, false)', v_org, v_admin),
    '不能停用或啟用自己', 'nobody can disable themselves');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_active(%L, %L, false)', v_org, v_owner),
    '不能停用擁有者', 'the owner cannot be disabled');
  perform pg_temp.check_raises_as(v_admin, format('select public.set_member_active(%L, %L, true)', v_org, v_pending),
    '此成員尚未接受邀請', 'an invitation cannot be activated without being accepted');
  perform pg_temp.check_raises_as(v_editor, format('select public.set_member_active(%L, %L, false)', v_org, v_admin),
    '權限不足', 'an editor cannot disable members');
end $$;

-- Clients cannot change who a member is, their role or status directly; resending an invitation still works
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_admin uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'admin');
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_newcomer uuid := gen_random_uuid();
  v_changed int;
begin
  insert into auth.users (id, aud, role, email)
  values (v_newcomer, 'authenticated', 'authenticated', 'sql-test-' || v_newcomer || '@example.test');

  perform pg_temp.check_raises_as(v_admin,
    format('update public.user_organizations set role = %L where user_id = %L and organization_id = %L', 'viewer', v_editor, v_org),
    '成員的角色與狀態只能經由系統功能修改', 'an admin cannot change a role by updating the row');
  perform pg_temp.check_raises_as(v_owner,
    format('update public.user_organizations set is_active = false where user_id = %L and organization_id = %L', v_editor, v_org),
    '成員的角色與狀態只能經由系統功能修改', 'the owner cannot change a status by updating the row');
  perform pg_temp.check_raises_as(v_owner,
    format('insert into public.user_organizations (user_id, organization_id, role) values (%L, %L, %L)', v_newcomer, v_org, 'admin'),
    '成員只能經由邀請加入組織', 'the owner cannot add a member by inserting a row');

  -- An editor has no update rights on memberships at all: its own row stays as it was
  perform pg_temp.act_as(v_editor);
  update public.user_organizations set invited_at = now() where user_id = v_editor and organization_id = v_org;
  get diagnostics v_changed = row_count;
  execute 'reset role';
  perform pg_temp.check(v_changed = 0, 'an editor cannot update memberships, updated ' || v_changed);

  perform pg_temp.act_as(v_admin);
  update public.user_organizations set invited_at = now() where user_id = v_editor and organization_id = v_org;
  get diagnostics v_changed = row_count;
  execute 'reset role';
  perform pg_temp.check(v_changed = 1, 'an admin can still refresh invited_at when resending an invitation');
end $$;

-- Inviting an existing account: the invitee gets the invited role only after accepting
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_admin uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'admin');
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_invitee uuid := gen_random_uuid();
  v_email text;
  v_returned uuid;
  v_invitation_role text;
begin
  insert into auth.users (id, aud, role, email)
  values (v_invitee, 'authenticated', 'authenticated', 'sql-test-' || v_invitee || '@example.test')
  returning email into v_email;

  perform pg_temp.act_as(v_admin);
  v_returned := public.add_existing_user_to_organization(v_email, v_org, 'editor');
  execute 'reset role';
  perform pg_temp.check(v_returned = v_invitee, 'the invitation returns the existing account');
  perform pg_temp.check(not public.user_has_organization_permission(v_invitee, v_org, 'canViewOrders'), 'an invitee has no access before accepting');

  perform pg_temp.act_as(v_invitee);
  select role_display_name into v_invitation_role from public.get_my_pending_invitations() where organization_id = v_org;
  perform public.accept_organization_invitation(v_org);
  execute 'reset role';
  perform pg_temp.check(v_invitation_role = '編輯者', 'the invitation shows the invited role, got ' || coalesce(v_invitation_role, 'none'));
  perform pg_temp.check(public.user_has_organization_permission(v_invitee, v_org, 'canCreateOrders'), 'the accepted invitee is an editor');
  perform pg_temp.check(not public.user_has_organization_permission(v_invitee, v_org, 'canEditUsers'), 'the accepted invitee is not an admin');

  perform pg_temp.check_raises_as(v_admin, format('select public.add_existing_user_to_organization(%L, %L, %L)', v_email, v_org, 'owner'),
    '指定的角色無效', 'nobody can be invited as owner');
  perform pg_temp.check_raises_as(v_editor, format('select public.add_existing_user_to_organization(%L, %L, %L)', v_email, v_org, 'viewer'),
    '權限不足', 'an editor cannot invite');
  perform pg_temp.check_raises_as(v_editor,
    format('select public.complete_user_invitation(%L, %L, %L)', gen_random_uuid(), v_org, 'viewer'),
    '權限不足', 'an editor cannot complete a sign-up invitation');
end $$;

-- Transferring ownership: the new owner has every permission, the previous owner stays an admin
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
begin
  perform pg_temp.check_raises_as(v_editor, format('select public.transfer_organization_ownership(%L, %L)', v_org, v_editor),
    '只有組織擁有者可以轉移所有權', 'only the owner can transfer ownership');

  perform pg_temp.act_as(v_owner);
  perform public.transfer_organization_ownership(v_org, v_editor);
  execute 'reset role';

  perform pg_temp.check((select owner_id from public.organizations where id = v_org) = v_editor, 'the editor is the new owner');
  perform pg_temp.check(public.user_has_organization_permission(v_editor, v_org, 'canEditSystemSettings'), 'the new owner has every permission');
  perform pg_temp.check((select role from public.user_organizations where user_id = v_owner and organization_id = v_org) = 'admin',
    'the previous owner is now an admin');
  perform pg_temp.check(public.user_has_organization_permission(v_owner, v_org, 'canEditUsers'), 'the previous owner keeps admin permissions');
  perform pg_temp.check_raises_as(v_owner, format('select public.transfer_organization_ownership(%L, %L)', v_org, v_owner),
    '只有組織擁有者可以轉移所有權', 'the previous owner can no longer transfer ownership');
end $$;

-- Creating an organization makes the creator an admin member; no per-organization role rows are created
do $$
declare
  v_user uuid := gen_random_uuid();
  v_org uuid;
begin
  insert into auth.users (id, aud, role, email)
  values (v_user, 'authenticated', 'authenticated', 'sql-test-' || v_user || '@example.test');

  perform pg_temp.act_as(v_user);
  insert into public.organizations (name, owner_id) values ('新組織', v_user) returning id into v_org;
  execute 'reset role';

  perform pg_temp.check((select role from public.user_organizations where user_id = v_user and organization_id = v_org and is_active) = 'admin',
    'the creator is an active admin member');
  perform pg_temp.check(to_regclass('public.organization_roles') is null, 'the legacy role table is gone');
end $$;

-- Signed-in users can read the role catalog; anonymous callers can neither read it nor call the permission functions
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_rows int;
begin
  perform pg_temp.act_as((fx->>'user_id')::uuid);
  select count(*) into v_rows from public.role_permissions;
  execute 'reset role';
  perform pg_temp.check(v_rows > 0, 'a signed-in user can read the role catalog');

  perform pg_temp.check(not has_table_privilege('anon', 'public.role_permissions', 'SELECT'), 'anon cannot read the role catalog');
  perform pg_temp.check(not has_function_privilege('anon', 'public.user_has_organization_permission(uuid, uuid, text)', 'EXECUTE'),
    'anon cannot call user_has_organization_permission');
  perform pg_temp.check(not has_function_privilege('anon', 'public.is_organization_owner(uuid, uuid)', 'EXECUTE'),
    'anon cannot call is_organization_owner');
  perform pg_temp.check(not has_function_privilege('anon', 'public.set_member_role(uuid, uuid, text)', 'EXECUTE'),
    'anon cannot call set_member_role');
end $$;


-- ===== test: private_definer_functions.test.sql
-- SECURITY DEFINER 函式移到 private schema（supabase/migrations/20261009140512_private_definer_functions.sql）。先載入 _helpers.sql 再執行本檔。

-- Nothing in the exposed schema runs as its owner for a client
do $$
declare
  v_list text;
begin
  select string_agg(p.proname, ', ') into v_list
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  perform pg_temp.check(v_list is null, 'no SECURITY DEFINER function in public is callable by clients, found ' || coalesce(v_list, ''));

  select string_agg(p.proname, ', ') into v_list
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype;
  perform pg_temp.check(v_list is null, 'only trigger functions stay SECURITY DEFINER in public, found ' || coalesce(v_list, ''));

  perform pg_temp.check(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon cannot use the private schema');
  perform pg_temp.check(to_regprocedure('public.api_assign_document_number(uuid, text)') is null
      and to_regprocedure('private.api_assign_document_number(uuid, text)') is not null,
    'document numbering is no longer exposed');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.touch_query_session_updated_at()', 'EXECUTE'),
    'the query session trigger function cannot be called by clients');
end $$;

-- Each wrapper keeps its name and parameters, runs as the caller and forwards to the implementation
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.proname, pg_get_function_arguments(p.oid) as args, q.oid as impl,
           pg_get_function_arguments(q.oid) as impl_args, p.proconfig
    from pg_proc p
    join pg_proc q on q.proname = p.proname and q.pronamespace = 'private'::regnamespace
    where p.pronamespace = 'public'::regnamespace
  loop
    perform pg_temp.check(v_fn.args = v_fn.impl_args, v_fn.proname || ' keeps its parameters');
    perform pg_temp.check(v_fn.proconfig @> array['search_path=""'], v_fn.proname || ' has a fixed search_path');
    perform pg_temp.check((select prosecdef from pg_proc where oid = v_fn.impl), v_fn.proname || ' implementation runs as its owner');
  end loop;
  perform pg_temp.check((select count(*) from pg_proc p join pg_proc q on q.proname = p.proname
      where p.pronamespace = 'public'::regnamespace and q.pronamespace = 'private'::regnamespace) = 40,
    'all 40 client functions have a wrapper');
  -- Policies refer to functions by OID, so they moved along with the implementations
  perform pg_temp.check(not exists (select 1 from pg_depend d join pg_proc p on p.oid = d.refobjid
      where d.classid = 'pg_policy'::regclass and p.pronamespace = 'public'::regnamespace
        and exists (select 1 from pg_proc q where q.proname = p.proname and q.pronamespace = 'private'::regnamespace)),
    'no policy goes through a wrapper');
  perform pg_temp.check(exists (select 1 from pg_depend d
      where d.classid = 'pg_policy'::regclass and d.refobjid = 'private.user_has_organization_permission(uuid, uuid, text)'::regprocedure),
    'policies call the permission check in private directly');
end $$;

-- Through the wrappers: named parameters, set-returning functions, permission refusals and direct inserts still work
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member(v_org, 'editor');
  v_viewer uuid := pg_temp.add_member(v_org, 'viewer');
  v_result jsonb;
  v_number text;
begin
  v_result := pg_temp.call_as(v_editor, format('select public.create_customer(%L, %L, %L, p_phone => %L, p_dry_run => true)', v_org, '包裝函式客戶', '陳先生', '0911'));
  perform pg_temp.check((v_result->>'dry_run')::boolean, 'a dry run through the wrapper answers');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.create_customer(%L, %L, %L, p_phone => %L)', v_org, '訪客客戶', '陳先生', '0911'),
    '42501', 'forbidden', 'a viewer is still refused through the wrapper');

  perform pg_temp.check(pg_temp.call_as(v_editor, format('select to_jsonb(public.user_has_organization_permission(%L, %L, %L))',
      v_editor, v_org, 'canCreateCustomers'))::boolean, 'the permission check answers through the wrapper');
  perform pg_temp.check(pg_temp.call_as((fx->>'user_id')::uuid, format('select to_jsonb(count(*)) from public.get_organization_member_status(%L)', v_org))::int >= 3,
    'a set-returning RPC answers through the wrapper');

  -- A direct insert by a signed-in user still gets a system number
  perform pg_temp.act_as(v_editor);
  insert into public.orders (customer_id, user_id, organization_id, order_number)
  values ((fx->>'customer_id')::uuid, v_editor, v_org, 'X-1') returning order_number into v_number;
  execute 'reset role';
  perform pg_temp.check(v_number ~ '^B\d{12}$', 'a direct insert is numbered by the system, got ' || coalesce(v_number, 'none'));
end $$;


do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
