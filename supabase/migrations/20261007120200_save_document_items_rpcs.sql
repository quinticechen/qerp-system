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
