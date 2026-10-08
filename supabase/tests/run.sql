-- 自動產生（build-run.sh），請勿手動修改。
-- 結果為 "ALL TESTS PASSED" 代表通過；"FAIL: ..." 或其他錯誤代表未通過。
-- 最後一定會丟出例外，整批 SQL 會回滾，不會留下任何變更。

-- ===== migration: 20261009000604_api_a5_shipping.sql
-- 業務 API A5 出貨單（docs/BUSINESS_API.md §3、§5，決策 B3）
--
-- 1. 出貨單新增狀態（shipped／cancelled）、cancelled_at、cancel_reason；訂單出貨進度只計算未取消的出貨單；
--    取消訂單時只看未取消的出貨單
-- 2. save_shipping_items 的錯誤改為 SQLSTATE＋HINT 代碼（訊息與規則不變）；已取消的出貨單不能修改
-- 3. create_shipping、update_shipping、cancel_shipping：
--    - 編號 O＋YYYYMMDD＋四位流水號（B8）；客戶沿用訂單；已取消的訂單不能出貨
--    - 扣庫存、檢查布卷庫存、更新訂單出貨進度在同一個交易完成；超過訂單量仍可出貨，摘要會列出
--    - 取消出貨：布卷庫存加回、訂單出貨進度重算；出貨項目保留作為紀錄

-- ===== 1. 出貨單狀態

ALTER TABLE public.shippings ADD COLUMN status text NOT NULL DEFAULT 'shipped' CHECK (status IN ('shipped', 'cancelled'));
ALTER TABLE public.shippings ADD COLUMN cancelled_at timestamptz;
ALTER TABLE public.shippings ADD COLUMN cancel_reason text;

-- Same as before, but cancelled shippings no longer count towards what an order has shipped
CREATE OR REPLACE FUNCTION public.recompute_order_shipments(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
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
        where s.order_id = p_order_id and s.status <> 'cancelled' and ir.product_id = op.product_id
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
$function$;

-- ===== 2. save_shipping_items：錯誤代碼

CREATE OR REPLACE FUNCTION public.save_shipping_items(p_shipping_id uuid, p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_order uuid;
  v_status text;
  v_number text;
  v_item record;
  v_change record;
  v_roll inventory_rolls;
begin
  select organization_id, order_id, status, shipping_number into v_org, v_order, v_status, v_number
  from shippings where id = p_shipping_id for update;
  if not found then
    raise exception '找不到出貨單，或沒有編輯權限' using errcode = 'P0002', hint = 'shipping_not_found';
  end if;
  if v_status = 'cancelled' then
    raise exception '出貨單 % 已取消，不能修改', v_number using errcode = '55000', hint = 'shipping_cancelled';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception '出貨單至少需要一卷布' using errcode = '22023', hint = 'items_required';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(id uuid, inventory_roll_id uuid, shipped_quantity numeric)
  loop
    if coalesce(v_item.shipped_quantity, 0) <= 0 then
      raise exception '出貨重量必須大於 0' using errcode = '22023', hint = 'invalid_quantity';
    end if;
    select ir.* into v_roll
    from inventory_rolls ir join inventories i on i.id = ir.inventory_id
    where ir.id = v_item.inventory_roll_id and i.organization_id = v_org;
    if not found then
      raise exception '請選擇此組織的布卷' using errcode = 'P0002', hint = 'roll_not_found';
    end if;
    if not exists (select 1 from order_products where order_id = v_order and product_id = v_roll.product_id) then
      raise exception '布卷「%」的產品不在此訂單中', v_roll.roll_number using errcode = '22023', hint = 'roll_not_in_order';
    end if;
    if v_item.id is not null
      and not exists (select 1 from shipping_items where id = v_item.id and shipping_id = p_shipping_id) then
      raise exception '出貨項目不屬於此出貨單' using errcode = 'P0002', hint = 'item_not_found';
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
      raise exception '布卷「%」庫存不足，最多可再出貨 % 公斤', v_roll.roll_number, v_roll.current_quantity
        using errcode = '55000', hint = 'insufficient_stock';
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
      -- clock_timestamp() rather than now(): items added in one call keep the order they were given in
      insert into shipping_items (shipping_id, inventory_roll_id, shipped_quantity, created_at)
      values (p_shipping_id, v_item.inventory_roll_id, v_item.shipped_quantity, clock_timestamp());
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
$function$;

-- ===== 3. 輔助函式

-- 「R2610080001 產品 - 顏色 40 公斤」 for a shipped roll
CREATE FUNCTION public.api_shipped_roll_label(p_roll_id uuid, p_quantity numeric)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT ir.roll_number || ' ' || public.api_product_label(ir.product_id) || ' ' || public.api_number(p_quantity) || ' 公斤'
  FROM public.inventory_rolls ir WHERE ir.id = p_roll_id;
$function$;

-- Card fields describing a whole shipping: order, customer, date, weight per product, note, totals,
-- and any order line shipped beyond what was ordered
CREATE FUNCTION public.api_shipping_fields(p_shipping_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT public.api_fields('訂單', o.order_number, '客戶', c.name, '出貨日期', s.shipping_date::text)
    || coalesce((
         SELECT jsonb_agg(jsonb_build_object('label', '產品 ' || rn,
                  'value', public.api_product_label(product_id) || ' × ' || rolls || ' 卷，共 ' || public.api_number(qty) || ' 公斤') ORDER BY rn)
         FROM (SELECT ir.product_id, count(DISTINCT si.inventory_roll_id) AS rolls, sum(si.shipped_quantity) AS qty,
                      row_number() OVER (ORDER BY min(si.created_at)) AS rn
               FROM public.shipping_items si JOIN public.inventory_rolls ir ON ir.id = si.inventory_roll_id
               WHERE si.shipping_id = s.id GROUP BY ir.product_id) per_product
       ), '[]'::jsonb)
    || public.api_fields(
         '備註', s.note,
         '合計', s.total_shipped_rolls || ' 卷，' || public.api_number(s.total_shipped_quantity) || ' 公斤')
    || coalesce((
         SELECT jsonb_agg(jsonb_build_object('label', '超過訂單量',
                  'value', public.api_product_label(op.product_id) || ' 已出貨 ' || public.api_number(op.shipped_quantity)
                    || ' 公斤，訂購 ' || public.api_number(op.quantity) || ' 公斤')
                  ORDER BY op.created_at)
         FROM public.order_products op
         WHERE op.order_id = s.order_id AND op.shipped_quantity > op.quantity
           AND EXISTS (SELECT 1 FROM public.shipping_items si JOIN public.inventory_rolls ir ON ir.id = si.inventory_roll_id
                       WHERE si.shipping_id = s.id AND ir.product_id = op.product_id)
       ), '[]'::jsonb)
  FROM public.shippings s
  JOIN public.orders o ON o.id = s.order_id
  JOIN public.customers c ON c.id = s.customer_id
  WHERE s.id = p_shipping_id;
$function$;

-- ===== 4. 出貨 API

-- p_items: [{ inventory_roll_id, shipped_quantity }]
CREATE FUNCTION public.create_shipping(
  p_organization_id uuid,
  p_order_id uuid,
  p_items jsonb,
  p_shipping_date date DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_id uuid;
  v_number text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateShipping');

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此訂單' USING ERRCODE = 'P0002', HINT = 'order_not_found';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION '訂單 % 已取消，不能出貨', v_order.order_number USING ERRCODE = '55000', HINT = 'order_cancelled';
  END IF;

  -- Write for real; a dry run rolls this block back after collecting the summary
  BEGIN
    v_number := public.api_next_document_number(p_organization_id, 'shipping');
    INSERT INTO public.shippings (shipping_number, order_id, customer_id, organization_id, user_id, shipping_date, note,
                                  total_shipped_quantity, total_shipped_rolls)
    VALUES (v_number, p_order_id, v_order.customer_id, p_organization_id, auth.uid(),
            coalesce(p_shipping_date, (now() AT TIME ZONE 'Asia/Taipei')::date), public.api_clean(p_note), 0, 0)
    RETURNING id INTO v_id;

    PERFORM public.save_shipping_items(v_id, public.api_order_items_payload(p_items, false));

    v_fields := public.api_shipping_fields(v_id);
    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, NULL, NULL, '建立出貨單', v_fields);
  END;

  RETURN public.api_result(false, v_id, v_number, '建立出貨單', v_fields);
END;
$function$;

-- p_changes may hold: items (the complete list, as save_shipping_items expects), shipping_date, note
CREATE FUNCTION public.update_shipping(
  p_organization_id uuid,
  p_shipping_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.shippings%ROWTYPE;
  v_new public.shippings%ROWTYPE;
  v_old_items jsonb;
  v_date date;
  v_fields jsonb;
  v_title text;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditShipping');
  PERFORM public.api_check_change_keys(p_changes, ARRAY['items', 'shipping_date', 'note']);

  SELECT * INTO v_old FROM public.shippings WHERE id = p_shipping_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此出貨單' USING ERRCODE = 'P0002', HINT = 'shipping_not_found';
  END IF;
  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION '出貨單 % 已取消，不能修改', v_old.shipping_number USING ERRCODE = '55000', HINT = 'shipping_cancelled';
  END IF;
  v_date := CASE WHEN p_changes ? 'shipping_date' THEN coalesce(public.api_date(p_changes->>'shipping_date'), v_old.shipping_date) ELSE v_old.shipping_date END;

  SELECT coalesce(jsonb_object_agg(si.id, jsonb_build_object('roll_id', si.inventory_roll_id, 'quantity', si.shipped_quantity)), '{}')
  INTO v_old_items FROM public.shipping_items si WHERE si.shipping_id = p_shipping_id;
  v_title := format('修改出貨單 %s', v_old.shipping_number);

  BEGIN
    IF p_changes ? 'items' THEN
      PERFORM public.save_shipping_items(p_shipping_id, public.api_order_items_payload(p_changes->'items', true));
    END IF;

    UPDATE public.shippings
    SET shipping_date = v_date, note = public.api_changed(p_changes, 'note', note)
    WHERE id = p_shipping_id
    RETURNING * INTO v_new;

    v_fields := public.api_changed_fields('出貨日期', v_old.shipping_date::text, v_new.shipping_date::text, '備註', v_old.note, v_new.note)
      || coalesce((
           SELECT jsonb_agg(jsonb_build_object('label', '移除布卷', 'value',
                    public.api_shipped_roll_label((old.value->>'roll_id')::uuid, (old.value->>'quantity')::numeric)))
           FROM jsonb_each(v_old_items) AS old
           WHERE NOT EXISTS (SELECT 1 FROM public.shipping_items WHERE id = old.key::uuid)
         ), '[]'::jsonb)
      || coalesce((
           SELECT jsonb_agg(jsonb_build_object('label', '修改布卷', 'value',
                    public.api_shipped_roll_label((old.value->>'roll_id')::uuid, (old.value->>'quantity')::numeric)
                    || ' → ' || public.api_shipped_roll_label(si.inventory_roll_id, si.shipped_quantity)) ORDER BY si.created_at)
           FROM jsonb_each(v_old_items) AS old JOIN public.shipping_items si ON si.id = old.key::uuid
           WHERE si.inventory_roll_id <> (old.value->>'roll_id')::uuid OR si.shipped_quantity <> (old.value->>'quantity')::numeric
         ), '[]'::jsonb)
      || coalesce((
           SELECT jsonb_agg(jsonb_build_object('label', '新增布卷', 'value', public.api_shipped_roll_label(si.inventory_roll_id, si.shipped_quantity))
                  ORDER BY si.created_at)
           FROM public.shipping_items si
           WHERE si.shipping_id = p_shipping_id AND NOT v_old_items ? si.id::text
         ), '[]'::jsonb);

    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, p_shipping_id, v_old.shipping_number, v_title, v_fields);
  END;

  RETURN public.api_result(false, p_shipping_id, v_old.shipping_number, v_title, v_fields);
END;
$function$;

-- Cancelling puts the shipped weight back on each roll and recalculates the order's shipping progress (B3)
CREATE FUNCTION public.cancel_shipping(
  p_organization_id uuid,
  p_shipping_id uuid,
  p_reason text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.shippings%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditShipping');

  SELECT * INTO v_old FROM public.shippings WHERE id = p_shipping_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此出貨單' USING ERRCODE = 'P0002', HINT = 'shipping_not_found';
  END IF;
  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION '出貨單 % 已取消', v_old.shipping_number USING ERRCODE = '55000', HINT = 'shipping_already_cancelled';
  END IF;

  v_title := format('取消出貨單 %s', v_old.shipping_number);
  v_fields := public.api_changed_fields('狀態', '已出貨', '已取消')
    || public.api_fields(
         '歸還庫存', v_old.total_shipped_rolls || ' 卷，' || public.api_number(v_old.total_shipped_quantity) || ' 公斤',
         '取消原因', public.api_clean(p_reason));
  IF p_dry_run THEN
    RETURN public.api_result(true, p_shipping_id, v_old.shipping_number, v_title, v_fields);
  END IF;

  UPDATE public.inventory_rolls ir
  SET current_quantity = ir.current_quantity + t.qty,
      is_allocated = (ir.current_quantity + t.qty) <= 0
  FROM (SELECT inventory_roll_id, sum(shipped_quantity) AS qty FROM public.shipping_items
        WHERE shipping_id = p_shipping_id GROUP BY inventory_roll_id) t
  WHERE ir.id = t.inventory_roll_id;

  UPDATE public.shippings
  SET status = 'cancelled', cancelled_at = now(), cancel_reason = public.api_clean(p_reason)
  WHERE id = p_shipping_id;

  PERFORM public.recompute_order_shipments(v_old.order_id);

  RETURN public.api_result(false, p_shipping_id, v_old.shipping_number, v_title, v_fields);
END;
$function$;

-- ===== 5. 取消訂單：只看未取消的出貨單（其餘與 A2 相同）

CREATE OR REPLACE FUNCTION public.cancel_order(
  p_organization_id uuid,
  p_order_id uuid,
  p_reason text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.orders%ROWTYPE;
  v_po_number text;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditOrders');

  SELECT * INTO v_old FROM public.orders WHERE id = p_order_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此訂單' USING ERRCODE = 'P0002', HINT = 'order_not_found';
  END IF;
  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION '訂單 % 已取消', v_old.order_number USING ERRCODE = '55000', HINT = 'order_already_cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shippings WHERE order_id = p_order_id AND status <> 'cancelled') THEN
    RAISE EXCEPTION '訂單 % 已有出貨紀錄，不能取消', v_old.order_number USING ERRCODE = '55000', HINT = 'order_has_shipments';
  END IF;

  SELECT po.po_number INTO v_po_number
  FROM public.purchase_orders po
  WHERE po.status <> 'cancelled'
    AND (po.order_id = p_order_id
         OR EXISTS (SELECT 1 FROM public.purchase_order_relations r WHERE r.purchase_order_id = po.id AND r.order_id = p_order_id))
  ORDER BY po.created_at
  LIMIT 1;
  IF v_po_number IS NOT NULL THEN
    RAISE EXCEPTION '訂單 % 有進行中的採購單 %，請先取消採購單', v_old.order_number, v_po_number
      USING ERRCODE = '55000', HINT = 'order_has_purchase_orders';
  END IF;

  v_title := format('取消訂單 %s', v_old.order_number);
  v_fields := public.api_changed_fields('訂單狀態', public.api_order_status_label(v_old.status::text), '已取消')
    || public.api_fields('取消原因', public.api_clean(p_reason));
  IF p_dry_run THEN
    RETURN public.api_result(true, p_order_id, v_old.order_number, v_title, v_fields);
  END IF;

  UPDATE public.orders
  SET status = 'cancelled', cancelled_at = now(), cancel_reason = public.api_clean(p_reason)
  WHERE id = p_order_id;

  RETURN public.api_result(false, p_order_id, v_old.order_number, v_title, v_fields);
END;
$function$;

REVOKE ALL ON FUNCTION public.api_shipped_roll_label(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_shipping_fields(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_shipping(uuid, uuid, jsonb, date, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_shipping(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_shipping(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shipping(uuid, uuid, jsonb, date, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_shipping(uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_shipping(uuid, uuid, text, boolean) TO authenticated;

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
-- (docs/BUSINESS_API.md §2.3): the given SQLSTATE and HINT code
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

-- ===== test: api_a1_customers_factories.test.sql
-- 業務 API A1：客戶與工廠（docs/BUSINESS_API.md）。先載入 _helpers.sql 再執行本檔。

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


-- ===== test: api_a2_orders.test.sql
-- 業務 API A2：訂單（docs/BUSINESS_API.md）。先載入 _helpers.sql 再執行本檔。

-- Add an active factory to an organization (test setup)
create or replace function pg_temp.add_factory(org_id uuid, factory_name text, active boolean default true)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.factories (name, organization_id, is_active) values (factory_name, org_id, active) returning id into v_id;
  return v_id;
end $$;

-- create_order writes the order, its lines and factories in one go and numbers it within the organization
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_prefix text := 'B' || to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD');
  v_items jsonb;
  v_result jsonb;
  v_second jsonb;
  v_other jsonb;
  v_order public.orders%rowtype;
begin
  v_items := jsonb_build_array(
    jsonb_build_object('product_id', fx->>'product_id', 'quantity', 100, 'unit_price', 12.5, 'total_rolls', 4),
    jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 20, 'unit_price', 30));

  v_result := pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L, array[%L]::uuid[], %L)',
    v_org, fx->>'customer_id', v_items, fx->>'factory_id', '急件'));
  select * into v_order from public.orders where id = (v_result->>'id')::uuid;

  perform pg_temp.check(v_result->>'number' = v_prefix || '0001', 'the first order of the day is B<date>0001, got ' || coalesce(v_result->>'number', 'none'));
  perform pg_temp.check(v_order.order_number = v_result->>'number' and v_order.organization_id = v_org, 'the order is stored with its number');
  perform pg_temp.check(v_order.status = 'pending' and v_order.user_id = v_editor and v_order.note = '急件', 'the order starts pending and records its creator');
  perform pg_temp.check((select count(*) from public.order_products where order_id = v_order.id) = 2, 'both lines are stored');
  perform pg_temp.check(exists (select 1 from public.order_factories where order_id = v_order.id and factory_id = (fx->>'factory_id')::uuid), 'the factory is assigned');

  perform pg_temp.check(v_result->'summary'->>'title' = '建立訂單', 'the summary has a title');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '客戶', 'value', '測試客戶'),
      jsonb_build_object('label', '品項 1', 'value', public.api_product_label((fx->>'product_id')::uuid) || ' × 100 公斤，單價 12.5'),
      jsonb_build_object('label', '指定工廠', 'value', '測試工廠'),
      jsonb_build_object('label', '訂單總額', 'value', '1850')),
    'the summary describes customer, lines, factory and total, got ' || (v_result->'summary'->'fields')::text);

  v_second := pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L)', v_org, fx->>'customer_id', v_items));
  perform pg_temp.check(v_second->>'number' = v_prefix || '0002', 'the next order is 0002, got ' || coalesce(v_second->>'number', 'none'));

  -- Numbers are counted per organization (Phase 0 F14)
  v_other := pg_temp.call_as((other->>'user_id')::uuid, format('select public.create_order(%L, %L, %L)', other->>'org_id', other->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'quantity', 1, 'unit_price', 1))));
  perform pg_temp.check(v_other->>'number' = v_prefix || '0001', 'another organization starts its own numbering, got ' || coalesce(v_other->>'number', 'none'));
end $$;

-- A dry run validates, describes and numbers nothing: no rows, no audit trail, no gap in the numbering
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'unit_price', 5));
  v_orders int;
  v_logs int;
  v_preview jsonb;
  v_real jsonb;
begin
  select count(*) into v_orders from public.orders where organization_id = v_org;
  select count(*) into v_logs from public.record_audit_logs where organization_id = v_org;

  v_preview := pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L, p_note => %L, p_dry_run => true)',
    v_org, fx->>'customer_id', v_items, '試算'));
  perform pg_temp.check((v_preview->>'dry_run')::boolean and v_preview->>'id' is null and v_preview->>'number' is null, 'a dry run has no id or number');
  perform pg_temp.check((select count(*) from public.orders where organization_id = v_org) = v_orders, 'a dry run stores no order');
  perform pg_temp.check((select count(*) from public.record_audit_logs where organization_id = v_org) = v_logs, 'a dry run leaves no audit trail');

  v_real := pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L, p_note => %L)', v_org, fx->>'customer_id', v_items, '試算'));
  perform pg_temp.check(v_preview->'summary' = v_real->'summary', 'the dry run shows the same summary as the real call');
  perform pg_temp.check(v_real->>'number' like 'B%0001', 'the dry run did not use up a number, got ' || (v_real->>'number'));
end $$;

-- create_order rules
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_line jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'unit_price', 5));
  v_inactive_factory uuid := pg_temp.add_factory((fx->>'org_id')::uuid, '停用工廠', false);
  v_call text := 'select public.create_order(%L, %L, %L, %L::uuid[], p_dry_run => true)';
begin
  perform pg_temp.check_api_error_as(v_viewer, format(v_call, v_org, fx->>'customer_id', v_line, '{}'), '42501', 'forbidden', 'a viewer cannot create orders');
  perform pg_temp.check_api_error_as((other->>'user_id')::uuid, format(v_call, v_org, fx->>'customer_id', v_line, '{}'), '42501', 'forbidden', 'an outsider cannot create orders here');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, other->>'customer_id', v_line, '{}'), 'P0002', 'customer_not_found', 'another organization''s customer is not found');

  update public.customers set is_active = false where id = (fx->>'customer_id')::uuid;
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id', v_line, '{}'), '22023', 'customer_inactive', 'a disabled customer gets no new orders');
  update public.customers set is_active = true where id = (fx->>'customer_id')::uuid;

  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id', '[]', '{}'), '22023', 'items_required', 'an order needs a line');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'quantity', 1, 'unit_price', 1)), '{}'),
    'P0002', 'product_not_found', 'another organization''s product is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 0, 'unit_price', 1)), '{}'),
    '22023', 'invalid_quantity', 'quantities must be positive');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 1, 'unit_price', -1)), '{}'),
    '22023', 'invalid_unit_price', 'prices cannot be negative');

  update public.products_new set status = 'Unavailable' where id = (fx->>'product_id')::uuid;
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id', v_line, '{}'), '22023', 'product_unavailable', 'disabled products cannot be ordered');
  update public.products_new set status = 'Available' where id = (fx->>'product_id')::uuid;

  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id', v_line, array[other->>'factory_id']::text),
    'P0002', 'factory_not_found', 'another organization''s factory is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'customer_id', v_line, array[v_inactive_factory]::text),
    '22023', 'factory_inactive', 'a disabled factory cannot be assigned');
end $$;

-- update_order changes only what is given and lists every change, including line changes
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_factory2 uuid := pg_temp.add_factory((fx->>'org_id')::uuid, '第二工廠');
  v_order uuid;
  v_line_id uuid;
  v_changes jsonb;
  v_preview jsonb;
  v_result jsonb;
  v_row public.orders%rowtype;
begin
  v_order := (pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'customer_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'unit_price', 5)), fx->>'factory_id'))->>'id')::uuid;
  select id into v_line_id from public.order_products where order_id = v_order;

  v_changes := jsonb_build_object(
    'note', '改為急件',
    'payment_status', 'partial_paid',
    'factory_ids', jsonb_build_array(v_factory2),
    'items', jsonb_build_array(
      jsonb_build_object('id', v_line_id, 'product_id', fx->>'product_id', 'quantity', 15, 'unit_price', 5),
      jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 3, 'unit_price', 9)));

  v_preview := pg_temp.call_as(v_editor, format('select public.update_order(%L, %L, %L, true)', v_org, v_order, v_changes));
  perform pg_temp.check((select note from public.orders where id = v_order) is null, 'a dry run changes nothing');
  perform pg_temp.check((select count(*) from public.order_products where order_id = v_order) = 1, 'a dry run adds no line');

  v_result := pg_temp.call_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, v_order, v_changes));
  select * into v_row from public.orders where id = v_order;
  perform pg_temp.check(v_row.note = '改為急件' and v_row.payment_status = 'partial_paid' and v_row.status = 'pending', 'given fields change, others stay');
  perform pg_temp.check((select array_agg(factory_id) from public.order_factories where order_id = v_order) = array[v_factory2], 'factories are replaced');
  perform pg_temp.check((select quantity from public.order_products where id = v_line_id) = 15, 'the line is updated');
  perform pg_temp.check(v_preview->'summary' = v_result->'summary', 'the dry run shows the same summary as the real call');
  perform pg_temp.check(v_result->>'number' = v_row.order_number and v_result->'summary'->>'title' = '修改訂單 ' || v_row.order_number, 'the result names the order');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '付款狀態', 'value', '未付款 → 部分付款'),
      jsonb_build_object('label', '指定工廠', 'value', '測試工廠 → 第二工廠'),
      jsonb_build_object('label', '備註', 'value', '（空白） → 改為急件'),
      jsonb_build_object('label', '修改品項', 'value',
        public.api_product_label((fx->>'product_id')::uuid) || ' × 10 公斤，單價 5 → ' || public.api_product_label((fx->>'product_id')::uuid) || ' × 15 公斤，單價 5'),
      jsonb_build_object('label', '新增品項', 'value', public.api_product_label((fx->>'product2_id')::uuid) || ' × 3 公斤，單價 9')),
    'the summary lists every change, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, v_order, '{"status": "cancelled"}'),
    '22023', 'use_cancel_order', 'cancelling goes through cancel_order');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, v_order, '{"status": "shipped"}'),
    '22023', 'invalid_status', 'only order statuses are accepted');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, v_order, '{"customer_id": "x"}'),
    '22023', 'unknown_field', 'only order fields can be changed');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_order(%L, %L, %L)', v_org, v_order, '{"note": "x"}'),
    '42501', 'forbidden', 'a viewer cannot edit orders');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, other->>'order_id', '{"note": "x"}'),
    'P0002', 'order_not_found', 'another organization''s order is not found');

  -- The fixture order has 40kg shipped on its line: the existing lock rules come back with error codes
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, fx->>'order_id',
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', fx->>'order_product_id', 'product_id', fx->>'product_id', 'quantity', 30, 'unit_price', 10)))),
    '55000', 'quantity_below_shipped', 'a line cannot drop below what has shipped');
end $$;

-- cancel_order refuses orders with shipments or live purchase orders; cancelled orders are frozen
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_line jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'unit_price', 5));
  v_order uuid;
  v_po_order uuid;
  v_result jsonb;
  v_row public.orders%rowtype;
begin
  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, fx->>'order_id'),
    '55000', 'order_has_shipments', 'an order with shipments cannot be cancelled');

  v_po_order := (pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L)', v_org, fx->>'customer_id', v_line))->>'id')::uuid;
  insert into public.purchase_orders (factory_id, user_id, organization_id, order_id) values ((fx->>'factory_id')::uuid, v_editor, v_org, v_po_order);
  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, v_po_order),
    '55000', 'order_has_purchase_orders', 'an order with a live purchase order cannot be cancelled');

  v_order := (pg_temp.call_as(v_editor, format('select public.create_order(%L, %L, %L)', v_org, fx->>'customer_id', v_line))->>'id')::uuid;
  perform pg_temp.check_api_error_as(v_viewer, format('select public.cancel_order(%L, %L)', v_org, v_order), '42501', 'forbidden', 'a viewer cannot cancel orders');

  v_result := pg_temp.call_as(v_editor, format('select public.cancel_order(%L, %L, %L, true)', v_org, v_order, '客戶取消'));
  perform pg_temp.check((select status from public.orders where id = v_order) = 'pending', 'a dry run does not cancel');
  perform pg_temp.check(v_result->'summary'->'fields' = '[{"label": "訂單狀態", "value": "待確認 → 已取消"}, {"label": "取消原因", "value": "客戶取消"}]',
    'the summary shows the cancellation, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.call_as(v_editor, format('select public.cancel_order(%L, %L, %L)', v_org, v_order, '客戶取消'));
  select * into v_row from public.orders where id = v_order;
  perform pg_temp.check(v_row.status = 'cancelled' and v_row.cancel_reason = '客戶取消' and v_row.cancelled_at is not null, 'the order is cancelled with its reason');

  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, v_order), '55000', 'order_already_cancelled', 'an order is cancelled once');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_order(%L, %L, %L)', v_org, v_order, '{"note": "x"}'),
    '55000', 'order_cancelled', 'a cancelled order cannot be edited');
end $$;

-- Documents members write directly (not yet through an API) are always numbered by the system, within the organization
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_owner uuid := (fx->>'user_id')::uuid;
  v_date text := to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD');
  v_po text;
  v_order text;
  v_placeholder text;
  v_receipt text;
begin
  perform pg_temp.act_as(v_owner);
  insert into public.purchase_orders (factory_id, user_id, organization_id) values ((fx->>'factory_id')::uuid, v_owner, v_org) returning po_number into v_po;
  insert into public.orders (order_number, customer_id, user_id, organization_id) values ('temp', (fx->>'customer_id')::uuid, v_owner, v_org) returning order_number into v_order;
  -- The AI create_order tool sends a made-up number; the system number replaces it, as it always has
  insert into public.orders (order_number, customer_id, user_id, organization_id) values ('ORD-1728000000000', (fx->>'customer_id')::uuid, v_owner, v_org) returning order_number into v_placeholder;
  insert into public.inventories (purchase_order_id, factory_id, user_id, organization_id)
  values ((fx->>'po_id')::uuid, (fx->>'factory_id')::uuid, v_owner, v_org) returning receipt_number into v_receipt;
  execute 'reset role';

  -- seed_fixture already created today's first purchase order and receiving batch for this organization
  perform pg_temp.check(v_po = 'P' || v_date || '0002', 'a purchase order inserted by a member is numbered, got ' || coalesce(v_po, 'none'));
  perform pg_temp.check(v_receipt = 'I' || v_date || '0002', 'a receiving batch inserted by a member is numbered, got ' || coalesce(v_receipt, 'none'));
  perform pg_temp.check(v_order = 'B' || v_date || '0001', 'an order inserted with a placeholder is numbered, got ' || coalesce(v_order, 'none'));
  perform pg_temp.check(v_placeholder = 'B' || v_date || '0002', 'a number chosen by the client is replaced, got ' || coalesce(v_placeholder, 'none'));
  perform pg_temp.check(not exists (select 1 from public.inventories where receipt_number is null), 'every receiving batch has a number');

  perform pg_temp.check(not has_function_privilege('authenticated', 'public.api_next_document_number(uuid, text)', 'EXECUTE'), 'numbering is internal');
  perform pg_temp.check_api_error_as((other->>'user_id')::uuid, format('select public.api_assign_document_number(%L, %L)', v_org, 'order'),
    '42501', 'forbidden', 'nobody can read another organization''s numbering');
end $$;


-- ===== test: api_a3_purchase_orders.test.sql
-- 業務 API A3：採購單（docs/BUSINESS_API.md）。先載入 _helpers.sql 再執行本檔。

-- Add an active factory to an organization (test setup; same as in api_a2_orders.test.sql)
create or replace function pg_temp.add_factory(org_id uuid, factory_name text, active boolean default true)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.factories (name, organization_id, is_active) values (factory_name, org_id, active) returning id into v_id;
  return v_id;
end $$;

-- create_purchase_order writes the purchase order, its items and linked orders, numbers it and marks the orders
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_date text := to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD');
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_order uuid;
  v_items jsonb;
  v_result jsonb;
  v_po public.purchase_orders%rowtype;
  v_other jsonb;
begin
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'confirmed') returning id into v_order;

  v_items := jsonb_build_array(
    jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 200, 'unit_price', 4.5, 'ordered_rolls', 8),
    jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 50, 'unit_price', 6));

  v_result := pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[], %L, %L)',
    v_org, fx->>'factory_id', v_items, v_order, v_today + 14, '先做白色'));
  select * into v_po from public.purchase_orders where id = (v_result->>'id')::uuid;

  -- seed_fixture already created today's first purchase order for this organization
  perform pg_temp.check(v_result->>'number' = 'P' || v_date || '0002', 'the purchase order is numbered P<date>, got ' || coalesce(v_result->>'number', 'none'));
  perform pg_temp.check(v_po.po_number = v_result->>'number' and v_po.organization_id = v_org and v_po.user_id = v_editor, 'the purchase order is stored with its number and creator');
  perform pg_temp.check(v_po.status = 'confirmed' and v_po.order_date = v_today and v_po.expected_arrival_date = v_today + 14 and v_po.note = '先做白色',
    'the purchase order is placed today with its arrival date and note');
  perform pg_temp.check((select count(*) from public.purchase_order_items where purchase_order_id = v_po.id) = 2, 'both items are stored');
  perform pg_temp.check(exists (select 1 from public.purchase_order_items where purchase_order_id = v_po.id and product_id = (fx->>'product_id')::uuid
      and ordered_quantity = 200 and ordered_rolls = 8 and unit_price = 4.5 and status = 'pending'), 'an item keeps its quantity, rolls and price');
  perform pg_temp.check(exists (select 1 from public.purchase_order_relations where purchase_order_id = v_po.id and order_id = v_order), 'the order is linked');
  perform pg_temp.check((select status from public.orders where id = v_order) = 'factory_ordered', 'the linked order becomes 已向工廠下單');

  perform pg_temp.check(v_result->'summary'->>'title' = '建立採購單', 'the summary has a title');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '工廠', 'value', '測試工廠'),
      jsonb_build_object('label', '關聯訂單', 'value', (select order_number from public.orders where id = v_order)),
      jsonb_build_object('label', '品項 1', 'value', public.api_product_label((fx->>'product_id')::uuid) || ' × 200 公斤，單價 4.5'),
      jsonb_build_object('label', '預計到貨日期', 'value', (v_today + 14)::text),
      jsonb_build_object('label', '採購總額', 'value', '1200')),
    'the summary describes factory, orders, items, arrival and total, got ' || (v_result->'summary'->'fields')::text);

  v_other := pg_temp.call_as((other->>'user_id')::uuid, format('select public.create_purchase_order(%L, %L, %L)', other->>'org_id', other->>'factory_id',
    jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'ordered_quantity', 1, 'unit_price', 1))));
  perform pg_temp.check(v_other->>'number' = 'P' || v_date || '0002', 'another organization counts its own numbers, got ' || coalesce(v_other->>'number', 'none'));
end $$;

-- A dry run stores nothing, does not touch the linked orders and shows the same summary
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_order uuid;
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 10, 'unit_price', 5));
  v_pos int;
  v_logs int;
  v_preview jsonb;
  v_real jsonb;
begin
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'pending') returning id into v_order;
  select count(*) into v_pos from public.purchase_orders where organization_id = v_org;
  select count(*) into v_logs from public.record_audit_logs where organization_id = v_org;

  v_preview := pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[], p_dry_run => true)',
    v_org, fx->>'factory_id', v_items, v_order));
  perform pg_temp.check((v_preview->>'dry_run')::boolean and v_preview->>'id' is null and v_preview->>'number' is null, 'a dry run has no id or number');
  perform pg_temp.check((select count(*) from public.purchase_orders where organization_id = v_org) = v_pos, 'a dry run stores no purchase order');
  perform pg_temp.check((select count(*) from public.record_audit_logs where organization_id = v_org) = v_logs, 'a dry run leaves no audit trail');
  perform pg_temp.check((select status from public.orders where id = v_order) = 'pending', 'a dry run leaves the order alone');

  v_real := pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id', v_items, v_order));
  perform pg_temp.check(v_preview->'summary' = v_real->'summary', 'the dry run shows the same summary as the real call');
end $$;

-- create_purchase_order refuses bad input and needs canCreatePurchases
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 10, 'unit_price', 5));
  v_inactive uuid;
  v_cancelled uuid;
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_call text := 'select public.create_purchase_order(%L, %L, %L)';
begin
  insert into public.factories (name, organization_id, is_active) values ('停用工廠', v_org, false) returning id into v_inactive;
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'cancelled') returning id into v_cancelled;

  perform pg_temp.check_api_error_as(v_viewer, format(v_call, v_org, fx->>'factory_id', v_items), '42501', 'forbidden', 'a viewer cannot create purchase orders');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, other->>'org_id', other->>'factory_id', v_items), '42501', 'forbidden',
    'nobody can create purchase orders in another organization');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, other->>'factory_id', v_items), 'P0002', 'factory_not_found',
    'another organization''s factory is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, v_inactive, v_items), '22023', 'factory_inactive', 'a disabled factory gets no new purchase orders');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'factory_id', '[]'), '22023', 'items_required', 'a purchase order needs an item');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'factory_id',
      jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'ordered_quantity', 1, 'unit_price', 1))),
    'P0002', 'product_not_found', 'another organization''s product is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'factory_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 0, 'unit_price', 1))),
    '22023', 'invalid_quantity', 'the quantity must be positive');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'factory_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 1, 'unit_price', -1))),
    '22023', 'invalid_unit_price', 'the price cannot be negative');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id', v_items, other->>'order_id'),
    'P0002', 'order_not_found', 'another organization''s order is not found');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id', v_items, v_cancelled),
    '55000', 'order_cancelled', 'a cancelled order cannot be purchased for');
  perform pg_temp.check_api_error_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, p_expected_arrival_date => %L)', v_org, fx->>'factory_id', v_items, v_today - 1),
    '22023', 'invalid_expected_arrival_date', 'the arrival date cannot be before the order date');

  update public.products_new set status = 'Unavailable' where id = (fx->>'product_id')::uuid;
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'factory_id', v_items), '22023', 'product_unavailable', 'a disabled product cannot be purchased');
end $$;

-- update_purchase_order changes items, dates, note and linked orders, respecting what has been received
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_first uuid;
  v_second uuid;
  v_po uuid;
  v_number text;
  v_item uuid;
  v_preview jsonb;
  v_result jsonb;
  v_changes jsonb;
begin
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'confirmed') returning id into v_first;
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'confirmed') returning id into v_second;

  v_po := (pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 100, 'unit_price', 5)), v_first))->>'id')::uuid;
  select po_number into v_number from public.purchase_orders where id = v_po;
  select id into v_item from public.purchase_order_items where purchase_order_id = v_po;

  v_changes := jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('id', v_item, 'product_id', fx->>'product_id', 'ordered_quantity', 120, 'unit_price', 5),
      jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 30, 'unit_price', 8)),
    'order_ids', jsonb_build_array(v_second),
    'expected_arrival_date', (v_today + 7)::text,
    'note', '改量');

  v_preview := pg_temp.call_as(v_editor, format('select public.update_purchase_order(%L, %L, %L, true)', v_org, v_po, v_changes));
  perform pg_temp.check((select ordered_quantity from public.purchase_order_items where id = v_item) = 100, 'a dry run changes nothing');
  perform pg_temp.check((select status from public.orders where id = v_second) = 'confirmed', 'a dry run links no order');

  v_result := pg_temp.call_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, v_changes));
  perform pg_temp.check(v_preview->'summary' = v_result->'summary', 'the dry run shows the same summary');
  perform pg_temp.check(v_result->'summary'->>'title' = '修改採購單 ' || v_number and v_result->>'number' = v_number, 'the summary names the purchase order');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '預計到貨日期', 'value', '（空白） → ' || (v_today + 7)::text),
      jsonb_build_object('label', '備註', 'value', '（空白） → 改量'),
      jsonb_build_object('label', '修改品項', 'value', public.api_product_label((fx->>'product_id')::uuid) || ' × 100 公斤，單價 5 → '
        || public.api_product_label((fx->>'product_id')::uuid) || ' × 120 公斤，單價 5'),
      jsonb_build_object('label', '新增品項', 'value', public.api_product_label((fx->>'product2_id')::uuid) || ' × 30 公斤，單價 8')),
    'the summary lists the changes, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.check((select ordered_quantity from public.purchase_order_items where id = v_item) = 120, 'the item is updated');
  perform pg_temp.check((select count(*) from public.purchase_order_items where purchase_order_id = v_po) = 2, 'the new item is added');
  perform pg_temp.check((select status from public.orders where id = v_second) = 'factory_ordered', 'a newly linked order becomes 已向工廠下單');
  perform pg_temp.check((select status from public.orders where id = v_first) = 'confirmed', 'an unlinked order without other purchase orders goes back to 已確認');
  perform pg_temp.check(not exists (select 1 from public.purchase_order_relations where purchase_order_id = v_po and order_id = v_first), 'the old order is unlinked');

  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"note":"x"}'),
    '42501', 'forbidden', 'a viewer cannot edit purchase orders');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"status":"cancelled"}'),
    '22023', 'use_cancel_purchase_order', 'cancelling goes through cancel_purchase_order');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"status":"partial_arrived"}'),
    '22023', 'invalid_status', 'only the listed statuses can be set');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"expected_arrival_date":"明天"}'),
    '22023', 'invalid_date', 'dates must be dates');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"po_number":"x"}'),
    '22023', 'unknown_field', 'the number cannot be changed');

  -- The fixture's purchase order has goods received: the received item is locked and the factory cannot change
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, fx->>'po_id',
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 1, 'unit_price', 1)))),
    '55000', 'item_received', 'a received item cannot be removed');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, fx->>'po_id',
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', fx->>'po_item_id', 'product_id', fx->>'product_id', 'ordered_quantity', 50, 'unit_price', 5)))),
    '55000', 'quantity_below_received', 'the quantity cannot drop below what was received');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, fx->>'po_id',
      jsonb_build_object('factory_id', gen_random_uuid())),
    'P0002', 'factory_not_found', 'a missing factory is not found');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, fx->>'po_id',
      jsonb_build_object('factory_id', pg_temp.add_factory(v_org, '新工廠'))),
    '55000', 'purchase_order_received', 'a purchase order with goods received cannot change factory');
end $$;

-- cancel_purchase_order: refused once goods are received; releases the linked orders; a cancelled one is frozen
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_order uuid;
  v_po uuid;
  v_other_po uuid;
  v_number text;
  v_result jsonb;
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 10, 'unit_price', 5));
begin
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'confirmed') returning id into v_order;
  v_po := (pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id', v_items, v_order))->>'id')::uuid;
  v_other_po := (pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L, array[%L]::uuid[])', v_org, fx->>'factory_id', v_items, v_order))->>'id')::uuid;
  select po_number into v_number from public.purchase_orders where id = v_po;

  perform pg_temp.check_api_error_as(v_viewer, format('select public.cancel_purchase_order(%L, %L)', v_org, v_po), '42501', 'forbidden', 'a viewer cannot cancel');
  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_purchase_order(%L, %L)', v_org, fx->>'po_id'),
    '55000', 'purchase_order_received', 'a purchase order with goods received cannot be cancelled');

  v_result := pg_temp.call_as(v_editor, format('select public.cancel_purchase_order(%L, %L, %L, true)', v_org, v_po, '工廠缺料'));
  perform pg_temp.check((select status from public.purchase_orders where id = v_po) = 'confirmed', 'a dry run cancels nothing');
  perform pg_temp.check(v_result->'summary'->'fields' = jsonb_build_array(
      jsonb_build_object('label', '狀態', 'value', '已下單 → 已取消'),
      jsonb_build_object('label', '取消原因', 'value', '工廠缺料')),
    'the summary shows the cancellation, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.call_as(v_editor, format('select public.cancel_purchase_order(%L, %L, %L)', v_org, v_po, '工廠缺料'));
  perform pg_temp.check((select status = 'cancelled' and cancelled_at is not null and cancel_reason = '工廠缺料' from public.purchase_orders where id = v_po),
    'the purchase order is cancelled with its reason');
  perform pg_temp.check((select status from public.orders where id = v_order) = 'factory_ordered', 'an order with another live purchase order stays 已向工廠下單');

  perform pg_temp.call_as(v_editor, format('select public.cancel_purchase_order(%L, %L)', v_org, v_other_po));
  perform pg_temp.check((select status from public.orders where id = v_order) = 'confirmed', 'an order without live purchase orders goes back to 已確認');

  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_purchase_order(%L, %L)', v_org, v_po),
    '55000', 'purchase_order_already_cancelled', 'a purchase order is cancelled once');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_purchase_order(%L, %L, %L)', v_org, v_po, '{"note":"x"}'),
    '55000', 'purchase_order_cancelled', 'a cancelled purchase order cannot be edited');
  perform pg_temp.check_raises_as(v_editor, format('select public.save_purchase_order_items(%L, %L)', v_po, v_items),
    '已取消', 'the items of a cancelled purchase order cannot be saved directly either');

  -- The order itself can now be cancelled
  perform pg_temp.call_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, v_order));
  perform pg_temp.check((select status from public.orders where id = v_order) = 'cancelled', 'an order whose purchase orders are all cancelled can be cancelled');
end $$;


-- ===== test: api_a4_receiving.test.sql
-- 業務 API A4：入庫（進貨單）（docs/BUSINESS_API.md）。先載入 _helpers.sql 再執行本檔。
-- Fixture: purchase order (product 1, 100kg ordered, fully received) with one receiving batch holding one roll
-- (100kg received, 40kg shipped); product 2 is not on the purchase order.

-- receive_inventory writes the batch and its rolls, numbers both and updates the purchase order's progress
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_date text := to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD');
  v_po uuid;
  v_rolls jsonb;
  v_result jsonb;
  v_inventory public.inventories%rowtype;
begin
  v_po := (pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L)', v_org, fx->>'factory_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 100, 'unit_price', 5),
                      jsonb_build_object('product_id', fx->>'product2_id', 'ordered_quantity', 50, 'unit_price', 5))))->>'id')::uuid;

  v_rolls := jsonb_build_array(
    jsonb_build_object('product_id', fx->>'product_id', 'quantity', 40, 'warehouse_id', fx->>'warehouse_id', 'shelf', ' B-03 '),
    jsonb_build_object('product_id', fx->>'product_id', 'quantity', 35.5, 'warehouse_id', fx->>'warehouse_id', 'quality', 'B'),
    jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 60, 'warehouse_id', fx->>'warehouse_id', 'roll_number', 'MY-ROLL-' || v_org));

  v_result := pg_temp.call_as(v_editor, format('select public.receive_inventory(%L, %L, %L, %L, %L)', v_org, v_po, v_rolls, '2026-10-01', '第一批'));
  select * into v_inventory from public.inventories where id = (v_result->>'id')::uuid;

  -- seed_fixture already created today's first receiving batch for this organization
  perform pg_temp.check(v_result->>'number' = 'I' || v_date || '0002', 'the batch is numbered I<date>, got ' || coalesce(v_result->>'number', 'none'));
  perform pg_temp.check(v_inventory.receipt_number = v_result->>'number' and v_inventory.purchase_order_id = v_po
    and v_inventory.factory_id = (fx->>'factory_id')::uuid and v_inventory.user_id = v_editor and v_inventory.arrival_date = '2026-10-01'
    and v_inventory.note = '第一批', 'the batch keeps the purchase order''s factory, its date and note');
  perform pg_temp.check((select count(*) from public.inventory_rolls where inventory_id = v_inventory.id) = 3, 'all rolls are stored');
  perform pg_temp.check(exists (select 1 from public.inventory_rolls where inventory_id = v_inventory.id and quantity = 40 and current_quantity = 40
      and quality = 'A' and shelf = 'B-03' and roll_number ~ '^R\d{15}$'), 'a roll without a number gets one, with grade A and a trimmed shelf');
  perform pg_temp.check(exists (select 1 from public.inventory_rolls where inventory_id = v_inventory.id and roll_number = 'MY-ROLL-' || v_org),
    'a roll number given by the caller is kept');

  perform pg_temp.check((select received_quantity from public.purchase_order_items where purchase_order_id = v_po and product_id = (fx->>'product_id')::uuid) = 75.5,
    'the purchase order item counts what was received');
  perform pg_temp.check((select status from public.purchase_orders where id = v_po) = 'partial_received', 'the purchase order is partly received');

  perform pg_temp.check(v_result->'summary'->>'title' = '入庫', 'the summary has a title');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '工廠', 'value', '測試工廠'),
      jsonb_build_object('label', '到貨日期', 'value', '2026-10-01'),
      jsonb_build_object('label', '產品 1', 'value', public.api_product_label((fx->>'product_id')::uuid) || ' × 2 卷，共 75.5 公斤'),
      jsonb_build_object('label', '產品 2', 'value', public.api_product_label((fx->>'product2_id')::uuid) || ' × 1 卷，共 60 公斤'),
      jsonb_build_object('label', '合計', 'value', '3 卷，135.5 公斤'),
      jsonb_build_object('label', '超過採購量', 'value', public.api_product_label((fx->>'product2_id')::uuid) || ' 已入庫 60 公斤，採購 50 公斤')),
    'the summary describes the batch and flags over-receipt, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.check((pg_temp.call_as((other->>'user_id')::uuid, format('select public.receive_inventory(%L, %L, %L)', other->>'org_id', other->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'quantity', 1, 'warehouse_id', other->>'warehouse_id')))))->>'number'
    = 'I' || v_date || '0002', 'another organization counts its own numbers');
end $$;

-- A dry run stores nothing, leaves the purchase order alone and shows the same summary
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_rolls jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'warehouse_id', fx->>'warehouse_id', 'roll_number', 'DRY-1'));
  v_batches int;
  v_logs int;
  v_received numeric;
  v_preview jsonb;
  v_real jsonb;
begin
  select count(*) into v_batches from public.inventories where organization_id = v_org;
  select count(*) into v_logs from public.record_audit_logs where organization_id = v_org;
  select received_quantity into v_received from public.purchase_order_items where id = (fx->>'po_item_id')::uuid;

  v_preview := pg_temp.call_as(v_editor, format('select public.receive_inventory(%L, %L, %L, p_dry_run => true)', v_org, fx->>'po_id', v_rolls));
  perform pg_temp.check((v_preview->>'dry_run')::boolean and v_preview->>'id' is null and v_preview->>'number' is null, 'a dry run has no id or number');
  perform pg_temp.check((select count(*) from public.inventories where organization_id = v_org) = v_batches, 'a dry run stores no batch');
  perform pg_temp.check((select count(*) from public.record_audit_logs where organization_id = v_org) = v_logs, 'a dry run leaves no audit trail');
  perform pg_temp.check((select received_quantity from public.purchase_order_items where id = (fx->>'po_item_id')::uuid) = v_received,
    'a dry run leaves the purchase order''s progress alone');

  v_real := pg_temp.call_as(v_editor, format('select public.receive_inventory(%L, %L, %L)', v_org, fx->>'po_id', v_rolls));
  perform pg_temp.check(v_preview->'summary' = v_real->'summary', 'the dry run shows the same summary as the real call');
end $$;

-- receive_inventory refuses bad input and needs canCreateInventory
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_good jsonb := jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'warehouse_id', fx->>'warehouse_id'));
  v_po uuid;
  v_call text := 'select public.receive_inventory(%L, %L, %L)';
begin
  perform pg_temp.check_api_error_as(v_viewer, format(v_call, v_org, fx->>'po_id', v_good), '42501', 'forbidden', 'a viewer cannot receive goods');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, other->>'po_id', v_good), 'P0002', 'purchase_order_not_found',
    'another organization''s purchase order is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id', '[]'), '22023', 'rolls_required', 'a batch needs a roll');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 10, 'warehouse_id', fx->>'warehouse_id'))),
    '22023', 'product_not_on_purchase_order', 'only products on the purchase order can be received');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', other->>'product_id', 'quantity', 10, 'warehouse_id', fx->>'warehouse_id'))),
    'P0002', 'product_not_found', 'another organization''s product is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 10, 'warehouse_id', other->>'warehouse_id'))),
    'P0002', 'warehouse_not_found', 'another organization''s warehouse is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 0, 'warehouse_id', fx->>'warehouse_id'))),
    '22023', 'invalid_quantity', 'a roll must weigh something');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'po_id',
      jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 1, 'warehouse_id', fx->>'warehouse_id',
        'roll_number', (select roll_number from public.inventory_rolls where id = (fx->>'roll_id')::uuid)))),
    '23505', 'roll_number_taken', 'roll numbers are unique');

  v_po := (pg_temp.call_as(v_editor, format('select public.create_purchase_order(%L, %L, %L)', v_org, fx->>'factory_id',
    jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'ordered_quantity', 10, 'unit_price', 5))))->>'id')::uuid;
  perform pg_temp.call_as(v_editor, format('select public.cancel_purchase_order(%L, %L)', v_org, v_po));
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, v_po, v_good), '55000', 'purchase_order_cancelled',
    'a cancelled purchase order cannot be received');
end $$;

-- update_inventory changes the date, note and rolls; shipped rolls keep their lock rules
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_inventory uuid := (fx->>'inventory_id')::uuid;
  v_receipt text := (select receipt_number from public.inventories where id = (fx->>'inventory_id')::uuid);
  v_roll public.inventory_rolls%rowtype;
  v_changes jsonb;
  v_preview jsonb;
  v_result jsonb;
begin
  select * into v_roll from public.inventory_rolls where id = (fx->>'roll_id')::uuid;
  v_changes := jsonb_build_object(
    'arrival_date', '2026-10-02',
    'note', '補登',
    'rolls', jsonb_build_array(
      jsonb_build_object('id', v_roll.id, 'product_id', v_roll.product_id, 'quantity', 110, 'warehouse_id', v_roll.warehouse_id, 'quality', 'B'),
      jsonb_build_object('product_id', fx->>'product_id', 'quantity', 20, 'warehouse_id', fx->>'warehouse_id', 'roll_number', 'ADD-' || v_org)));

  v_preview := pg_temp.call_as(v_editor, format('select public.update_inventory(%L, %L, %L, true)', v_org, v_inventory, v_changes));
  perform pg_temp.check((select quantity from public.inventory_rolls where id = v_roll.id) = 100, 'a dry run changes nothing');

  v_result := pg_temp.call_as(v_editor, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory, v_changes));
  perform pg_temp.check(v_preview->'summary' = v_result->'summary', 'the dry run shows the same summary');
  perform pg_temp.check(v_result->'summary'->>'title' = '修改進貨單 ' || v_receipt and v_result->>'number' = v_receipt, 'the summary names the batch');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '備註', 'value', '（空白） → 補登'),
      jsonb_build_object('label', '修改布卷', 'value',
        public.api_roll_label(v_roll.roll_number, v_roll.product_id, 100, 'A', v_roll.warehouse_id, null) || ' → '
        || public.api_roll_label(v_roll.roll_number, v_roll.product_id, 110, 'B', v_roll.warehouse_id, null)),
      jsonb_build_object('label', '新增布卷', 'value', public.api_roll_label('ADD-' || v_org, (fx->>'product_id')::uuid, 20, 'A', (fx->>'warehouse_id')::uuid, null))),
    'the summary lists the changes, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check((select quantity = 110 and current_quantity = 70 and quality = 'B' from public.inventory_rolls where id = v_roll.id),
    'the roll keeps its shipped weight when its received weight changes');
  perform pg_temp.check((select arrival_date = '2026-10-02' and note = '補登' from public.inventories where id = v_inventory), 'the batch is updated');

  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory, '{"note":"x"}'),
    '42501', 'forbidden', 'a viewer cannot edit batches');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory, '{"factory_id":"x"}'),
    '22023', 'unknown_field', 'the factory follows the purchase order');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory,
      jsonb_build_object('rolls', jsonb_build_array(jsonb_build_object('product_id', fx->>'product_id', 'quantity', 1, 'warehouse_id', fx->>'warehouse_id')))),
    '55000', 'roll_shipped', 'a shipped roll cannot be removed');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory,
      jsonb_build_object('rolls', jsonb_build_array(jsonb_build_object('id', v_roll.id, 'product_id', v_roll.product_id, 'quantity', 30, 'warehouse_id', v_roll.warehouse_id)))),
    '55000', 'quantity_below_shipped', 'a roll cannot weigh less than what was shipped from it');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory(%L, %L, %L)', v_org, v_inventory,
      jsonb_build_object('rolls', jsonb_build_array(
        jsonb_build_object('id', v_roll.id, 'product_id', v_roll.product_id, 'quantity', 110, 'warehouse_id', v_roll.warehouse_id),
        jsonb_build_object('product_id', fx->>'product2_id', 'quantity', 1, 'warehouse_id', fx->>'warehouse_id')))),
    '22023', 'product_not_on_purchase_order', 'an added roll must be for a product on the purchase order');
end $$;

-- update_inventory_roll changes one roll and shows it on the card
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_roll public.inventory_rolls%rowtype;
  v_shelf uuid;
  v_result jsonb;
begin
  select * into v_roll from public.inventory_rolls where id = (fx->>'roll_id')::uuid;
  insert into public.warehouses (name, organization_id) values ('二號倉', v_org) returning id into v_shelf;

  v_result := pg_temp.call_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id,
    jsonb_build_object('warehouse_id', v_shelf, 'shelf', 'C-01', 'quality', 'C')));
  perform pg_temp.check((select warehouse_id = v_shelf and shelf = 'C-01' and quality = 'C' and quantity = 100 and current_quantity = 60
      from public.inventory_rolls where id = v_roll.id), 'the roll moves and is regraded, its weights unchanged');
  perform pg_temp.check(v_result->>'number' = v_roll.roll_number and v_result->'summary'->>'title' = '修改布卷 ' || v_roll.roll_number, 'the card names the roll');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(jsonb_build_object('label', '修改布卷', 'value',
      public.api_roll_label(v_roll.roll_number, v_roll.product_id, 100, 'A', v_roll.warehouse_id, null) || ' → '
      || public.api_roll_label(v_roll.roll_number, v_roll.product_id, 100, 'C', v_shelf, 'C-01'))),
    'the card shows the roll before and after, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check(public.api_roll_label(v_roll.roll_number, v_roll.product_id, 100, 'C', v_shelf, 'C-01') like '%（C 級，倉庫 二號倉 C-01）',
    'the roll label shows grade, warehouse and shelf');

  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, '{"shelf":"x"}'),
    '42501', 'forbidden', 'a viewer cannot edit rolls');
  perform pg_temp.check_api_error_as((other->>'user_id')::uuid, format('select public.update_inventory_roll(%L, %L, %L)', other->>'org_id', v_roll.id, '{"shelf":"x"}'),
    'P0002', 'roll_not_found', 'another organization''s roll is not found');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, '{"quantity":10}'),
    '55000', 'quantity_below_shipped', 'a roll cannot weigh less than what was shipped');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, '{"quality":"E"}'),
    '22023', 'invalid_quality', 'grades are A, B, C, D or defective');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_inventory_roll(%L, %L, %L)', v_org, v_roll.id, '{"product_id":"x"}'),
    '22023', 'unknown_field', 'a single roll''s product is not changed here');
end $$;


-- ===== test: api_a5_shipping.test.sql
-- 業務 API A5：出貨單（docs/BUSINESS_API.md）。先載入 _helpers.sql 再執行本檔。
-- Fixture: order (product 1, 100kg) with one shipping of 40kg from a roll of 100kg (60kg left).

-- Add a roll of a product to the fixture's receiving batch (test setup)
create or replace function pg_temp.add_roll(fx jsonb, product uuid, weight numeric)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.inventory_rolls (inventory_id, product_id, warehouse_id, roll_number, quantity, current_quantity)
  values ((fx->>'inventory_id')::uuid, product, (fx->>'warehouse_id')::uuid, 'T-' || gen_random_uuid(), weight, weight)
  returning id into v_id;
  return v_id;
end $$;

-- create_shipping writes the shipping and its rolls, takes the stock and updates the order's progress
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_date text := to_char(now() at time zone 'Asia/Taipei', 'YYYYMMDD');
  v_roll uuid := (fx->>'roll_id')::uuid;
  v_second uuid;
  v_result jsonb;
  v_over jsonb;
  v_shipping public.shippings%rowtype;
begin
  v_second := pg_temp.add_roll(fx, (fx->>'product_id')::uuid, 100);

  v_result := pg_temp.call_as(v_editor, format('select public.create_shipping(%L, %L, %L, %L, %L)', v_org, fx->>'order_id',
    jsonb_build_array(jsonb_build_object('inventory_roll_id', v_roll, 'shipped_quantity', 30)), '2026-10-05', '第二批'));
  select * into v_shipping from public.shippings where id = (v_result->>'id')::uuid;

  -- seed_fixture already created today's first shipping for this organization
  perform pg_temp.check(v_result->>'number' = 'O' || v_date || '0002', 'the shipping is numbered O<date>, got ' || coalesce(v_result->>'number', 'none'));
  perform pg_temp.check(v_shipping.customer_id = (fx->>'customer_id')::uuid and v_shipping.user_id = v_editor and v_shipping.status = 'shipped'
    and v_shipping.shipping_date = '2026-10-05' and v_shipping.note = '第二批' and v_shipping.total_shipped_quantity = 30 and v_shipping.total_shipped_rolls = 1,
    'the shipping takes the order''s customer and records its totals');
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = v_roll) = 30, 'the stock is taken from the roll');
  perform pg_temp.check((select shipped_quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 70, 'the order line counts both shippings');
  perform pg_temp.check((select shipping_status from public.orders where id = (fx->>'order_id')::uuid) = 'partial_shipped', 'the order is partly shipped');

  perform pg_temp.check(v_result->'summary'->>'title' = '建立出貨單', 'the summary has a title');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '客戶', 'value', '測試客戶'),
      jsonb_build_object('label', '出貨日期', 'value', '2026-10-05'),
      jsonb_build_object('label', '產品 1', 'value', public.api_product_label((fx->>'product_id')::uuid) || ' × 1 卷，共 30 公斤'),
      jsonb_build_object('label', '合計', 'value', '1 卷，30 公斤')),
    'the summary describes the shipping, got ' || (v_result->'summary'->'fields')::text);

  v_over := pg_temp.call_as(v_editor, format('select public.create_shipping(%L, %L, %L)', v_org, fx->>'order_id',
    jsonb_build_array(jsonb_build_object('inventory_roll_id', v_second, 'shipped_quantity', 40))));
  perform pg_temp.check((select shipping_status from public.orders where id = (fx->>'order_id')::uuid) = 'shipped', 'the order is fully shipped');
  perform pg_temp.check(v_over->'summary'->'fields' @> jsonb_build_array(jsonb_build_object('label', '超過訂單量',
      'value', public.api_product_label((fx->>'product_id')::uuid) || ' 已出貨 110 公斤，訂購 100 公斤')),
    'shipping beyond the order is allowed and flagged, got ' || (v_over->'summary'->'fields')::text);
end $$;

-- A dry run takes no stock, stores nothing and shows the same summary
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_items jsonb := jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 10));
  v_shippings int;
  v_logs int;
  v_preview jsonb;
  v_real jsonb;
begin
  select count(*) into v_shippings from public.shippings where organization_id = v_org;
  select count(*) into v_logs from public.record_audit_logs where organization_id = v_org;

  v_preview := pg_temp.call_as(v_editor, format('select public.create_shipping(%L, %L, %L, p_dry_run => true)', v_org, fx->>'order_id', v_items));
  perform pg_temp.check((v_preview->>'dry_run')::boolean and v_preview->>'id' is null and v_preview->>'number' is null, 'a dry run has no id or number');
  perform pg_temp.check((select count(*) from public.shippings where organization_id = v_org) = v_shippings, 'a dry run stores no shipping');
  perform pg_temp.check((select count(*) from public.record_audit_logs where organization_id = v_org) = v_logs, 'a dry run leaves no audit trail');
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = (fx->>'roll_id')::uuid) = 60, 'a dry run takes no stock');
  perform pg_temp.check((select shipped_quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 40, 'a dry run leaves the order alone');

  v_real := pg_temp.call_as(v_editor, format('select public.create_shipping(%L, %L, %L)', v_org, fx->>'order_id', v_items));
  perform pg_temp.check(v_preview->'summary' = v_real->'summary', 'the dry run shows the same summary as the real call');
end $$;

-- create_shipping refuses bad input and needs canCreateShipping
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  other jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_good jsonb := jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 10));
  v_cancelled uuid;
  v_other_product_roll uuid;
  v_call text := 'select public.create_shipping(%L, %L, %L)';
begin
  insert into public.orders (customer_id, user_id, organization_id, status)
  values ((fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, v_org, 'cancelled') returning id into v_cancelled;
  v_other_product_roll := pg_temp.add_roll(fx, (fx->>'product2_id')::uuid, 50);

  perform pg_temp.check_api_error_as(v_viewer, format(v_call, v_org, fx->>'order_id', v_good), '42501', 'forbidden', 'a viewer cannot ship');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, other->>'order_id', v_good), 'P0002', 'order_not_found',
    'another organization''s order is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, v_cancelled, v_good), '55000', 'order_cancelled', 'a cancelled order cannot be shipped');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'order_id', '[]'), '22023', 'items_required', 'a shipping needs a roll');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'order_id',
      jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 0))),
    '22023', 'invalid_quantity', 'the weight must be positive');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'order_id',
      jsonb_build_array(jsonb_build_object('inventory_roll_id', other->>'roll_id', 'shipped_quantity', 1))),
    'P0002', 'roll_not_found', 'another organization''s roll is not found');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'order_id',
      jsonb_build_array(jsonb_build_object('inventory_roll_id', v_other_product_roll, 'shipped_quantity', 1))),
    '22023', 'roll_not_in_order', 'a roll of a product not on the order cannot be shipped for it');
  perform pg_temp.check_api_error_as(v_editor, format(v_call, v_org, fx->>'order_id',
      jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 61))),
    '55000', 'insufficient_stock', 'a roll cannot ship more than it holds');
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = (fx->>'roll_id')::uuid) = 60, 'a refused shipping takes no stock');
end $$;

-- update_shipping changes the date, note and rolls, moving only the difference in stock
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_number text := (select shipping_number from public.shippings where id = (fx->>'shipping_id')::uuid);
  v_changes jsonb;
  v_preview jsonb;
  v_result jsonb;
begin
  v_changes := jsonb_build_object('shipping_date', '2026-10-06', 'note', '改重',
    'items', jsonb_build_array(jsonb_build_object('id', fx->>'shipping_item_id', 'inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 50)));

  v_preview := pg_temp.call_as(v_editor, format('select public.update_shipping(%L, %L, %L, true)', v_org, fx->>'shipping_id', v_changes));
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = (fx->>'roll_id')::uuid) = 60, 'a dry run moves no stock');

  v_result := pg_temp.call_as(v_editor, format('select public.update_shipping(%L, %L, %L)', v_org, fx->>'shipping_id', v_changes));
  perform pg_temp.check(v_preview->'summary' = v_result->'summary', 'the dry run shows the same summary');
  perform pg_temp.check(v_result->'summary'->>'title' = '修改出貨單 ' || v_number and v_result->>'number' = v_number, 'the summary names the shipping');
  perform pg_temp.check(v_result->'summary'->'fields' @> jsonb_build_array(
      jsonb_build_object('label', '備註', 'value', '（空白） → 改重'),
      jsonb_build_object('label', '修改布卷', 'value',
        public.api_shipped_roll_label((fx->>'roll_id')::uuid, 40) || ' → ' || public.api_shipped_roll_label((fx->>'roll_id')::uuid, 50))),
    'the summary lists the changes, got ' || (v_result->'summary'->'fields')::text);
  perform pg_temp.check((select current_quantity from public.inventory_rolls where id = (fx->>'roll_id')::uuid) = 50, 'only the extra 10kg is taken');
  perform pg_temp.check((select shipping_date = '2026-10-06' and total_shipped_quantity = 50 from public.shippings where id = (fx->>'shipping_id')::uuid),
    'the shipping is updated with its new total');
  perform pg_temp.check((select shipped_quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 50, 'the order line follows');

  perform pg_temp.check_api_error_as(v_viewer, format('select public.update_shipping(%L, %L, %L)', v_org, fx->>'shipping_id', '{"note":"x"}'),
    '42501', 'forbidden', 'a viewer cannot edit shippings');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_shipping(%L, %L, %L)', v_org, fx->>'shipping_id', '{"order_id":"x"}'),
    '22023', 'unknown_field', 'the order of a shipping cannot be changed');
end $$;

-- cancel_shipping puts the stock back and recalculates the order; a cancelled shipping is frozen
do $$
declare
  fx jsonb := pg_temp.seed_fixture();
  v_org uuid := (fx->>'org_id')::uuid;
  v_editor uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'editor');
  v_viewer uuid := pg_temp.add_member((fx->>'org_id')::uuid, 'viewer');
  v_shipping uuid := (fx->>'shipping_id')::uuid;
  v_result jsonb;
begin
  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, fx->>'order_id'),
    '55000', 'order_has_shipments', 'an order with a live shipping cannot be cancelled');
  perform pg_temp.check_api_error_as(v_viewer, format('select public.cancel_shipping(%L, %L)', v_org, v_shipping), '42501', 'forbidden', 'a viewer cannot cancel');

  v_result := pg_temp.call_as(v_editor, format('select public.cancel_shipping(%L, %L, %L, true)', v_org, v_shipping, '客戶退回'));
  perform pg_temp.check((select status from public.shippings where id = v_shipping) = 'shipped', 'a dry run cancels nothing');
  perform pg_temp.check(v_result->'summary'->'fields' = jsonb_build_array(
      jsonb_build_object('label', '狀態', 'value', '已出貨 → 已取消'),
      jsonb_build_object('label', '歸還庫存', 'value', '1 卷，40 公斤'),
      jsonb_build_object('label', '取消原因', 'value', '客戶退回')),
    'the summary shows the cancellation and the stock returned, got ' || (v_result->'summary'->'fields')::text);

  perform pg_temp.call_as(v_editor, format('select public.cancel_shipping(%L, %L, %L)', v_org, v_shipping, '客戶退回'));
  perform pg_temp.check((select status = 'cancelled' and cancelled_at is not null and cancel_reason = '客戶退回' from public.shippings where id = v_shipping),
    'the shipping is cancelled with its reason');
  perform pg_temp.check((select current_quantity = 100 and not is_allocated from public.inventory_rolls where id = (fx->>'roll_id')::uuid), 'the stock is back on the roll');
  perform pg_temp.check((select shipped_quantity from public.order_products where id = (fx->>'order_product_id')::uuid) = 0, 'the order line no longer counts it');
  perform pg_temp.check((select shipping_status from public.orders where id = (fx->>'order_id')::uuid) = 'not_started', 'the order is back to not shipped');
  perform pg_temp.check(exists (select 1 from public.shipping_items where shipping_id = v_shipping), 'the shipped rolls stay on record');

  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_shipping(%L, %L)', v_org, v_shipping),
    '55000', 'shipping_already_cancelled', 'a shipping is cancelled once');
  perform pg_temp.check_api_error_as(v_editor, format('select public.update_shipping(%L, %L, %L)', v_org, v_shipping, '{"note":"x"}'),
    '55000', 'shipping_cancelled', 'a cancelled shipping cannot be edited');
  perform pg_temp.check_raises_as(v_editor, format('select public.save_shipping_items(%L, %L)', v_shipping,
      jsonb_build_array(jsonb_build_object('inventory_roll_id', fx->>'roll_id', 'shipped_quantity', 1))),
    '已取消', 'the items of a cancelled shipping cannot be saved directly either');

  -- With its only shipping cancelled, the order is now held back only by its purchase order
  perform pg_temp.check_api_error_as(v_editor, format('select public.cancel_order(%L, %L)', v_org, fx->>'order_id'),
    '55000', 'order_has_purchase_orders', 'a cancelled shipping no longer blocks cancelling the order');
end $$;


-- ===== test: api_a6_products.test.sql
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


-- ===== test: rbac_r0_security.test.sql
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


-- ===== test: rbac_r1_roles.test.sql
-- RBAC R1 固定角色測試（docs/MULTI_TENANT_RBAC.md §4）。先載入 _helpers.sql 再執行本檔。

-- Every role holds exactly the permissions of docs/MULTI_TENANT_RBAC.md §4.3; removed keys are granted to nobody
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
  perform pg_temp.check((select count(*) from public.organization_roles where organization_id = v_org) = 0, 'no legacy role rows are created');
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
  values ('temp', (fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, (fx->>'org_id')::uuid) returning id into v_order;
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


do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
