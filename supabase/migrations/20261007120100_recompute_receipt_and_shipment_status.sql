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
