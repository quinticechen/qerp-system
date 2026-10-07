-- 自動產生（build-run.sh），請勿手動修改。
-- 結果為 "ALL TESTS PASSED" 代表通過；"FAIL: ..." 或其他錯誤代表未通過。
-- 最後一定會丟出例外，整批 SQL 會回滾，不會留下任何變更。

-- ===== migration: 20261007170000_audit_user_history.sql
-- 用戶編輯紀錄：
-- 1. 組織成員（user_organizations）與成員角色（user_organization_roles）的紀錄以該用戶為所屬對象（parent），
--    讓用戶的編輯紀錄能一次查到個人資料、成員狀態與角色的變更。
-- 2. 個人資料（profiles）沒有組織，同組織的有效成員也能看到彼此個人資料的變更紀錄。

do $$
declare
  member_table text;
begin
  foreach member_table in array array['user_organizations', 'user_organization_roles'] loop
    execute format('drop trigger if exists audit_record_changes on public.%I', member_table);
    execute format(
      'create trigger audit_record_changes after insert or update or delete on public.%I '
      'for each row execute function public.log_record_change(%L, %L)',
      member_table, 'user_id', 'profiles'
    );
  end loop;
end $$;

-- Link the membership and role rows logged so far to their user as well
update public.record_audit_logs
set parent_table = 'profiles',
    parent_id = coalesce(new_data ->> 'user_id', old_data ->> 'user_id')::uuid
where table_name in ('user_organizations', 'user_organization_roles')
  and parent_id is null;

create policy "org_members_read_member_profile_logs" on public.record_audit_logs
  for select to authenticated
  using (
    table_name = 'profiles'
    and record_id in (
      select member.user_id
      from public.user_organizations member
      where member.is_active = true
        and member.organization_id in (
          select mine.organization_id from public.user_organizations mine
          where mine.user_id = auth.uid() and mine.is_active = true
        )
    )
  );

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

-- ===== test: audit_user_history.test.sql
-- 用戶編輯紀錄測試。先載入 _helpers.sql 再執行本檔。

-- Membership and role changes are filed under the user they belong to
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_owner uuid := (fx->>'user_id')::uuid;
  v_member uuid := gen_random_uuid();
  v_role uuid;
  v_logs int;
begin
  insert into auth.users (id, aud, role, email)
  values (v_member, 'authenticated', 'authenticated', 'sql-test-' || v_member || '@example.test');
  select id into v_role from public.organization_roles where organization_id = (fx->>'org_id')::uuid limit 1;

  insert into public.user_organizations (user_id, organization_id, is_active) values (v_member, (fx->>'org_id')::uuid, true);
  insert into public.user_organization_roles (user_id, organization_id, role_id) values (v_member, (fx->>'org_id')::uuid, v_role);

  perform pg_temp.act_as(v_owner);
  update public.user_organizations set is_active = false where user_id = v_member and organization_id = (fx->>'org_id')::uuid;
  execute 'reset role';

  select count(*) into v_logs from public.record_audit_logs
  where parent_id = v_member and parent_table = 'profiles'
    and table_name in ('user_organizations', 'user_organization_roles');
  perform pg_temp.check(v_logs >= 3, 'membership and role rows are filed under the user, got ' || v_logs);
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


-- ===== test: record_audit_logs.test.sql
-- 編輯紀錄（record_audit_logs）測試。先載入 _helpers.sql 再執行本檔。

-- Editing a line item records who changed which fields of which record, under which document
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  entry public.record_audit_logs;
begin
  perform pg_temp.act_as((fx->>'user_id')::uuid);
  update public.order_products set quantity = 80 where id = (fx->>'order_product_id')::uuid;
  execute 'reset role';

  select * into entry from public.record_audit_logs
  where record_id = (fx->>'order_product_id')::uuid and action = 'UPDATE' and changed_by = (fx->>'user_id')::uuid;

  perform pg_temp.check(entry.id is not null, 'updating an order product writes an audit row');
  perform pg_temp.check(entry.table_name = 'order_products', 'audit row names the table');
  perform pg_temp.check(entry.parent_id = (fx->>'order_id')::uuid, 'audit row points at the parent order');
  perform pg_temp.check(entry.organization_id = (fx->>'org_id')::uuid, 'audit row carries the organization of the parent order');
  perform pg_temp.check(entry.changed_fields = array['quantity'], 'only the edited field is listed, got ' || entry.changed_fields::text);
  perform pg_temp.check((entry.old_data->>'quantity')::numeric = 100, 'old value is kept');
  perform pg_temp.check((entry.new_data->>'quantity')::numeric = 80, 'new value is kept');
end $$;

-- Adding and removing a line item are both recorded with the full row
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_item uuid;
  inserted public.record_audit_logs;
  deleted public.record_audit_logs;
begin
  perform pg_temp.act_as(v_user);
  insert into public.order_products (order_id, product_id, quantity, unit_price)
  values ((fx->>'order_id')::uuid, (fx->>'product2_id')::uuid, 30, 12) returning id into v_item;
  delete from public.order_products where id = v_item;
  execute 'reset role';

  select * into inserted from public.record_audit_logs where record_id = v_item and action = 'INSERT';
  select * into deleted from public.record_audit_logs where record_id = v_item and action = 'DELETE';

  perform pg_temp.check(inserted.changed_by = v_user, 'adding a line item is recorded with its editor');
  perform pg_temp.check((inserted.new_data->>'quantity')::numeric = 30, 'the added row is stored in new_data');
  perform pg_temp.check(inserted.parent_id = (fx->>'order_id')::uuid, 'the added row points at its order');
  perform pg_temp.check(deleted.changed_by = v_user, 'removing a line item is recorded with its editor');
  perform pg_temp.check((deleted.old_data->>'unit_price')::numeric = 12, 'the removed row is stored in old_data');
  perform pg_temp.check(deleted.new_data is null, 'a removal has no new_data');
end $$;

-- Updates that only touch bookkeeping columns are not edits
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_count int;
begin
  perform pg_temp.act_as((fx->>'user_id')::uuid);
  update public.order_products set updated_at = now() + interval '1 minute' where id = (fx->>'order_product_id')::uuid;
  update public.order_products set quantity = quantity where id = (fx->>'order_product_id')::uuid;
  execute 'reset role';

  -- Only count this user's updates; fixture setup legitimately changes shipped_quantity/status
  select count(*) into v_count from public.record_audit_logs
  where record_id = (fx->>'order_product_id')::uuid and action = 'UPDATE'
    and changed_by = (fx->>'user_id')::uuid;
  perform pg_temp.check(v_count = 0, 'no-op and updated_at-only updates write nothing, got ' || v_count);
end $$;

-- Line items removed by a cascading delete still carry their organization
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_order uuid;
  v_item uuid;
  entry public.record_audit_logs;
begin
  insert into public.orders (order_number, customer_id, user_id, organization_id)
  values ('TEST', (fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, (fx->>'org_id')::uuid) returning id into v_order;
  insert into public.order_products (order_id, product_id, quantity, unit_price)
  values (v_order, (fx->>'product_id')::uuid, 10, 1) returning id into v_item;

  delete from public.orders where id = v_order;

  select * into entry from public.record_audit_logs where record_id = v_item and action = 'DELETE';
  perform pg_temp.check(entry.id is not null, 'cascaded line item deletion is recorded');
  perform pg_temp.check(entry.organization_id = (fx->>'org_id')::uuid, 'cascaded deletion keeps the organization');
  perform pg_temp.check(entry.parent_id = v_order, 'cascaded deletion keeps the parent order id');
end $$;

-- Only members of the organization can read its trail, and nobody can write to it directly
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_outsider uuid := gen_random_uuid();
  v_member_sees int;
  v_outsider_sees int;
  v_insert_blocked boolean := false;
  v_delete_blocked boolean := false;
begin
  insert into auth.users (id, aud, role, email)
  values (v_outsider, 'authenticated', 'authenticated', 'sql-test-' || v_outsider || '@example.test');
  insert into public.organizations (name, owner_id) values ('其他組織', v_outsider);

  perform pg_temp.act_as((fx->>'user_id')::uuid);
  select count(*) into v_member_sees from public.record_audit_logs where organization_id = (fx->>'org_id')::uuid;
  begin
    insert into public.record_audit_logs (table_name, record_id, action) values ('orders', gen_random_uuid(), 'INSERT');
  exception when insufficient_privilege then
    v_insert_blocked := true;
  end;
  begin
    delete from public.record_audit_logs where organization_id = (fx->>'org_id')::uuid;
  exception when insufficient_privilege then
    v_delete_blocked := true;
  end;

  perform pg_temp.act_as(v_outsider);
  select count(*) into v_outsider_sees from public.record_audit_logs where organization_id = (fx->>'org_id')::uuid;
  execute 'reset role';

  perform pg_temp.check(v_member_sees > 0, 'members can read their organization''s trail');
  perform pg_temp.check(v_outsider_sees = 0, 'other organizations cannot read the trail, saw ' || v_outsider_sees);
  perform pg_temp.check(v_insert_blocked, 'users cannot insert audit rows directly');
  perform pg_temp.check(v_delete_blocked, 'users cannot delete audit rows');
end $$;

-- Profiles have no organization; the person can still see changes to their own profile
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_seen int;
begin
  perform pg_temp.act_as(v_user);
  update public.profiles set full_name = '測試改名' where id = v_user;
  select count(*) into v_seen from public.record_audit_logs
  where table_name = 'profiles' and record_id = v_user and action = 'UPDATE' and 'full_name' = any(changed_fields);
  execute 'reset role';

  perform pg_temp.check(v_seen = 1, 'a profile edit is recorded and visible to its owner, saw ' || v_seen);
end $$;


do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
