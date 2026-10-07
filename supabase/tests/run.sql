-- 自動產生（build-run.sh），請勿手動修改。
-- 結果為 "ALL TESTS PASSED" 代表通過；"FAIL: ..." 或其他錯誤代表未通過。
-- 最後一定會丟出例外，整批 SQL 會回滾，不會留下任何變更。

-- ===== migration: 20261007120000_record_audit_logs.sql
-- 編輯紀錄：所有業務資料表的新增、修改、刪除都寫入 record_audit_logs，
-- 每筆紀錄包含被修改資料的 uuid、所屬單據 uuid、修改前後內容與編輯者。

create table public.record_audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- No foreign keys: the trail must outlive the records and organizations it describes
  organization_id uuid,
  table_name text not null,
  record_id uuid not null,
  parent_table text,
  parent_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_fields text[] not null default '{}',
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index record_audit_logs_record_idx on public.record_audit_logs (record_id, changed_at desc);
create index record_audit_logs_parent_idx on public.record_audit_logs (parent_id, changed_at desc);
create index record_audit_logs_org_idx on public.record_audit_logs (organization_id, changed_at desc);

alter table public.record_audit_logs enable row level security;

-- Members read their organization's trail; rows without an organization (profiles) are visible
-- to the editor and to the person the record belongs to
create policy "org_members_read_audit_logs" on public.record_audit_logs
  for select to authenticated
  using (
    organization_id in (
      select uo.organization_id from public.user_organizations uo
      where uo.user_id = auth.uid() and uo.is_active = true
    )
    or (organization_id is null and (changed_by = auth.uid() or record_id = auth.uid()))
  );

-- The trail is append-only and written exclusively by the trigger below
revoke insert, update, delete, truncate on public.record_audit_logs from anon, authenticated;

-- Trigger arguments: [0] column holding the parent document id, [1] parent table name
create or replace function public.log_record_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_parent_column text := tg_argv[0];
  v_parent_table text := tg_argv[1];
  v_parent_id uuid;
  v_org uuid;
  v_changed text[] := '{}';
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
    from jsonb_each(v_new) n
    where n.key not in ('updated_at', 'updated_by')
      and n.value is distinct from v_old -> n.key;

    -- Bookkeeping-only updates are not edits
    if cardinality(v_changed) = 0 then
      return null;
    end if;
  end if;

  if v_parent_column is not null then
    v_parent_id := (v_row ->> v_parent_column)::uuid;
  end if;

  if v_row ? 'organization_id' then
    v_org := (v_row ->> 'organization_id')::uuid;
  elsif tg_table_name = 'organizations' then
    v_org := (v_row ->> 'id')::uuid;
  elsif v_parent_id is not null then
    execute format('select organization_id from public.%I where id = $1', v_parent_table)
      into v_org using v_parent_id;
    -- During a cascading delete the parent row is already gone; recover it from the parent's trail
    if v_org is null then
      select l.organization_id into v_org
      from public.record_audit_logs l
      where l.record_id = v_parent_id and l.organization_id is not null
      order by l.changed_at desc
      limit 1;
    end if;
  end if;

  insert into public.record_audit_logs (
    organization_id, table_name, record_id, parent_table, parent_id,
    action, old_data, new_data, changed_fields, changed_by
  ) values (
    v_org, tg_table_name, (v_row ->> 'id')::uuid, v_parent_table, v_parent_id,
    tg_op, v_old, v_new, v_changed, auth.uid()
  );

  return null;
end;
$$;

revoke execute on function public.log_record_change() from public, anon, authenticated;

do $$
declare
  audited record;
begin
  for audited in
    select * from (values
      ('orders', null, null),
      ('order_products', 'order_id', 'orders'),
      ('order_factories', 'order_id', 'orders'),
      ('purchase_orders', null, null),
      ('purchase_order_items', 'purchase_order_id', 'purchase_orders'),
      ('purchase_order_relations', 'purchase_order_id', 'purchase_orders'),
      ('inventories', null, null),
      ('inventory_rolls', 'inventory_id', 'inventories'),
      ('shippings', null, null),
      ('shipping_items', 'shipping_id', 'shippings'),
      ('products_new', null, null),
      ('customers', null, null),
      ('factories', null, null),
      ('warehouses', null, null),
      ('organizations', null, null),
      ('organization_roles', null, null),
      ('user_organizations', null, null),
      ('user_organization_roles', null, null),
      ('profiles', null, null)
    ) as t(table_name, parent_column, parent_table)
  loop
    execute format(
      'create trigger audit_record_changes after insert or update or delete on public.%I '
      'for each row execute function public.log_record_change(%s)',
      audited.table_name,
      case when audited.parent_column is null then ''
           else quote_literal(audited.parent_column) || ', ' || quote_literal(audited.parent_table) end
    );
  end loop;
end $$;

-- ===== migration: 20261007120100_recompute_receipt_and_shipment_status.sql
-- 已入庫量 / 已出貨量與狀態重算：
-- 原本的觸發器只在新增、修改時依 NEW 重算，刪除布卷或出貨項目、或布卷改產品時會留下錯誤數字。
-- 改為依「受影響的採購單 / 訂單」整張重算，並在新增、修改、刪除時都觸發。

create or replace function public.recompute_purchase_order_receipts(p_purchase_order_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_purchase_order_id is null then
    return;
  end if;

  update purchase_order_items poi
  set received_quantity = coalesce((
        select sum(ir.quantity)
        from inventory_rolls ir
        join inventories i on i.id = ir.inventory_id
        where i.purchase_order_id = p_purchase_order_id and ir.product_id = poi.product_id
      ), 0)
  where poi.purchase_order_id = p_purchase_order_id;

  update purchase_order_items
  set status = case
    when received_quantity >= ordered_quantity then 'received'
    when received_quantity > 0 then 'partial_received'
    else 'pending'
  end
  where purchase_order_id = p_purchase_order_id;

  -- Cancelled purchase orders keep their status; one with nothing received falls back to confirmed
  update purchase_orders po
  set status = case
    when not exists (select 1 from purchase_order_items where purchase_order_id = po.id and status <> 'received')
      and exists (select 1 from purchase_order_items where purchase_order_id = po.id)
      then 'completed'::purchase_order_status
    when exists (select 1 from purchase_order_items where purchase_order_id = po.id and status in ('partial_received', 'received'))
      then 'partial_received'::purchase_order_status
    when po.status in ('partial_received', 'partial_arrived', 'completed')
      then 'confirmed'::purchase_order_status
    else po.status
  end
  where po.id = p_purchase_order_id and po.status <> 'cancelled';
end;
$$;

create or replace function public.recompute_order_shipments(p_order_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_order_id is null then
    return;
  end if;

  update order_products op
  set shipped_quantity = coalesce((
        select sum(si.shipped_quantity)
        from shipping_items si
        join shippings s on s.id = si.shipping_id
        join inventory_rolls ir on ir.id = si.inventory_roll_id
        where s.order_id = p_order_id and ir.product_id = op.product_id
      ), 0)
  where op.order_id = p_order_id;

  update order_products
  set status = case
    when shipped_quantity >= quantity then 'shipped'
    when shipped_quantity > 0 then 'partial_shipped'
    else 'pending'
  end
  where order_id = p_order_id;

  update orders o
  set shipping_status = case
    when not exists (select 1 from order_products where order_id = o.id and status <> 'shipped')
      and exists (select 1 from order_products where order_id = o.id)
      then 'shipped'::shipping_status
    when exists (select 1 from order_products where order_id = o.id and status in ('partial_shipped', 'shipped'))
      then 'partial_shipped'::shipping_status
    else 'not_started'::shipping_status
  end
  where o.id = p_order_id;
end;
$$;

-- Rolls: recompute every purchase order the old and new row belong to
create or replace function public.update_purchase_order_item_status()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_po uuid;
  v_new_po uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select purchase_order_id into v_old_po from inventories where id = old.inventory_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select purchase_order_id into v_new_po from inventories where id = new.inventory_id;
  end if;

  perform recompute_purchase_order_receipts(v_new_po);
  if v_old_po is distinct from v_new_po then
    perform recompute_purchase_order_receipts(v_old_po);
  end if;
  return null;
end;
$$;

-- Shipping items: recompute every order the old and new row belong to
create or replace function public.update_order_product_status()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_order uuid;
  v_new_order uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select order_id into v_old_order from shippings where id = old.shipping_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select order_id into v_new_order from shippings where id = new.shipping_id;
  end if;

  perform recompute_order_shipments(v_new_order);
  if v_old_order is distinct from v_new_order then
    perform recompute_order_shipments(v_old_order);
  end if;
  return null;
end;
$$;

-- A roll's product change must also move shipped weight between order items
create or replace function public.recompute_shipments_for_roll()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_order uuid;
begin
  for v_order in
    select distinct s.order_id
    from shipping_items si join shippings s on s.id = si.shipping_id
    where si.inventory_roll_id = new.id
  loop
    perform recompute_order_shipments(v_order);
  end loop;
  return null;
end;
$$;

drop trigger if exists trigger_update_purchase_order_status on public.inventory_rolls;
create trigger trigger_update_purchase_order_status
  after insert or update or delete on public.inventory_rolls
  for each row execute function public.update_purchase_order_item_status();

drop trigger if exists trigger_recompute_shipments_for_roll on public.inventory_rolls;
create trigger trigger_recompute_shipments_for_roll
  after update of product_id on public.inventory_rolls
  for each row execute function public.recompute_shipments_for_roll();

drop trigger if exists trigger_update_order_status on public.shipping_items;
create trigger trigger_update_order_status
  after insert or update or delete on public.shipping_items
  for each row execute function public.update_order_product_status();

revoke execute on function public.recompute_purchase_order_receipts(uuid) from public, anon;
revoke execute on function public.recompute_order_shipments(uuid) from public, anon;

-- ===== migration: 20261007120200_save_document_items_rpcs.sql
-- 編輯單據的產品內容：訂單、採購單、入庫批次、出貨單各一個交易式 RPC。
-- 傳入完整的項目清單：有 id 的更新、沒有 id 的新增、清單中沒有的刪除。
-- 已有後續作業（已採購、已入庫、已出貨）的項目受鎖定規則保護。
-- 以呼叫者身分執行（security invoker），RLS 與編輯紀錄的 auth.uid() 都照常生效。

-- ---------------------------------------------------------------- 訂單

create or replace function public.order_product_is_purchased(p_order_id uuid, p_product_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from purchase_order_items poi
    join purchase_orders po on po.id = poi.purchase_order_id
    where poi.product_id = p_product_id
      and po.status <> 'cancelled'
      and (
        po.order_id = p_order_id
        or exists (
          select 1 from purchase_order_relations r
          where r.purchase_order_id = po.id and r.order_id = p_order_id
        )
      )
  );
$$;

create or replace function public.save_order_items(p_order_id uuid, p_items jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
  v_item record;
  v_existing order_products;
  v_name text;
begin
  select organization_id into v_org from orders where id = p_order_id for update;
  if not found then
    raise exception '找不到訂單，或沒有編輯權限';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception '訂單至少需要一項產品';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(id uuid, product_id uuid, quantity numeric, unit_price numeric, specifications jsonb, total_rolls int)
  loop
    if v_item.product_id is null
      or not exists (select 1 from products_new where id = v_item.product_id and organization_id = v_org) then
      raise exception '請選擇此組織的產品';
    end if;
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception '數量必須大於 0';
    end if;
    if coalesce(v_item.unit_price, 0) < 0 then
      raise exception '單價不可為負數';
    end if;
  end loop;

  -- Removed items
  for v_existing in
    select * from order_products op
    where op.order_id = p_order_id
      and op.id not in (
        select x.id from jsonb_to_recordset(p_items) as x(id uuid) where x.id is not null
      )
  loop
    select name into v_name from products_new where id = v_existing.product_id;
    if coalesce(v_existing.shipped_quantity, 0) > 0 then
      raise exception '產品「%」已出貨，不可刪除', v_name;
    end if;
    if order_product_is_purchased(p_order_id, v_existing.product_id) then
      raise exception '產品「%」已採購，不可刪除', v_name;
    end if;
    delete from order_products where id = v_existing.id;
  end loop;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(id uuid, product_id uuid, quantity numeric, unit_price numeric, specifications jsonb, total_rolls int)
  loop
    if v_item.id is null then
      insert into order_products (order_id, product_id, quantity, unit_price, specifications, total_rolls)
      values (p_order_id, v_item.product_id, v_item.quantity, v_item.unit_price, v_item.specifications, v_item.total_rolls);
      continue;
    end if;

    select * into v_existing from order_products where id = v_item.id and order_id = p_order_id;
    if not found then
      raise exception '訂單項目不屬於此訂單';
    end if;
    select name into v_name from products_new where id = v_existing.product_id;

    if v_item.product_id <> v_existing.product_id then
      if coalesce(v_existing.shipped_quantity, 0) > 0 then
        raise exception '產品「%」已出貨，不可更換產品', v_name;
      end if;
      if order_product_is_purchased(p_order_id, v_existing.product_id) then
        raise exception '產品「%」已採購，不可更換產品', v_name;
      end if;
    end if;
    if v_item.quantity < coalesce(v_existing.shipped_quantity, 0) then
      raise exception '產品「%」的數量不可低於已出貨 % 公斤', v_name, v_existing.shipped_quantity;
    end if;

    update order_products
    set product_id = v_item.product_id,
        quantity = v_item.quantity,
        unit_price = v_item.unit_price,
        specifications = v_item.specifications,
        total_rolls = v_item.total_rolls
    where id = v_item.id;
  end loop;

  -- Quantities changed, so item and order shipping statuses may have changed too
  perform recompute_order_shipments(p_order_id);
end;
$$;

-- ---------------------------------------------------------------- 採購單

create or replace function public.save_purchase_order_items(p_purchase_order_id uuid, p_items jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
  v_item record;
  v_existing purchase_order_items;
  v_name text;
begin
  select organization_id into v_org from purchase_orders where id = p_purchase_order_id for update;
  if not found then
    raise exception '找不到採購單，或沒有編輯權限';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception '採購單至少需要一項產品';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(id uuid, product_id uuid, ordered_quantity numeric, ordered_rolls int, unit_price numeric, specifications jsonb)
  loop
    if v_item.product_id is null
      or not exists (select 1 from products_new where id = v_item.product_id and organization_id = v_org) then
      raise exception '請選擇此組織的產品';
    end if;
    if coalesce(v_item.ordered_quantity, 0) <= 0 then
      raise exception '採購數量必須大於 0';
    end if;
    if coalesce(v_item.unit_price, 0) < 0 then
      raise exception '單價不可為負數';
    end if;
  end loop;

  for v_existing in
    select * from purchase_order_items poi
    where poi.purchase_order_id = p_purchase_order_id
      and poi.id not in (
        select x.id from jsonb_to_recordset(p_items) as x(id uuid) where x.id is not null
      )
  loop
    if coalesce(v_existing.received_quantity, 0) > 0 then
      select name into v_name from products_new where id = v_existing.product_id;
      raise exception '產品「%」已入庫，不可刪除', v_name;
    end if;
    delete from purchase_order_items where id = v_existing.id;
  end loop;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(id uuid, product_id uuid, ordered_quantity numeric, ordered_rolls int, unit_price numeric, specifications jsonb)
  loop
    if v_item.id is null then
      insert into purchase_order_items (purchase_order_id, product_id, ordered_quantity, ordered_rolls, unit_price, specifications)
      values (p_purchase_order_id, v_item.product_id, v_item.ordered_quantity, v_item.ordered_rolls, v_item.unit_price, v_item.specifications);
      continue;
    end if;

    select * into v_existing from purchase_order_items where id = v_item.id and purchase_order_id = p_purchase_order_id;
    if not found then
      raise exception '採購項目不屬於此採購單';
    end if;
    select name into v_name from products_new where id = v_existing.product_id;

    if v_item.product_id <> v_existing.product_id and coalesce(v_existing.received_quantity, 0) > 0 then
      raise exception '產品「%」已入庫，不可更換產品', v_name;
    end if;
    if v_item.ordered_quantity < coalesce(v_existing.received_quantity, 0) then
      raise exception '產品「%」的採購數量不可低於已入庫 % 公斤', v_name, v_existing.received_quantity;
    end if;

    update purchase_order_items
    set product_id = v_item.product_id,
        ordered_quantity = v_item.ordered_quantity,
        ordered_rolls = v_item.ordered_rolls,
        unit_price = v_item.unit_price,
        specifications = v_item.specifications
    where id = v_item.id;
  end loop;

  perform recompute_purchase_order_receipts(p_purchase_order_id);
end;
$$;

-- ---------------------------------------------------------------- 入庫批次

create or replace function public.save_inventory_rolls(p_inventory_id uuid, p_rolls jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
  v_roll record;
  v_existing inventory_rolls;
  v_shipped numeric;
begin
  select organization_id into v_org from inventories where id = p_inventory_id for update;
  if not found then
    raise exception '找不到入庫紀錄，或沒有編輯權限';
  end if;
  if jsonb_array_length(coalesce(p_rolls, '[]')) = 0 then
    raise exception '入庫紀錄至少需要一卷布';
  end if;

  for v_roll in
    select * from jsonb_to_recordset(p_rolls)
      as x(id uuid, product_id uuid, warehouse_id uuid, shelf text, quality fabric_quality,
           quantity numeric, roll_number text, specifications jsonb)
  loop
    if v_roll.product_id is null
      or not exists (select 1 from products_new where id = v_roll.product_id and organization_id = v_org) then
      raise exception '請選擇此組織的產品';
    end if;
    if v_roll.warehouse_id is null
      or not exists (select 1 from warehouses where id = v_roll.warehouse_id and organization_id = v_org) then
      raise exception '請選擇此組織的倉庫';
    end if;
    if coalesce(v_roll.quantity, 0) <= 0 then
      raise exception '布卷重量必須大於 0';
    end if;
    if v_roll.id is null and coalesce(trim(v_roll.roll_number), '') = '' then
      raise exception '新增的布卷需要布卷編號';
    end if;
  end loop;

  for v_existing in
    select * from inventory_rolls ir
    where ir.inventory_id = p_inventory_id
      and ir.id not in (
        select x.id from jsonb_to_recordset(p_rolls) as x(id uuid) where x.id is not null
      )
  loop
    if exists (select 1 from shipping_items where inventory_roll_id = v_existing.id) then
      raise exception '布卷「%」已出貨，不可刪除', v_existing.roll_number;
    end if;
    delete from inventory_rolls where id = v_existing.id;
  end loop;

  for v_roll in
    select * from jsonb_to_recordset(p_rolls)
      as x(id uuid, product_id uuid, warehouse_id uuid, shelf text, quality fabric_quality,
           quantity numeric, roll_number text, specifications jsonb)
  loop
    if v_roll.id is null then
      insert into inventory_rolls (inventory_id, product_id, warehouse_id, shelf, quality, quantity, current_quantity, roll_number, specifications)
      values (p_inventory_id, v_roll.product_id, v_roll.warehouse_id, nullif(trim(v_roll.shelf), ''),
              coalesce(v_roll.quality, 'A'), v_roll.quantity, v_roll.quantity, trim(v_roll.roll_number), v_roll.specifications);
      continue;
    end if;

    select * into v_existing from inventory_rolls where id = v_roll.id and inventory_id = p_inventory_id;
    if not found then
      raise exception '布卷不屬於此入庫紀錄';
    end if;

    if v_roll.product_id <> v_existing.product_id
      and exists (select 1 from shipping_items where inventory_roll_id = v_existing.id) then
      raise exception '布卷「%」已出貨，不可更換產品', v_existing.roll_number;
    end if;

    -- Shipped weight stays fixed; current stock follows the corrected received weight
    v_shipped := v_existing.quantity - v_existing.current_quantity;
    if v_roll.quantity < v_shipped then
      raise exception '布卷「%」的入庫重量不可低於已出貨 % 公斤', v_existing.roll_number, v_shipped;
    end if;

    update inventory_rolls
    set product_id = v_roll.product_id,
        warehouse_id = v_roll.warehouse_id,
        shelf = nullif(trim(v_roll.shelf), ''),
        quality = coalesce(v_roll.quality, v_existing.quality),
        quantity = v_roll.quantity,
        current_quantity = v_roll.quantity - v_shipped,
        is_allocated = (v_roll.quantity - v_shipped) <= 0,
        specifications = v_roll.specifications
    where id = v_roll.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- 出貨單

create or replace function public.save_shipping_items(p_shipping_id uuid, p_items jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
  v_order uuid;
  v_item record;
  v_change record;
  v_roll inventory_rolls;
begin
  select organization_id, order_id into v_org, v_order from shippings where id = p_shipping_id for update;
  if not found then
    raise exception '找不到出貨單，或沒有編輯權限';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception '出貨單至少需要一卷布';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(id uuid, inventory_roll_id uuid, shipped_quantity numeric)
  loop
    if coalesce(v_item.shipped_quantity, 0) <= 0 then
      raise exception '出貨重量必須大於 0';
    end if;
    select ir.* into v_roll
    from inventory_rolls ir join inventories i on i.id = ir.inventory_id
    where ir.id = v_item.inventory_roll_id and i.organization_id = v_org;
    if not found then
      raise exception '請選擇此組織的布卷';
    end if;
    if not exists (select 1 from order_products where order_id = v_order and product_id = v_roll.product_id) then
      raise exception '布卷「%」的產品不在此訂單中', v_roll.roll_number;
    end if;
    if v_item.id is not null
      and not exists (select 1 from shipping_items where id = v_item.id and shipping_id = p_shipping_id) then
      raise exception '出貨項目不屬於此出貨單';
    end if;
  end loop;

  -- Apply only the net change per roll to stock, so unchanged rolls are not touched
  for v_change in
    with old_totals as (
      select inventory_roll_id as roll_id, sum(shipped_quantity) as qty
      from shipping_items where shipping_id = p_shipping_id group by 1
    ),
    new_totals as (
      select x.inventory_roll_id as roll_id, sum(x.shipped_quantity) as qty
      from jsonb_to_recordset(p_items) as x(inventory_roll_id uuid, shipped_quantity numeric) group by 1
    )
    select coalesce(o.roll_id, n.roll_id) as roll_id, coalesce(n.qty, 0) - coalesce(o.qty, 0) as delta
    from old_totals o full join new_totals n on n.roll_id = o.roll_id
  loop
    continue when v_change.delta = 0;
    select * into v_roll from inventory_rolls where id = v_change.roll_id for update;
    if v_roll.current_quantity - v_change.delta < 0 then
      raise exception '布卷「%」庫存不足，最多可再出貨 % 公斤', v_roll.roll_number, v_roll.current_quantity;
    end if;
    update inventory_rolls
    set current_quantity = current_quantity - v_change.delta,
        is_allocated = (current_quantity - v_change.delta) <= 0
    where id = v_change.roll_id;
  end loop;

  delete from shipping_items si
  where si.shipping_id = p_shipping_id
    and si.id not in (
      select x.id from jsonb_to_recordset(p_items) as x(id uuid) where x.id is not null
    );

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(id uuid, inventory_roll_id uuid, shipped_quantity numeric)
  loop
    if v_item.id is null then
      insert into shipping_items (shipping_id, inventory_roll_id, shipped_quantity)
      values (p_shipping_id, v_item.inventory_roll_id, v_item.shipped_quantity);
    else
      update shipping_items
      set inventory_roll_id = v_item.inventory_roll_id,
          shipped_quantity = v_item.shipped_quantity
      where id = v_item.id;
    end if;
  end loop;

  update shippings s
  set total_shipped_quantity = t.qty,
      total_shipped_rolls = t.rolls
  from (
    select coalesce(sum(shipped_quantity), 0) as qty, count(distinct inventory_roll_id)::int as rolls
    from shipping_items where shipping_id = p_shipping_id
  ) t
  where s.id = p_shipping_id;
end;
$$;

revoke execute on function public.order_product_is_purchased(uuid, uuid) from public, anon;
revoke execute on function public.save_order_items(uuid, jsonb) from public, anon;
revoke execute on function public.save_purchase_order_items(uuid, jsonb) from public, anon;
revoke execute on function public.save_inventory_rolls(uuid, jsonb) from public, anon;
revoke execute on function public.save_shipping_items(uuid, jsonb) from public, anon;
grant execute on function public.order_product_is_purchased(uuid, uuid) to authenticated;
grant execute on function public.save_order_items(uuid, jsonb) to authenticated;
grant execute on function public.save_purchase_order_items(uuid, jsonb) to authenticated;
grant execute on function public.save_inventory_rolls(uuid, jsonb) to authenticated;
grant execute on function public.save_shipping_items(uuid, jsonb) to authenticated;

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


-- ===== test: status_recompute.test.sql
-- 已入庫量、已出貨量與單據狀態的重算測試。先載入 _helpers.sql 再執行本檔。
-- Fixture: order item 100kg, PO item 100kg fully received by one roll, 40kg of that roll shipped.

-- Removing a shipped roll from a shipping takes it back off the order
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_item public.order_products;
  v_shipping_status text;
begin
  delete from public.shipping_items where id = (fx->>'shipping_item_id')::uuid;

  select * into v_item from public.order_products where id = (fx->>'order_product_id')::uuid;
  select shipping_status into v_shipping_status from public.orders where id = (fx->>'order_id')::uuid;

  perform pg_temp.check(v_item.shipped_quantity = 0, 'shipped quantity drops back to 0, got ' || v_item.shipped_quantity);
  perform pg_temp.check(v_item.status = 'pending', 'order item returns to pending, got ' || v_item.status);
  perform pg_temp.check(v_shipping_status = 'not_started', 'order returns to not_started, got ' || v_shipping_status);
end $$;

-- Changing a roll's product moves its weight from one purchase item to the other
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_po_item2 uuid;
  v_first public.purchase_order_items;
  v_second public.purchase_order_items;
begin
  insert into public.purchase_order_items (purchase_order_id, product_id, ordered_quantity, unit_price)
  values ((fx->>'po_id')::uuid, (fx->>'product2_id')::uuid, 100, 5) returning id into v_po_item2;

  update public.inventory_rolls set product_id = (fx->>'product2_id')::uuid where id = (fx->>'roll_id')::uuid;

  select * into v_first from public.purchase_order_items where id = (fx->>'po_item_id')::uuid;
  select * into v_second from public.purchase_order_items where id = v_po_item2;

  perform pg_temp.check(v_first.received_quantity = 0, 'the old product loses the received weight, got ' || v_first.received_quantity);
  perform pg_temp.check(v_first.status = 'pending', 'the old product returns to pending, got ' || v_first.status);
  perform pg_temp.check(v_second.received_quantity = 100, 'the new product gains the received weight, got ' || v_second.received_quantity);
  perform pg_temp.check(v_second.status = 'received', 'the new product is received, got ' || v_second.status);
end $$;

-- Deleting a roll takes its weight off the purchase order
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_extra_roll uuid;
  v_item public.purchase_order_items;
  v_po_status text;
begin
  update public.purchase_order_items set ordered_quantity = 150 where id = (fx->>'po_item_id')::uuid;
  insert into public.inventory_rolls (inventory_id, product_id, warehouse_id, roll_number, quantity, current_quantity)
  values ((fx->>'inventory_id')::uuid, (fx->>'product_id')::uuid, (fx->>'warehouse_id')::uuid, 'T2-' || (fx->>'user_id'), 50, 50)
  returning id into v_extra_roll;

  delete from public.inventory_rolls where id = v_extra_roll;

  select * into v_item from public.purchase_order_items where id = (fx->>'po_item_id')::uuid;
  select status into v_po_status from public.purchase_orders where id = (fx->>'po_id')::uuid;

  perform pg_temp.check(v_item.received_quantity = 100, 'received weight drops back to 100, got ' || v_item.received_quantity);
  perform pg_temp.check(v_item.status = 'partial_received', 'item is partially received, got ' || v_item.status);
  perform pg_temp.check(v_po_status = 'partial_received', 'purchase order is partially received, got ' || v_po_status);
end $$;

-- A purchase order with nothing received any more falls back to confirmed; cancelled ones are left alone
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  fx2 jsonb := pg_temp.seed_fixture();
  v_status text;
  v_cancelled_status text;
begin
  -- Rolls that were shipped cannot be deleted, so detach the shipment first
  delete from public.shipping_items where id = (fx->>'shipping_item_id')::uuid;
  delete from public.inventory_rolls where id = (fx->>'roll_id')::uuid;
  select status into v_status from public.purchase_orders where id = (fx->>'po_id')::uuid;

  update public.purchase_orders set status = 'cancelled' where id = (fx2->>'po_id')::uuid;
  update public.inventory_rolls set quantity = 90 where id = (fx2->>'roll_id')::uuid;
  select status into v_cancelled_status from public.purchase_orders where id = (fx2->>'po_id')::uuid;

  perform pg_temp.check(v_status = 'confirmed', 'empty purchase order falls back to confirmed, got ' || v_status);
  perform pg_temp.check(v_cancelled_status = 'cancelled', 'cancelled purchase order stays cancelled, got ' || v_cancelled_status);
end $$;


-- ===== test: save_document_items.test.sql
-- 單據產品內容編輯 RPC 測試。先載入 _helpers.sql 再執行本檔。
-- Fixture: order item (product 1, 100kg, 40kg shipped) purchased on a PO item (100kg, fully received
-- by one 100kg roll); a shipping takes 40kg from that roll, leaving 60kg in stock.

-- ======================================================== save_order_items

-- One save updates, adds and removes order items, and is recorded under the order
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_order uuid := (fx->>'order_id')::uuid;
  v_extra uuid;
  v_item public.order_products;
  v_count int;
  v_logged int;
begin
  insert into public.order_products (order_id, product_id, quantity, unit_price)
  values (v_order, (fx->>'product2_id')::uuid, 5, 1) returning id into v_extra;

  perform pg_temp.act_as(v_user);
  perform public.save_order_items(v_order, jsonb_build_array(
    jsonb_build_object('id', fx->>'order_product_id', 'product_id', fx->>'product_id', 'quantity', 120, 'unit_price', 11),
    jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 30, 'unit_price', 12)
  ));
  execute 'reset role';

  select * into v_item from public.order_products where id = (fx->>'order_product_id')::uuid;
  perform pg_temp.check(v_item.quantity = 120 and v_item.unit_price = 11, 'existing item is updated');
  perform pg_temp.check(v_item.status = 'partial_shipped', 'item status reflects 40 of 120 shipped, got ' || v_item.status);
  perform pg_temp.check(not exists (select 1 from public.order_products where id = v_extra), 'item left out of the list is removed');
  select count(*) into v_count from public.order_products where order_id = v_order and product_id = (fx->>'product2_id')::uuid and quantity = 30;
  perform pg_temp.check(v_count = 1, 'new item is added');

  select count(*) into v_logged from public.record_audit_logs
  where parent_id = v_order and changed_by = v_user and table_name = 'order_products';
  perform pg_temp.check(v_logged >= 3, 'update, insert and delete are all recorded under the order, got ' || v_logged);
end $$;

-- Shipped and purchased order items are protected
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_order uuid := (fx->>'order_id')::uuid;
  v_item2 uuid;
begin
  perform pg_temp.check_raises_as(v_user,
    format('select public.save_order_items(%L, %L)', v_order, jsonb_build_array(
      jsonb_build_object('id', fx->>'order_product_id', 'product_id', fx->>'product_id', 'quantity', 30, 'unit_price', 10))),
    '不可低於已出貨 40', 'quantity cannot drop below what has been shipped');

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_order_items(%L, %L)', v_order, jsonb_build_array(
      jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 30, 'unit_price', 10))),
    '已出貨，不可刪除', 'a shipped item cannot be removed');

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_order_items(%L, %L)', v_order, jsonb_build_array(
      jsonb_build_object('id', fx->>'order_product_id', 'product_id', fx->>'product2_id', 'quantity', 100, 'unit_price', 10))),
    '已出貨，不可更換產品', 'a shipped item cannot switch product');

  -- An unshipped item whose product is on this order's purchase order is locked too
  insert into public.order_products (order_id, product_id, quantity, unit_price)
  values (v_order, (fx->>'product2_id')::uuid, 20, 1) returning id into v_item2;
  insert into public.purchase_order_items (purchase_order_id, product_id, ordered_quantity, unit_price)
  values ((fx->>'po_id')::uuid, (fx->>'product2_id')::uuid, 20, 1);

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_order_items(%L, %L)', v_order, jsonb_build_array(
      jsonb_build_object('id', fx->>'order_product_id', 'product_id', fx->>'product_id', 'quantity', 100, 'unit_price', 10))),
    '已採購，不可刪除', 'a purchased item cannot be removed');

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_order_items(%L, %L)', v_order, '[]'::jsonb),
    '至少需要一項產品', 'an order keeps at least one item');

  perform pg_temp.check(
    (select quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 100,
    'rejected saves leave the order untouched');
end $$;

-- ======================================================== save_purchase_order_items

do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_po uuid := (fx->>'po_id')::uuid;
  v_status text;
begin
  perform pg_temp.act_as(v_user);
  perform public.save_purchase_order_items(v_po, jsonb_build_array(
    jsonb_build_object('id', fx->>'po_item_id', 'product_id', fx->>'product_id', 'ordered_quantity', 100, 'unit_price', 6),
    jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 50, 'ordered_rolls', 2, 'unit_price', 4)
  ));
  execute 'reset role';

  perform pg_temp.check((select unit_price from public.purchase_order_items where id = (fx->>'po_item_id')::uuid) = 6, 'existing item is updated');
  perform pg_temp.check(exists (select 1 from public.purchase_order_items where purchase_order_id = v_po and product_id = (fx->>'product2_id')::uuid and ordered_quantity = 50), 'new item is added');
  select status into v_status from public.purchase_orders where id = v_po;
  perform pg_temp.check(v_status = 'partial_received', 'adding an unreceived item makes the PO partially received, got ' || v_status);

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_purchase_order_items(%L, %L)', v_po, jsonb_build_array(
      jsonb_build_object('id', fx->>'po_item_id', 'product_id', fx->>'product_id', 'ordered_quantity', 80, 'unit_price', 6))),
    '不可低於已入庫 100', 'ordered quantity cannot drop below what has been received');

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_purchase_order_items(%L, %L)', v_po, jsonb_build_array(
      jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 50, 'unit_price', 4))),
    '已入庫，不可刪除', 'a received item cannot be removed');

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_purchase_order_items(%L, %L)', v_po, jsonb_build_array(
      jsonb_build_object('id', fx->>'po_item_id', 'product_id', fx->>'product2_id', 'ordered_quantity', 100, 'unit_price', 6))),
    '已入庫，不可更換產品', 'a received item cannot switch product');
end $$;

-- ======================================================== save_inventory_rolls

do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_inventory uuid := (fx->>'inventory_id')::uuid;
  v_spare uuid;
  v_roll public.inventory_rolls;
begin
  insert into public.inventory_rolls (inventory_id, product_id, warehouse_id, roll_number, quantity, current_quantity)
  values (v_inventory, (fx->>'product_id')::uuid, (fx->>'warehouse_id')::uuid, 'SP-' || v_user, 10, 10) returning id into v_spare;

  perform pg_temp.act_as(v_user);
  perform public.save_inventory_rolls(v_inventory, jsonb_build_array(
    jsonb_build_object('id', fx->>'roll_id', 'product_id', fx->>'product_id', 'warehouse_id', fx->>'warehouse_id',
                       'quality', 'B', 'shelf', 'C-01', 'quantity', 90),
    jsonb_build_object('product_id', fx->>'product2_id', 'warehouse_id', fx->>'warehouse_id',
                       'quality', 'A', 'quantity', 25, 'roll_number', 'NEW-' || v_user)
  ));
  execute 'reset role';

  select * into v_roll from public.inventory_rolls where id = (fx->>'roll_id')::uuid;
  perform pg_temp.check(v_roll.quantity = 90 and v_roll.current_quantity = 50, 'weight edit keeps the 40kg shipped, got current ' || v_roll.current_quantity);
  perform pg_temp.check(v_roll.quality = 'B' and v_roll.shelf = 'C-01', 'quality and shelf are updated');
  perform pg_temp.check(not exists (select 1 from public.inventory_rolls where id = v_spare), 'roll left out of the list is removed');
  perform pg_temp.check(exists (select 1 from public.inventory_rolls where roll_number = 'NEW-' || v_user and current_quantity = 25), 'new roll is added with full stock');

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_inventory_rolls(%L, %L)', v_inventory, jsonb_build_array(
      jsonb_build_object('id', fx->>'roll_id', 'product_id', fx->>'product_id', 'warehouse_id', fx->>'warehouse_id', 'quantity', 30))),
    '不可低於已出貨 40', 'received weight cannot drop below what has been shipped');

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_inventory_rolls(%L, %L)', v_inventory, jsonb_build_array(
      jsonb_build_object('product_id', fx->>'product_id', 'warehouse_id', fx->>'warehouse_id', 'quantity', 5, 'roll_number', 'X-' || v_user))),
    '已出貨，不可刪除', 'a shipped roll cannot be removed');

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_inventory_rolls(%L, %L)', v_inventory, jsonb_build_array(
      jsonb_build_object('id', fx->>'roll_id', 'product_id', fx->>'product2_id', 'warehouse_id', fx->>'warehouse_id', 'quantity', 90))),
    '已出貨，不可更換產品', 'a shipped roll cannot switch product');
end $$;

-- ======================================================== save_shipping_items

do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_shipping uuid := (fx->>'shipping_id')::uuid;
  v_roll2 uuid;
  v_shipping_row public.shippings;
  v_untouched_logs int;
begin
  insert into public.inventory_rolls (inventory_id, product_id, warehouse_id, roll_number, quantity, current_quantity)
  values ((fx->>'inventory_id')::uuid, (fx->>'product_id')::uuid, (fx->>'warehouse_id')::uuid, 'S2-' || v_user, 30, 30)
  returning id into v_roll2;

  -- 40 -> 50 on the first roll, plus 10 from a second roll
  perform pg_temp.act_as(v_user);
  perform public.save_shipping_items(v_shipping, jsonb_build_array(
    jsonb_build_object('id', fx->>'shipping_item_id', 'inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 50),
    jsonb_build_object('inventory_roll_id', v_roll2, 'shipped_quantity', 10)
  ));
  execute 'reset role';

  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = (fx->>'roll_id')::uuid) = 50, 'first roll gives 10kg more');
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = v_roll2) = 20, 'second roll gives 10kg');
  select * into v_shipping_row from public.shippings where id = v_shipping;
  perform pg_temp.check(v_shipping_row.total_shipped_quantity = 60 and v_shipping_row.total_shipped_rolls = 2, 'shipping totals are recalculated');
  perform pg_temp.check((select shipped_quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 60, 'order shipped quantity follows');

  -- Dropping the second roll returns its stock; the unchanged first roll is not rewritten
  perform pg_temp.act_as(v_user);
  perform public.save_shipping_items(v_shipping, jsonb_build_array(
    jsonb_build_object('id', fx->>'shipping_item_id', 'inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 50)
  ));
  execute 'reset role';

  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = v_roll2) = 30, 'removed roll gets its stock back');
  select count(*) into v_untouched_logs from public.record_audit_logs
  where record_id = (fx->>'roll_id')::uuid and changed_by = v_user;
  perform pg_temp.check(v_untouched_logs = 1, 'an unchanged roll is not rewritten on the second save, got ' || v_untouched_logs);

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_shipping_items(%L, %L)', v_shipping, jsonb_build_array(
      jsonb_build_object('id', fx->>'shipping_item_id', 'inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 200))),
    '庫存不足', 'cannot ship more than the roll holds');
end $$;

-- Rolls of products that are not on the order cannot be shipped
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_user uuid := (fx->>'user_id')::uuid;
  v_other_roll uuid;
begin
  insert into public.inventory_rolls (inventory_id, product_id, warehouse_id, roll_number, quantity, current_quantity)
  values ((fx->>'inventory_id')::uuid, (fx->>'product2_id')::uuid, (fx->>'warehouse_id')::uuid, 'O-' || v_user, 30, 30)
  returning id into v_other_roll;

  perform pg_temp.check_raises_as(v_user,
    format('select public.save_shipping_items(%L, %L)', fx->>'shipping_id', jsonb_build_array(
      jsonb_build_object('id', fx->>'shipping_item_id', 'inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 40),
      jsonb_build_object('inventory_roll_id', v_other_roll, 'shipped_quantity', 5))),
    '的產品不在此訂單中', 'only rolls of ordered products can be shipped');
end $$;

-- Another organization cannot edit these documents
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  outsider jsonb := pg_temp.seed_fixture();
begin
  perform pg_temp.check_raises_as((outsider->>'user_id')::uuid,
    format('select public.save_order_items(%L, %L)', fx->>'order_id', jsonb_build_array(
      jsonb_build_object('id', fx->>'order_product_id', 'product_id', fx->>'product_id', 'quantity', 999, 'unit_price', 1))),
    '找不到訂單，或沒有編輯權限', 'an outsider cannot edit the order');
  perform pg_temp.check((select quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 100, 'order is untouched by the outsider');
end $$;


do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
