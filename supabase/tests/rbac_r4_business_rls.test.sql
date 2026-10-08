-- RBAC R4：業務資料表依權限鍵的 RLS（docs/MULTI_TENANT_RBAC.md §4.4）。先載入 _helpers.sql 再執行本檔。

-- Run a statement as the given user and return how many rows it touched (or the single integer a query returns)
create or replace function pg_temp.rows_as(user_id uuid, statement text)
returns int language plpgsql as $$
declare
  v_rows int;
begin
  perform pg_temp.act_as(user_id);
  if statement ~* '^\s*select' then
    execute statement into v_rows;
  else
    execute statement;
    get diagnostics v_rows = row_count;
  end if;
  execute 'reset role';
  return v_rows;
end $$;

-- Master tables and documents: viewers read, editors create and edit, nobody deletes, outsiders see nothing
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_outsider uuid := (other->>'user_id')::uuid;
  v_table record;
begin
  for v_table in
    select * from (values
      ('customers', fx->>'customer_id', format('insert into public.customers (name, organization_id) values (%L, %L)', 'R4 客戶', v_org)),
      ('factories', fx->>'factory_id', format('insert into public.factories (name, organization_id) values (%L, %L)', 'R4 工廠', v_org)),
      ('products_new', fx->>'product_id', format('insert into public.products_new (name, user_id, organization_id) values (%L, %L, %L)', 'R4 產品', v_owner, v_org)),
      ('warehouses', fx->>'warehouse_id', format('insert into public.warehouses (name, organization_id) values (%L, %L)', 'R4 倉', v_org)),
      ('orders', fx->>'order_id', format('insert into public.orders (order_number, customer_id, user_id, organization_id) values (%L, %L, %L, %L)', 'temp', fx->>'customer_id', v_owner, v_org)),
      ('purchase_orders', fx->>'po_id', format('insert into public.purchase_orders (factory_id, user_id, organization_id) values (%L, %L, %L)', fx->>'factory_id', v_owner, v_org)),
      ('inventories', fx->>'inventory_id', format('insert into public.inventories (purchase_order_id, factory_id, user_id, organization_id) values (%L, %L, %L, %L)', fx->>'po_id', fx->>'factory_id', v_owner, v_org)),
      ('shippings', fx->>'shipping_id', format('insert into public.shippings (order_id, customer_id, total_shipped_quantity, total_shipped_rolls, user_id, organization_id) values (%L, %L, 0, 0, %L, %L)', fx->>'order_id', fx->>'customer_id', v_owner, v_org))
    ) as t(name, id, insert_sql)
  loop
    perform pg_temp.check(pg_temp.rows_as(v_viewer, format('select count(*)::int from public.%I where id = %L', v_table.name, v_table.id)) = 1,
      v_table.name || ': a viewer can read');
    perform pg_temp.check(pg_temp.rows_as(v_outsider, format('select count(*)::int from public.%I where id = %L', v_table.name, v_table.id)) = 0,
      v_table.name || ': another organization cannot read');

    perform pg_temp.check_raises_as(v_viewer, v_table.insert_sql, 'row-level security', v_table.name || ': a viewer cannot create');
    perform pg_temp.check(pg_temp.rows_as(v_editor, v_table.insert_sql) = 1, v_table.name || ': an editor can create');

    perform pg_temp.check(pg_temp.rows_as(v_viewer, format('update public.%I set organization_id = organization_id where id = %L', v_table.name, v_table.id)) = 0,
      v_table.name || ': a viewer cannot edit');
    perform pg_temp.check(pg_temp.rows_as(v_outsider, format('update public.%I set organization_id = organization_id where id = %L', v_table.name, v_table.id)) = 0,
      v_table.name || ': another organization cannot edit');
    perform pg_temp.check(pg_temp.rows_as(v_editor, format('update public.%I set organization_id = organization_id where id = %L', v_table.name, v_table.id)) = 1,
      v_table.name || ': an editor can edit');
    -- (a product's color is refused by its own trigger first: its product belongs to this organization)
    perform pg_temp.check_raises_as(v_editor, format('update public.%I set organization_id = %L where id = %L', v_table.name, other->>'org_id', v_table.id),
      case when v_table.name = 'products_new' then '找不到此產品' else 'row-level security' end,
      v_table.name || ': a row cannot be moved to another organization');

    -- R5: business data is disabled or cancelled, never deleted, whatever the role
    perform pg_temp.check(pg_temp.rows_as(v_owner, format('delete from public.%I where id = %L', v_table.name, v_table.id)) = 0,
      v_table.name || ': not even the owner can delete');
    perform pg_temp.check(pg_temp.rows_as(v_editor, format('delete from public.%I where id = %L', v_table.name, v_table.id)) = 0,
      v_table.name || ': an editor cannot delete');
  end loop;
end $$;

-- Line items and rolls follow their parent document: editors add, change and remove them, viewers only read
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_outsider uuid := (other->>'user_id')::uuid;
  v_child record;
  v_spare uuid;
begin
  for v_child in
    select * from (values
      ('order_products', fx->>'order_product_id',
        format('insert into public.order_products (order_id, product_id, quantity, unit_price) values (%L, %L, 1, 1)', fx->>'order_id', fx->>'product2_id'),
        'quantity = quantity'),
      ('purchase_order_items', fx->>'po_item_id',
        format('insert into public.purchase_order_items (purchase_order_id, product_id, ordered_quantity, unit_price) values (%L, %L, 1, 1)', fx->>'po_id', fx->>'product2_id'),
        'unit_price = unit_price'),
      ('inventory_rolls', fx->>'roll_id',
        format('insert into public.inventory_rolls (inventory_id, product_id, warehouse_id, roll_number, quantity, current_quantity) values (%L, %L, %L, %L, 1, 1)',
          fx->>'inventory_id', fx->>'product_id', fx->>'warehouse_id', 'R4-' || gen_random_uuid()),
        'shelf = shelf'),
      ('shipping_items', fx->>'shipping_item_id',
        format('insert into public.shipping_items (shipping_id, inventory_roll_id, shipped_quantity) values (%L, %L, 1)', fx->>'shipping_id', fx->>'roll_id'),
        'shipped_quantity = shipped_quantity')
    ) as t(name, id, insert_sql, noop)
  loop
    perform pg_temp.check(pg_temp.rows_as(v_viewer, format('select count(*)::int from public.%I where id = %L', v_child.name, v_child.id)) = 1,
      v_child.name || ': a viewer can read');
    perform pg_temp.check(pg_temp.rows_as(v_outsider, format('select count(*)::int from public.%I where id = %L', v_child.name, v_child.id)) = 0,
      v_child.name || ': another organization cannot read');
    perform pg_temp.check_raises_as(v_viewer, v_child.insert_sql, 'row-level security', v_child.name || ': a viewer cannot add');
    perform pg_temp.check(pg_temp.rows_as(v_viewer, format('update public.%I set %s where id = %L', v_child.name, v_child.noop, v_child.id)) = 0,
      v_child.name || ': a viewer cannot change');
    perform pg_temp.check(pg_temp.rows_as(v_viewer, format('delete from public.%I where id = %L', v_child.name, v_child.id)) = 0,
      v_child.name || ': a viewer cannot remove');
    perform pg_temp.check(pg_temp.rows_as(v_outsider, format('delete from public.%I where id = %L', v_child.name, v_child.id)) = 0,
      v_child.name || ': another organization cannot remove');

    perform pg_temp.check(pg_temp.rows_as(v_editor, v_child.insert_sql) = 1, v_child.name || ': an editor can add');
    perform pg_temp.check(pg_temp.rows_as(v_editor, format('update public.%I set %s where id = %L', v_child.name, v_child.noop, v_child.id)) = 1,
      v_child.name || ': an editor can change');
  end loop;

  -- Editors remove items when they edit a document (here an item nothing else depends on)
  insert into public.order_products (order_id, product_id, quantity, unit_price)
  values ((fx->>'order_id')::uuid, (fx->>'product2_id')::uuid, 5, 5) returning id into v_spare;
  perform pg_temp.check(pg_temp.rows_as(v_editor, format('delete from public.order_products where id = %L', v_spare)) = 1, 'an editor can remove an order item');
end $$;

-- Links between documents stay inside the organization and follow the parent's keys
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
begin
  perform pg_temp.check_raises_as(v_viewer, format('insert into public.order_factories (order_id, factory_id) values (%L, %L)', fx->>'order_id', fx->>'factory_id'),
    'row-level security', 'a viewer cannot assign a factory to an order');
  perform pg_temp.check(pg_temp.rows_as(v_editor, format('insert into public.order_factories (order_id, factory_id) values (%L, %L)', fx->>'order_id', fx->>'factory_id')) = 1,
    'an editor can assign a factory to an order');
  perform pg_temp.check_raises_as(v_editor, format('insert into public.order_factories (order_id, factory_id) values (%L, %L)', fx->>'order_id', other->>'factory_id'),
    'row-level security', 'an order cannot get another organization''s factory');
  perform pg_temp.check(pg_temp.rows_as(v_viewer, format('select count(*)::int from public.order_factories where order_id = %L', fx->>'order_id')) = 1,
    'a viewer sees the order''s factories');
  perform pg_temp.check(pg_temp.rows_as(v_editor, format('delete from public.order_factories where order_id = %L', fx->>'order_id')) = 1,
    'an editor can unassign a factory');

  perform pg_temp.check_raises_as(v_viewer, format('insert into public.purchase_order_relations (purchase_order_id, order_id) values (%L, %L)', fx->>'po_id', fx->>'order_id'),
    'row-level security', 'a viewer cannot link a purchase order to an order');
  perform pg_temp.check(pg_temp.rows_as(v_editor, format('insert into public.purchase_order_relations (purchase_order_id, order_id) values (%L, %L)', fx->>'po_id', fx->>'order_id')) = 1,
    'an editor can link a purchase order to an order');
  perform pg_temp.check_raises_as(v_editor, format('insert into public.purchase_order_relations (purchase_order_id, order_id) values (%L, %L)', fx->>'po_id', other->>'order_id'),
    'row-level security', 'a purchase order cannot be linked to another organization''s order');
  perform pg_temp.check(pg_temp.rows_as(v_viewer, format('select count(*)::int from public.purchase_order_relations where purchase_order_id = %L', fx->>'po_id')) = 1,
    'a viewer sees the purchase order''s linked orders');
end $$;

-- The business APIs keep working for every role that holds the key, and anonymous requests reach nothing
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_seen int;
begin
  perform pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L)', v_org, fx->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 1, 'unit_price', 1))));
  perform pg_temp.call_as(v_editor, format('select public.create_shipping(%L, %L, %L)', v_org, fx->>'order_id',
    jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 1))));
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = (fx->>'roll_id')::uuid) = 59, 'an editor ships through the API');

  -- Views read through the viewer's own permissions
  perform pg_temp.check(pg_temp.rows_as(v_viewer, format('select count(*)::int from public.product_catalog where organization_id = %L', v_org)) = 2,
    'a viewer sees the product catalog');
  perform pg_temp.check(pg_temp.rows_as(v_viewer, format('select count(*)::int from public.inventory_summary where organization_id = %L', v_org)) >= 1,
    'a viewer sees the inventory summary');

  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  execute 'set local role anon';
  select count(*) into v_seen from public.orders where organization_id = v_org;
  execute 'reset role';
  perform pg_temp.check(v_seen = 0, 'anonymous requests see no orders, saw ' || v_seen);
end $$;

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
