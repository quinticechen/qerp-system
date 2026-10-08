-- RBAC R0 安全修補測試（docs/MULTI_TENANT_RBAC.md §2.1）。先載入 _helpers.sql 再執行本檔。

-- S1–S3: an outsider cannot join an organization, grant itself a role, or create roles there
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  outsider jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_out uuid := (outsider->>'user_id')::uuid;
  v_admin_role uuid;
begin
  select id into v_admin_role from public.organization_roles where organization_id = v_org and name = 'admin';

  perform pg_temp.check_raises_as(v_out,
    format('insert into public.user_organizations (user_id, organization_id, is_active) values (%L, %L, true)', v_out, v_org),
    '成員只能經由邀請加入組織', 'S1: an outsider cannot add itself to another organization');
  perform pg_temp.check_raises_as(v_out,
    format('insert into public.user_organization_roles (user_id, organization_id, role_id, granted_by) values (%L, %L, %L, %L)', v_out, v_org, v_admin_role, v_out),
    'row-level security', 'S2: an outsider cannot grant itself a role in another organization');
  perform pg_temp.check_raises_as(v_out,
    format('insert into public.organization_roles (organization_id, name, display_name, permissions) values (%L, %L, %L, %L)', v_org, 'x', 'x', '{"canEditUsers": true}'),
    'row-level security', 'S3: an outsider cannot create a role in another organization');

  perform pg_temp.check(not public.user_has_organization_permission(v_out, v_org, 'canViewOrders'),
    'the outsider has no permission in the organization');
end $$;

-- S2: a member without canEditUsers cannot change roles, its own or others'
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
begin
  perform pg_temp.check_raises_as(v_editor,
    format('select public.set_member_role(%L, %L, %L)', v_org, v_editor, 'admin'),
    '權限不足', 'S2: an editor cannot use set_member_role');
  perform pg_temp.check(not public.user_has_organization_permission(v_editor, v_org, 'canEditUsers'),
    'the editor still lacks canEditUsers');
end $$;

-- S7 (role changes) is covered by rbac_r1_roles.test.sql

-- S4: order_factories and purchase_order_relations are only visible and writable inside the organization
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  outsider jsonb := pg_temp.seed_fixture();
  v_owner uuid := (fx->>'user_id')::uuid;
  v_out uuid := (outsider->>'user_id')::uuid;
  v_order uuid := (fx->>'order_id')::uuid;
  v_po uuid := (fx->>'po_id')::uuid;
  v_factory2 uuid;
  v_seen int;
  v_changed int;
begin
  insert into public.order_factories (order_id, factory_id) values (v_order, (fx->>'factory_id')::uuid);
  insert into public.purchase_order_relations (purchase_order_id, order_id) values (v_po, v_order);
  insert into public.factories (name, organization_id) values ('第二工廠', (fx->>'org_id')::uuid) returning id into v_factory2;

  -- Anonymous requests see and delete nothing
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  execute 'set local role anon';
  select count(*) into v_seen from public.order_factories where order_id = v_order;
  perform pg_temp.check(v_seen = 0, 'S4: anon sees no order_factories, saw ' || v_seen);
  select count(*) into v_seen from public.purchase_order_relations where purchase_order_id = v_po;
  perform pg_temp.check(v_seen = 0, 'S4: anon sees no purchase_order_relations, saw ' || v_seen);
  delete from public.order_factories where order_id = v_order;
  get diagnostics v_changed = row_count;
  perform pg_temp.check(v_changed = 0, 'S4: anon deletes no order_factories, deleted ' || v_changed);
  execute 'reset role';

  -- Another organization's user sees and deletes nothing
  perform pg_temp.act_as(v_out);
  select count(*) into v_seen from public.order_factories where order_id = v_order;
  perform pg_temp.check(v_seen = 0, 'S4: an outsider sees no order_factories, saw ' || v_seen);
  delete from public.purchase_order_relations where purchase_order_id = v_po;
  get diagnostics v_changed = row_count;
  perform pg_temp.check(v_changed = 0, 'S4: an outsider deletes no purchase_order_relations, deleted ' || v_changed);
  execute 'reset role';

  perform pg_temp.check_raises_as(v_out,
    format('insert into public.order_factories (order_id, factory_id) values (%L, %L)', v_order, (outsider->>'factory_id')::uuid),
    'row-level security', 'S4: an outsider cannot attach a factory to another organization''s order');

  -- Members keep working inside their organization
  perform pg_temp.act_as(v_owner);
  select count(*) into v_seen from public.order_factories where order_id = v_order;
  perform pg_temp.check(v_seen = 1, 'S4: a member sees its order_factories, saw ' || v_seen);
  select count(*) into v_seen from public.purchase_order_relations where purchase_order_id = v_po;
  perform pg_temp.check(v_seen = 1, 'S4: a member sees its purchase_order_relations, saw ' || v_seen);
  insert into public.order_factories (order_id, factory_id) values (v_order, v_factory2);
  delete from public.order_factories where order_id = v_order and factory_id = v_factory2;
  get diagnostics v_changed = row_count;
  perform pg_temp.check(v_changed = 1, 'S4: a member can add and remove its order_factories');
  execute 'reset role';

  -- Members cannot link records across organizations
  perform pg_temp.check_raises_as(v_owner,
    format('insert into public.order_factories (order_id, factory_id) values (%L, %L)', v_order, (outsider->>'factory_id')::uuid),
    'row-level security', 'S4: an order cannot be linked to another organization''s factory');
  perform pg_temp.check_raises_as(v_owner,
    format('insert into public.purchase_order_relations (purchase_order_id, order_id) values (%L, %L)', v_po, (outsider->>'order_id')::uuid),
    'row-level security', 'S4: a purchase order cannot be linked to another organization''s order');
end $$;

-- S5: line items are not readable, and shipping rows not writable, across organizations
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  outsider jsonb := pg_temp.seed_fixture();
  v_out uuid := (outsider->>'user_id')::uuid;
  v_seen int;
begin
  perform pg_temp.act_as(v_out);
  select count(*) into v_seen from public.order_products where order_id = (fx->>'order_id')::uuid;
  perform pg_temp.check(v_seen = 0, 'S5: an outsider sees no order_products, saw ' || v_seen);
  select count(*) into v_seen from public.purchase_order_items where purchase_order_id = (fx->>'po_id')::uuid;
  perform pg_temp.check(v_seen = 0, 'S5: an outsider sees no purchase_order_items, saw ' || v_seen);
  execute 'reset role';

  perform pg_temp.check_raises_as(v_out,
    format('insert into public.shipping_items (shipping_id, inventory_roll_id, shipped_quantity) values (%L, %L, 1)', (fx->>'shipping_id')::uuid, (outsider->>'roll_id')::uuid),
    'row-level security', 'S5: an outsider cannot add items to another organization''s shipping');
  perform pg_temp.check_raises_as(v_out,
    format('insert into public.shipment_history (shipping_item_id, product_id, customer_id, quantity, date) values (%L, %L, %L, 1, current_date)',
      (outsider->>'shipping_item_id')::uuid, (outsider->>'product_id')::uuid, (fx->>'customer_id')::uuid),
    'row-level security', 'S5: an outsider cannot write shipment history for another organization''s customer');
end $$;

-- S6: no policy relies on the legacy global is_admin()
do $$
declare
  v_count int;
begin
  select count(*) into v_count from pg_policies
  where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_admin(%';
  perform pg_temp.check(v_count = 0, 'S6: no policy uses is_admin(), found ' || v_count);
end $$;

-- No policy on a public table is unconditionally true (except the user's own query data, which has none)
do $$
declare
  v_list text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into v_list from pg_policies
  where schemaname = 'public' and (qual = 'true' or with_check = 'true');
  perform pg_temp.check(v_list is null, 'no policy is unconditionally true, found: ' || coalesce(v_list, ''));
end $$;

-- Creating an organization still makes the creator an active member with every permission
do $$
declare
  v_user uuid := gen_random_uuid();
  v_org uuid;
  v_member boolean;
begin
  insert into auth.users (id, aud, role, email)
  values (v_user, 'authenticated', 'authenticated', 'sql-test-' || v_user || '@example.test');

  perform pg_temp.act_as(v_user);
  insert into public.organizations (name, owner_id) values ('新組織', v_user) returning id into v_org;
  execute 'reset role';

  select exists (select 1 from public.user_organizations where user_id = v_user and organization_id = v_org and is_active)
  into v_member;
  perform pg_temp.check(v_member, 'the creator is an active member of the new organization');
  perform pg_temp.check(public.user_has_organization_permission(v_user, v_org, 'canEditUsers'), 'the creator has full permissions');
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
