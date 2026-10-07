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

do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
