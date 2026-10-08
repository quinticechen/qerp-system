-- 業務 API A3 採購單（docs/BUSINESS_API.md §3、§5）
--
-- 1. save_purchase_order_items 的錯誤改為 SQLSTATE＋HINT 代碼（訊息與鎖定規則不變）；已取消的採購單不能修改品項；
--    同一次新增的品項依傳入順序排列
-- 2. 採購單新增 cancelled_at、cancel_reason
-- 3. create_purchase_order、update_purchase_order、cancel_purchase_order：
--    - 編號 P＋YYYYMMDD＋四位流水號（B8）
--    - 關聯訂單：建立或新增關聯時，「待確認」「已確認」的訂單改為「已向工廠下單」；
--      取消採購單或移除關聯後，若訂單已沒有其他進行中的採購單，「已向工廠下單」改回「已確認」
--    - 已有入庫紀錄的採購單不能取消，也不能更換工廠

-- ===== 1. save_purchase_order_items：錯誤代碼

CREATE OR REPLACE FUNCTION public.save_purchase_order_items(p_purchase_order_id uuid, p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_status purchase_order_status;
  v_number text;
  v_item record;
  v_existing purchase_order_items;
  v_name text;
begin
  select organization_id, status, po_number into v_org, v_status, v_number
  from purchase_orders where id = p_purchase_order_id for update;
  if not found then
    raise exception '找不到採購單，或沒有編輯權限' using errcode = 'P0002', hint = 'purchase_order_not_found';
  end if;
  if v_status = 'cancelled' then
    raise exception '採購單 % 已取消，不能修改', v_number using errcode = '55000', hint = 'purchase_order_cancelled';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception '採購單至少需要一項產品' using errcode = '22023', hint = 'items_required';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(id uuid, product_id uuid, ordered_quantity numeric, ordered_rolls int, unit_price numeric, specifications jsonb)
  loop
    if v_item.product_id is null
      or not exists (select 1 from products_new where id = v_item.product_id and organization_id = v_org) then
      raise exception '請選擇此組織的產品' using errcode = 'P0002', hint = 'product_not_found';
    end if;
    if coalesce(v_item.ordered_quantity, 0) <= 0 then
      raise exception '採購數量必須大於 0' using errcode = '22023', hint = 'invalid_quantity';
    end if;
    if coalesce(v_item.unit_price, 0) < 0 then
      raise exception '單價不可為負數' using errcode = '22023', hint = 'invalid_unit_price';
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
      raise exception '產品「%」已入庫，不可刪除', v_name using errcode = '55000', hint = 'item_received';
    end if;
    delete from purchase_order_items where id = v_existing.id;
  end loop;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(id uuid, product_id uuid, ordered_quantity numeric, ordered_rolls int, unit_price numeric, specifications jsonb)
  loop
    if v_item.id is null then
      -- clock_timestamp() rather than now(): items added in one call keep the order they were given in
      insert into purchase_order_items (purchase_order_id, product_id, ordered_quantity, ordered_rolls, unit_price, specifications, created_at)
      values (p_purchase_order_id, v_item.product_id, v_item.ordered_quantity, v_item.ordered_rolls, v_item.unit_price, v_item.specifications, clock_timestamp());
      continue;
    end if;

    select * into v_existing from purchase_order_items where id = v_item.id and purchase_order_id = p_purchase_order_id;
    if not found then
      raise exception '採購項目不屬於此採購單' using errcode = 'P0002', hint = 'item_not_found';
    end if;
    select name into v_name from products_new where id = v_existing.product_id;

    if v_item.product_id <> v_existing.product_id and coalesce(v_existing.received_quantity, 0) > 0 then
      raise exception '產品「%」已入庫，不可更換產品', v_name using errcode = '55000', hint = 'item_received';
    end if;
    if v_item.ordered_quantity < coalesce(v_existing.received_quantity, 0) then
      raise exception '產品「%」的採購數量不可低於已入庫 % 公斤', v_name, v_existing.received_quantity
        using errcode = '55000', hint = 'quantity_below_received';
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
$function$;

-- ===== 2. 取消紀錄

ALTER TABLE public.purchase_orders ADD COLUMN cancelled_at timestamptz;
ALTER TABLE public.purchase_orders ADD COLUMN cancel_reason text;

-- ===== 3. 輔助函式

-- Display labels for purchase order statuses
CREATE FUNCTION public.api_purchase_status_label(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE p_status
    WHEN 'pending' THEN '待確認' WHEN 'confirmed' THEN '已下單' WHEN 'partial_arrived' THEN '部分到貨'
    WHEN 'partial_received' THEN '部分入庫' WHEN 'completed' THEN '已完成' WHEN 'cancelled' THEN '已取消'
    ELSE p_status END;
$function$;

-- A date given as text ('' or null clears it); raises on anything that is not a date
CREATE FUNCTION public.api_date(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.api_clean(p_value) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public.api_clean(p_value)::date;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION '日期格式不正確：%', p_value USING ERRCODE = '22023', HINT = 'invalid_date';
END;
$function$;

-- Numbers of the orders linked to a purchase order, in number order
CREATE FUNCTION public.api_purchase_order_numbers(p_purchase_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT string_agg(o.order_number, '、' ORDER BY o.order_number)
  FROM public.purchase_order_relations r JOIN public.orders o ON o.id = r.order_id
  WHERE r.purchase_order_id = p_purchase_order_id;
$function$;

-- Card fields describing a whole purchase order: factory, linked orders, each item, dates, note and total
CREATE FUNCTION public.api_purchase_order_fields(p_purchase_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT public.api_fields('工廠', f.name, '關聯訂單', public.api_purchase_order_numbers(po.id))
    || coalesce((
         SELECT jsonb_agg(jsonb_build_object('label', '品項 ' || rn, 'value', public.api_order_line_label(product_id, ordered_quantity, unit_price)) ORDER BY rn)
         FROM (SELECT poi.*, row_number() OVER (ORDER BY poi.created_at, poi.id) AS rn
               FROM public.purchase_order_items poi WHERE poi.purchase_order_id = po.id) items
       ), '[]'::jsonb)
    || public.api_fields(
         '下單日期', po.order_date::text,
         '預計到貨日期', po.expected_arrival_date::text,
         '備註', po.note,
         '採購總額', (SELECT public.api_number(sum(ordered_quantity * unit_price)) FROM public.purchase_order_items WHERE purchase_order_id = po.id)
       )
  FROM public.purchase_orders po JOIN public.factories f ON f.id = po.factory_id
  WHERE po.id = p_purchase_order_id;
$function$;

-- Raise unless every product of the given items belongs to the organization and is available.
-- Items that keep an existing product (same id and product as before) may keep a product that was disabled since.
CREATE FUNCTION public.api_check_purchase_products(p_organization_id uuid, p_purchase_order_id uuid, p_items jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_line record;
  v_available boolean;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '採購單至少需要一項產品' USING ERRCODE = '22023', HINT = 'items_required';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id uuid, product_id uuid) LOOP
    SELECT p.status IS DISTINCT FROM 'Unavailable' AND g.is_active INTO v_available
    FROM public.products_new p JOIN public.product_groups g ON g.id = p.group_id
    WHERE p.id = v_line.product_id AND p.organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '找不到此產品' USING ERRCODE = 'P0002', HINT = 'product_not_found';
    END IF;
    IF NOT v_available AND NOT EXISTS (
      SELECT 1 FROM public.purchase_order_items
      WHERE purchase_order_id = p_purchase_order_id AND id = v_line.id AND product_id = v_line.product_id
    ) THEN
      RAISE EXCEPTION '產品「%」已停用', public.api_product_label(v_line.product_id) USING ERRCODE = '22023', HINT = 'product_unavailable';
    END IF;
  END LOOP;
END;
$function$;

-- Raise unless the factory belongs to the organization and is active (the purchase order's current factory may stay)
CREATE FUNCTION public.api_check_purchase_factory(p_organization_id uuid, p_factory_id uuid, p_current_factory_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory public.factories%ROWTYPE;
BEGIN
  SELECT * INTO v_factory FROM public.factories WHERE id = p_factory_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此工廠' USING ERRCODE = 'P0002', HINT = 'factory_not_found';
  END IF;
  IF NOT v_factory.is_active AND p_factory_id IS DISTINCT FROM p_current_factory_id THEN
    RAISE EXCEPTION '工廠「%」已停用', v_factory.name USING ERRCODE = '22023', HINT = 'factory_inactive';
  END IF;
END;
$function$;

-- Raise unless every order belongs to the organization; newly linked ones must not be cancelled
CREATE FUNCTION public.api_check_purchase_orders(p_organization_id uuid, p_purchase_order_id uuid, p_order_ids uuid[])
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
BEGIN
  FOR v_order IN
    SELECT ids.id, o.order_number, o.status, o.organization_id
    FROM unnest(coalesce(p_order_ids, '{}')) AS ids(id) LEFT JOIN public.orders o ON o.id = ids.id
  LOOP
    IF v_order.organization_id IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION '找不到此訂單' USING ERRCODE = 'P0002', HINT = 'order_not_found';
    END IF;
    IF v_order.status = 'cancelled' AND NOT EXISTS (
      SELECT 1 FROM public.purchase_order_relations WHERE purchase_order_id = p_purchase_order_id AND order_id = v_order.id
    ) THEN
      RAISE EXCEPTION '訂單 % 已取消', v_order.order_number USING ERRCODE = '55000', HINT = 'order_cancelled';
    END IF;
  END LOOP;
END;
$function$;

-- Orders marked 已向工廠下單 that no longer have a live purchase order go back to 已確認
CREATE FUNCTION public.api_release_orders(p_order_ids uuid[])
RETURNS void
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  UPDATE public.orders o
  SET status = 'confirmed'
  WHERE o.id = ANY (coalesce(p_order_ids, '{}'))
    AND o.status = 'factory_ordered'
    AND NOT EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.status <> 'cancelled'
        AND (po.order_id = o.id
             OR EXISTS (SELECT 1 FROM public.purchase_order_relations r WHERE r.purchase_order_id = po.id AND r.order_id = o.id))
    );
$function$;

-- Link a purchase order to exactly these orders: newly linked open orders become 已向工廠下單,
-- unlinked ones are released
CREATE FUNCTION public.api_link_purchase_orders(p_purchase_order_id uuid, p_order_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_removed uuid[];
BEGIN
  SELECT coalesce(array_agg(order_id), '{}') INTO v_removed
  FROM public.purchase_order_relations
  WHERE purchase_order_id = p_purchase_order_id AND order_id <> ALL (coalesce(p_order_ids, '{}'));

  DELETE FROM public.purchase_order_relations WHERE purchase_order_id = p_purchase_order_id AND order_id = ANY (v_removed);
  INSERT INTO public.purchase_order_relations (purchase_order_id, order_id)
  SELECT p_purchase_order_id, o FROM (SELECT DISTINCT unnest(coalesce(p_order_ids, '{}')) AS o) ids
  WHERE NOT EXISTS (SELECT 1 FROM public.purchase_order_relations WHERE purchase_order_id = p_purchase_order_id AND order_id = ids.o);

  UPDATE public.orders SET status = 'factory_ordered'
  WHERE id = ANY (coalesce(p_order_ids, '{}')) AND status IN ('pending', 'confirmed');

  PERFORM public.api_release_orders(v_removed);
END;
$function$;

-- ===== 4. 採購單 API

-- p_items: [{ product_id, ordered_quantity, unit_price, ordered_rolls?, specifications? }]
CREATE FUNCTION public.create_purchase_order(
  p_organization_id uuid,
  p_factory_id uuid,
  p_items jsonb,
  p_order_ids uuid[] DEFAULT '{}',
  p_expected_arrival_date date DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_order_date date DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_date date := coalesce(p_order_date, (now() AT TIME ZONE 'Asia/Taipei')::date);
  v_id uuid;
  v_number text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreatePurchases');
  PERFORM public.api_check_purchase_factory(p_organization_id, p_factory_id, NULL);
  PERFORM public.api_check_purchase_products(p_organization_id, NULL, p_items);
  PERFORM public.api_check_purchase_orders(p_organization_id, NULL, p_order_ids);
  IF p_expected_arrival_date < v_order_date THEN
    RAISE EXCEPTION '預計到貨日期不可早於下單日期' USING ERRCODE = '22023', HINT = 'invalid_expected_arrival_date';
  END IF;

  -- Write for real; a dry run rolls this block back after collecting the summary
  BEGIN
    v_number := public.api_next_document_number(p_organization_id, 'purchase_order');
    INSERT INTO public.purchase_orders (po_number, factory_id, organization_id, user_id, order_date, expected_arrival_date, note, status)
    VALUES (v_number, p_factory_id, p_organization_id, auth.uid(), v_order_date, p_expected_arrival_date, public.api_clean(p_note), 'confirmed')
    RETURNING id INTO v_id;

    PERFORM public.save_purchase_order_items(v_id, public.api_order_items_payload(p_items, false));
    PERFORM public.api_link_purchase_orders(v_id, p_order_ids);

    v_fields := public.api_purchase_order_fields(v_id);
    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, NULL, NULL, '建立採購單', v_fields);
  END;

  RETURN public.api_result(false, v_id, v_number, '建立採購單', v_fields);
END;
$function$;

-- p_changes may hold: items (the complete list, as save_purchase_order_items expects), order_ids (the complete list),
-- factory_id, order_date, expected_arrival_date, note, status (pending / confirmed / partial_received / completed)
CREATE FUNCTION public.update_purchase_order(
  p_organization_id uuid,
  p_purchase_order_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.purchase_orders%ROWTYPE;
  v_new public.purchase_orders%ROWTYPE;
  v_old_items jsonb;
  v_old_orders text;
  v_old_factory text;
  v_order_ids uuid[];
  v_factory_id uuid;
  v_order_date date;
  v_arrival date;
  v_fields jsonb;
  v_title text;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditPurchases');
  PERFORM public.api_check_change_keys(p_changes,
    ARRAY['items', 'order_ids', 'factory_id', 'order_date', 'expected_arrival_date', 'note', 'status']);

  SELECT * INTO v_old FROM public.purchase_orders WHERE id = p_purchase_order_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此採購單' USING ERRCODE = 'P0002', HINT = 'purchase_order_not_found';
  END IF;
  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION '採購單 % 已取消，不能修改', v_old.po_number USING ERRCODE = '55000', HINT = 'purchase_order_cancelled';
  END IF;

  IF p_changes->>'status' = 'cancelled' THEN
    RAISE EXCEPTION '請使用取消採購單' USING ERRCODE = '22023', HINT = 'use_cancel_purchase_order';
  END IF;
  IF p_changes ? 'status' AND coalesce(p_changes->>'status', '') NOT IN ('pending', 'confirmed', 'partial_received', 'completed') THEN
    RAISE EXCEPTION '採購單狀態不正確' USING ERRCODE = '22023', HINT = 'invalid_status';
  END IF;

  IF p_changes ? 'items' THEN
    PERFORM public.api_check_purchase_products(p_organization_id, p_purchase_order_id, p_changes->'items');
  END IF;
  IF p_changes ? 'order_ids' THEN
    IF jsonb_typeof(p_changes->'order_ids') <> 'array' THEN
      RAISE EXCEPTION '訂單清單格式不正確' USING ERRCODE = '22023', HINT = 'invalid_order_ids';
    END IF;
    SELECT coalesce(array_agg(DISTINCT value::uuid), '{}') INTO v_order_ids FROM jsonb_array_elements_text(p_changes->'order_ids');
    PERFORM public.api_check_purchase_orders(p_organization_id, p_purchase_order_id, v_order_ids);
  END IF;

  v_factory_id := coalesce((public.api_clean(p_changes->>'factory_id'))::uuid, v_old.factory_id);
  IF v_factory_id <> v_old.factory_id THEN
    PERFORM public.api_check_purchase_factory(p_organization_id, v_factory_id, v_old.factory_id);
    IF EXISTS (SELECT 1 FROM public.inventories WHERE purchase_order_id = p_purchase_order_id) THEN
      RAISE EXCEPTION '採購單 % 已有入庫紀錄，不能更換工廠', v_old.po_number USING ERRCODE = '55000', HINT = 'purchase_order_received';
    END IF;
  END IF;

  v_order_date := CASE WHEN p_changes ? 'order_date' THEN coalesce(public.api_date(p_changes->>'order_date'), v_old.order_date) ELSE v_old.order_date END;
  v_arrival := CASE WHEN p_changes ? 'expected_arrival_date' THEN public.api_date(p_changes->>'expected_arrival_date') ELSE v_old.expected_arrival_date END;
  IF v_arrival < v_order_date THEN
    RAISE EXCEPTION '預計到貨日期不可早於下單日期' USING ERRCODE = '22023', HINT = 'invalid_expected_arrival_date';
  END IF;

  SELECT coalesce(jsonb_object_agg(poi.id, jsonb_build_object('product_id', poi.product_id, 'quantity', poi.ordered_quantity, 'unit_price', poi.unit_price)), '{}')
  INTO v_old_items FROM public.purchase_order_items poi WHERE poi.purchase_order_id = p_purchase_order_id;
  v_old_orders := public.api_purchase_order_numbers(p_purchase_order_id);
  SELECT name INTO v_old_factory FROM public.factories WHERE id = v_old.factory_id;
  v_title := format('修改採購單 %s', v_old.po_number);

  BEGIN
    IF p_changes ? 'items' THEN
      PERFORM public.save_purchase_order_items(p_purchase_order_id, public.api_order_items_payload(p_changes->'items', true));
    END IF;
    IF p_changes ? 'order_ids' THEN
      PERFORM public.api_link_purchase_orders(p_purchase_order_id, v_order_ids);
    END IF;

    -- The item save recalculates the status; an explicit status overrides it
    UPDATE public.purchase_orders
    SET status = CASE WHEN p_changes ? 'status' THEN (p_changes->>'status')::purchase_order_status ELSE status END,
        factory_id = v_factory_id,
        order_date = v_order_date,
        expected_arrival_date = v_arrival,
        note = public.api_changed(p_changes, 'note', note)
    WHERE id = p_purchase_order_id
    RETURNING * INTO v_new;

    v_fields := public.api_changed_fields(
        '狀態', public.api_purchase_status_label(v_old.status::text), public.api_purchase_status_label(v_new.status::text),
        '工廠', v_old_factory, (SELECT name FROM public.factories WHERE id = v_new.factory_id),
        '關聯訂單', v_old_orders, public.api_purchase_order_numbers(p_purchase_order_id),
        '下單日期', v_old.order_date::text, v_new.order_date::text,
        '預計到貨日期', v_old.expected_arrival_date::text, v_new.expected_arrival_date::text,
        '備註', v_old.note, v_new.note)
      || coalesce((
           SELECT jsonb_agg(jsonb_build_object('label', '移除品項', 'value',
                    public.api_order_line_label((old.value->>'product_id')::uuid, (old.value->>'quantity')::numeric, (old.value->>'unit_price')::numeric)))
           FROM jsonb_each(v_old_items) AS old
           WHERE NOT EXISTS (SELECT 1 FROM public.purchase_order_items WHERE id = old.key::uuid)
         ), '[]'::jsonb)
      || coalesce((
           SELECT jsonb_agg(jsonb_build_object('label', '修改品項', 'value',
                    public.api_order_line_label((old.value->>'product_id')::uuid, (old.value->>'quantity')::numeric, (old.value->>'unit_price')::numeric)
                    || ' → ' || public.api_order_line_label(poi.product_id, poi.ordered_quantity, poi.unit_price)) ORDER BY poi.created_at)
           FROM jsonb_each(v_old_items) AS old JOIN public.purchase_order_items poi ON poi.id = old.key::uuid
           WHERE poi.product_id <> (old.value->>'product_id')::uuid
              OR poi.ordered_quantity <> (old.value->>'quantity')::numeric
              OR poi.unit_price <> (old.value->>'unit_price')::numeric
         ), '[]'::jsonb)
      || coalesce((
           SELECT jsonb_agg(jsonb_build_object('label', '新增品項', 'value', public.api_order_line_label(poi.product_id, poi.ordered_quantity, poi.unit_price)) ORDER BY poi.created_at)
           FROM public.purchase_order_items poi
           WHERE poi.purchase_order_id = p_purchase_order_id AND NOT v_old_items ? poi.id::text
         ), '[]'::jsonb);

    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, p_purchase_order_id, v_old.po_number, v_title, v_fields);
  END;

  RETURN public.api_result(false, p_purchase_order_id, v_old.po_number, v_title, v_fields);
END;
$function$;

-- Cancelling is refused once goods have been received against the purchase order
CREATE FUNCTION public.cancel_purchase_order(
  p_organization_id uuid,
  p_purchase_order_id uuid,
  p_reason text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.purchase_orders%ROWTYPE;
  v_order_ids uuid[];
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditPurchases');

  SELECT * INTO v_old FROM public.purchase_orders WHERE id = p_purchase_order_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此採購單' USING ERRCODE = 'P0002', HINT = 'purchase_order_not_found';
  END IF;
  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION '採購單 % 已取消', v_old.po_number USING ERRCODE = '55000', HINT = 'purchase_order_already_cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventories WHERE purchase_order_id = p_purchase_order_id) THEN
    RAISE EXCEPTION '採購單 % 已有入庫紀錄，不能取消', v_old.po_number USING ERRCODE = '55000', HINT = 'purchase_order_received';
  END IF;

  v_title := format('取消採購單 %s', v_old.po_number);
  v_fields := public.api_changed_fields('狀態', public.api_purchase_status_label(v_old.status::text), '已取消')
    || public.api_fields('取消原因', public.api_clean(p_reason));
  IF p_dry_run THEN
    RETURN public.api_result(true, p_purchase_order_id, v_old.po_number, v_title, v_fields);
  END IF;

  UPDATE public.purchase_orders
  SET status = 'cancelled', cancelled_at = now(), cancel_reason = public.api_clean(p_reason)
  WHERE id = p_purchase_order_id;

  -- Linked orders stay linked (for the record) but no longer count this purchase order as placed
  SELECT coalesce(array_agg(order_id), '{}') INTO v_order_ids FROM public.purchase_order_relations WHERE purchase_order_id = p_purchase_order_id;
  PERFORM public.api_release_orders(array_append(v_order_ids, v_old.order_id));

  RETURN public.api_result(false, p_purchase_order_id, v_old.po_number, v_title, v_fields);
END;
$function$;

REVOKE ALL ON FUNCTION public.api_purchase_status_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_date(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_purchase_order_numbers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_purchase_order_fields(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_check_purchase_products(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_check_purchase_factory(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_check_purchase_orders(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_release_orders(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_link_purchase_orders(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_purchase_order(uuid, uuid, jsonb, uuid[], date, text, date, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_purchase_order(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_purchase_order(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid, uuid, jsonb, uuid[], date, text, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_purchase_order(uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(uuid, uuid, text, boolean) TO authenticated;
