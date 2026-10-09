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
