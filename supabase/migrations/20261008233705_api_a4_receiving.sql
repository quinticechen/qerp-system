-- 業務 API A4 入庫（進貨單）（docs/BUSINESS_API.md §3、§5）
--
-- 1. save_inventory_rolls 的錯誤改為 SQLSTATE＋HINT 代碼（訊息與鎖定規則不變）；新增布卷沒有給編號時由系統產生，
--    重複的布卷編號回報 roll_number_taken；同一次新增的布卷依傳入順序排列
-- 2. receive_inventory：依採購單入庫，進貨單編號 I＋YYYYMMDD＋四位流水號（B8）；工廠沿用採購單；
--    布卷的產品必須在採購單上；已取消的採購單不能入庫；超過採購量仍可入庫，摘要會列出
-- 3. update_inventory（到貨日期、備註、完整布卷清單）、update_inventory_roll（單一布卷的重量、品質、倉庫、貨架）

-- ===== 1. save_inventory_rolls：錯誤代碼

-- A new roll number in the existing format: R + YYMMDD (Taiwan) + nine random digits, unused so far
CREATE FUNCTION public.api_new_roll_number()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public'
AS $function$
DECLARE
  v_number text;
BEGIN
  LOOP
    v_number := 'R' || to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYMMDD') || lpad(floor(random() * 1e9)::bigint::text, 9, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.inventory_rolls WHERE roll_number = v_number);
  END LOOP;
  RETURN v_number;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_inventory_rolls(p_inventory_id uuid, p_rolls jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_roll record;
  v_existing inventory_rolls;
  v_shipped numeric;
  v_number text;
begin
  select organization_id into v_org from inventories where id = p_inventory_id for update;
  if not found then
    raise exception '找不到入庫紀錄，或沒有編輯權限' using errcode = 'P0002', hint = 'inventory_not_found';
  end if;
  if jsonb_typeof(coalesce(p_rolls, '[]')) <> 'array' or jsonb_array_length(coalesce(p_rolls, '[]')) = 0 then
    raise exception '入庫紀錄至少需要一卷布' using errcode = '22023', hint = 'rolls_required';
  end if;

  for v_roll in
    select * from jsonb_to_recordset(p_rolls)
      as x(id uuid, product_id uuid, warehouse_id uuid, shelf text, quality fabric_quality,
           quantity numeric, roll_number text, specifications jsonb)
  loop
    if v_roll.product_id is null
      or not exists (select 1 from products_new where id = v_roll.product_id and organization_id = v_org) then
      raise exception '請選擇此組織的產品' using errcode = 'P0002', hint = 'product_not_found';
    end if;
    if v_roll.warehouse_id is null
      or not exists (select 1 from warehouses where id = v_roll.warehouse_id and organization_id = v_org) then
      raise exception '請選擇此組織的倉庫' using errcode = 'P0002', hint = 'warehouse_not_found';
    end if;
    if coalesce(v_roll.quantity, 0) <= 0 then
      raise exception '布卷重量必須大於 0' using errcode = '22023', hint = 'invalid_quantity';
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
      raise exception '布卷「%」已出貨，不可刪除', v_existing.roll_number using errcode = '55000', hint = 'roll_shipped';
    end if;
    delete from inventory_rolls where id = v_existing.id;
  end loop;

  for v_roll in
    select * from jsonb_to_recordset(p_rolls)
      as x(id uuid, product_id uuid, warehouse_id uuid, shelf text, quality fabric_quality,
           quantity numeric, roll_number text, specifications jsonb)
  loop
    if v_roll.id is null then
      v_number := coalesce(nullif(trim(v_roll.roll_number), ''), api_new_roll_number());
      if exists (select 1 from inventory_rolls where roll_number = v_number) then
        raise exception '布卷編號「%」已被使用', v_number using errcode = '23505', hint = 'roll_number_taken';
      end if;
      -- clock_timestamp() rather than now(): rolls added in one call keep the order they were given in
      insert into inventory_rolls (inventory_id, product_id, warehouse_id, shelf, quality, quantity, current_quantity, roll_number, specifications, created_at)
      values (p_inventory_id, v_roll.product_id, v_roll.warehouse_id, nullif(trim(v_roll.shelf), ''),
              coalesce(v_roll.quality, 'A'), v_roll.quantity, v_roll.quantity, v_number, v_roll.specifications, clock_timestamp());
      continue;
    end if;

    select * into v_existing from inventory_rolls where id = v_roll.id and inventory_id = p_inventory_id;
    if not found then
      raise exception '布卷不屬於此入庫紀錄' using errcode = 'P0002', hint = 'roll_not_found';
    end if;

    if v_roll.product_id <> v_existing.product_id
      and exists (select 1 from shipping_items where inventory_roll_id = v_existing.id) then
      raise exception '布卷「%」已出貨，不可更換產品', v_existing.roll_number using errcode = '55000', hint = 'roll_shipped';
    end if;

    -- Shipped weight stays fixed; current stock follows the corrected received weight
    v_shipped := v_existing.quantity - v_existing.current_quantity;
    if v_roll.quantity < v_shipped then
      raise exception '布卷「%」的入庫重量不可低於已出貨 % 公斤', v_existing.roll_number, v_shipped
        using errcode = '55000', hint = 'quantity_below_shipped';
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
$function$;

-- ===== 2. 輔助函式

CREATE FUNCTION public.api_quality_label(p_quality text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE p_quality WHEN 'defective' THEN '瑕疵' ELSE p_quality || ' 級' END;
$function$;

-- 「R2610080001 產品 - 顏色 100 公斤（A 級，倉庫 一號倉 B-03）」 for a roll
CREATE FUNCTION public.api_roll_label(
  p_roll_number text, p_product_id uuid, p_quantity numeric, p_quality text, p_warehouse_id uuid, p_shelf text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT concat_ws(' ', p_roll_number, public.api_product_label(p_product_id), public.api_number(p_quantity) || ' 公斤')
    || '（' || public.api_quality_label(p_quality)
    || coalesce('，倉庫 ' || (SELECT name FROM public.warehouses WHERE id = p_warehouse_id), '')
    || coalesce(' ' || public.api_clean(p_shelf), '') || '）';
$function$;

-- Card fields describing a whole receiving batch: purchase order, factory, date, rolls per product, note, totals,
-- and any product received beyond what was ordered
CREATE FUNCTION public.api_inventory_fields(p_inventory_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT public.api_fields('採購單', po.po_number, '工廠', f.name, '到貨日期', i.arrival_date::text)
    || coalesce((
         SELECT jsonb_agg(jsonb_build_object('label', '產品 ' || rn,
                  'value', public.api_product_label(product_id) || ' × ' || rolls || ' 卷，共 ' || public.api_number(qty) || ' 公斤') ORDER BY rn)
         FROM (SELECT product_id, count(*) AS rolls, sum(quantity) AS qty, row_number() OVER (ORDER BY min(created_at)) AS rn
               FROM public.inventory_rolls WHERE inventory_id = i.id GROUP BY product_id) per_product
       ), '[]'::jsonb)
    || public.api_fields(
         '備註', i.note,
         '合計', (SELECT count(*) || ' 卷，' || public.api_number(sum(quantity)) || ' 公斤' FROM public.inventory_rolls WHERE inventory_id = i.id))
    || coalesce((
         SELECT jsonb_agg(jsonb_build_object('label', '超過採購量',
                  'value', public.api_product_label(poi.product_id) || ' 已入庫 ' || public.api_number(poi.received_quantity)
                    || ' 公斤，採購 ' || public.api_number(poi.ordered_quantity) || ' 公斤')
                  ORDER BY poi.created_at)
         FROM public.purchase_order_items poi
         WHERE poi.purchase_order_id = i.purchase_order_id AND poi.received_quantity > poi.ordered_quantity
           AND EXISTS (SELECT 1 FROM public.inventory_rolls ir WHERE ir.inventory_id = i.id AND ir.product_id = poi.product_id)
       ), '[]'::jsonb)
  FROM public.inventories i
  JOIN public.purchase_orders po ON po.id = i.purchase_order_id
  JOIN public.factories f ON f.id = i.factory_id
  WHERE i.id = p_inventory_id;
$function$;

-- Raise unless every roll's product is on the purchase order. Rolls that keep their product
-- (same id and product as before) are left alone.
CREATE FUNCTION public.api_check_inventory_products(p_organization_id uuid, p_purchase_order_id uuid, p_inventory_id uuid, p_rolls jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_roll record;
BEGIN
  IF p_rolls IS NULL OR jsonb_typeof(p_rolls) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION '入庫紀錄至少需要一卷布' USING ERRCODE = '22023', HINT = 'rolls_required';
  END IF;

  FOR v_roll IN SELECT * FROM jsonb_to_recordset(p_rolls) AS x(id uuid, product_id uuid) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.products_new WHERE id = v_roll.product_id AND organization_id = p_organization_id) THEN
      RAISE EXCEPTION '找不到此產品' USING ERRCODE = 'P0002', HINT = 'product_not_found';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id = p_purchase_order_id AND product_id = v_roll.product_id)
       AND NOT EXISTS (SELECT 1 FROM public.inventory_rolls WHERE inventory_id = p_inventory_id AND id = v_roll.id AND product_id = v_roll.product_id) THEN
      RAISE EXCEPTION '產品「%」不在採購單上', public.api_product_label(v_roll.product_id)
        USING ERRCODE = '22023', HINT = 'product_not_on_purchase_order';
    END IF;
  END LOOP;
END;
$function$;

-- Roll-level change lines (removed, changed, added) between a snapshot taken before a save and the rolls now
CREATE FUNCTION public.api_roll_changes(p_inventory_id uuid, p_old_rolls jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce((
           SELECT jsonb_agg(jsonb_build_object('label', '移除布卷', 'value',
                    public.api_roll_label(old.value->>'roll_number', (old.value->>'product_id')::uuid, (old.value->>'quantity')::numeric,
                      old.value->>'quality', (old.value->>'warehouse_id')::uuid, old.value->>'shelf')))
           FROM jsonb_each(p_old_rolls) AS old
           WHERE NOT EXISTS (SELECT 1 FROM public.inventory_rolls WHERE id = old.key::uuid)
         ), '[]'::jsonb)
    || coalesce((
         SELECT jsonb_agg(jsonb_build_object('label', '修改布卷', 'value',
                  public.api_roll_label(old.value->>'roll_number', (old.value->>'product_id')::uuid, (old.value->>'quantity')::numeric,
                    old.value->>'quality', (old.value->>'warehouse_id')::uuid, old.value->>'shelf')
                  || ' → ' || public.api_roll_label(ir.roll_number, ir.product_id, ir.quantity, ir.quality::text, ir.warehouse_id, ir.shelf))
                ORDER BY ir.created_at)
         FROM jsonb_each(p_old_rolls) AS old JOIN public.inventory_rolls ir ON ir.id = old.key::uuid
         WHERE ir.product_id <> (old.value->>'product_id')::uuid
            OR ir.quantity <> (old.value->>'quantity')::numeric
            OR ir.quality::text <> old.value->>'quality'
            OR ir.warehouse_id <> (old.value->>'warehouse_id')::uuid
            OR ir.shelf IS DISTINCT FROM old.value->>'shelf'
       ), '[]'::jsonb)
    || coalesce((
         SELECT jsonb_agg(jsonb_build_object('label', '新增布卷', 'value',
                  public.api_roll_label(ir.roll_number, ir.product_id, ir.quantity, ir.quality::text, ir.warehouse_id, ir.shelf)) ORDER BY ir.created_at)
         FROM public.inventory_rolls ir
         WHERE ir.inventory_id = p_inventory_id AND NOT p_old_rolls ? ir.id::text
       ), '[]'::jsonb);
$function$;

-- Snapshot of a batch's rolls, keyed by roll id, for api_roll_changes
CREATE FUNCTION public.api_roll_snapshot(p_inventory_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_object_agg(id, jsonb_build_object('roll_number', roll_number, 'product_id', product_id, 'quantity', quantity,
           'quality', quality, 'warehouse_id', warehouse_id, 'shelf', shelf)), '{}')
  FROM public.inventory_rolls WHERE inventory_id = p_inventory_id;
$function$;

-- ===== 3. 入庫 API

-- p_rolls: [{ product_id, quantity, warehouse_id, shelf?, quality? (A/B/C/D/defective, default A), roll_number?, specifications? }]
CREATE FUNCTION public.receive_inventory(
  p_organization_id uuid,
  p_purchase_order_id uuid,
  p_rolls jsonb,
  p_arrival_date date DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_id uuid;
  v_number text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateInventory');

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_purchase_order_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此採購單' USING ERRCODE = 'P0002', HINT = 'purchase_order_not_found';
  END IF;
  IF v_po.status = 'cancelled' THEN
    RAISE EXCEPTION '採購單 % 已取消，不能入庫', v_po.po_number USING ERRCODE = '55000', HINT = 'purchase_order_cancelled';
  END IF;
  PERFORM public.api_check_inventory_products(p_organization_id, p_purchase_order_id, NULL, p_rolls);

  -- Write for real; a dry run rolls this block back after collecting the summary
  BEGIN
    v_number := public.api_next_document_number(p_organization_id, 'receiving');
    INSERT INTO public.inventories (receipt_number, purchase_order_id, factory_id, organization_id, user_id, arrival_date, note)
    VALUES (v_number, p_purchase_order_id, v_po.factory_id, p_organization_id, auth.uid(),
            coalesce(p_arrival_date, (now() AT TIME ZONE 'Asia/Taipei')::date), public.api_clean(p_note))
    RETURNING id INTO v_id;

    PERFORM public.save_inventory_rolls(v_id, public.api_order_items_payload(p_rolls, false));

    v_fields := public.api_inventory_fields(v_id);
    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, NULL, NULL, '入庫', v_fields);
  END;

  RETURN public.api_result(false, v_id, v_number, '入庫', v_fields);
END;
$function$;

-- p_changes may hold: rolls (the complete list, as save_inventory_rolls expects), arrival_date, note
CREATE FUNCTION public.update_inventory(
  p_organization_id uuid,
  p_inventory_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.inventories%ROWTYPE;
  v_new public.inventories%ROWTYPE;
  v_old_rolls jsonb;
  v_arrival date;
  v_fields jsonb;
  v_title text;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditInventory');
  PERFORM public.api_check_change_keys(p_changes, ARRAY['rolls', 'arrival_date', 'note']);

  SELECT * INTO v_old FROM public.inventories WHERE id = p_inventory_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此入庫紀錄' USING ERRCODE = 'P0002', HINT = 'inventory_not_found';
  END IF;

  IF p_changes ? 'rolls' THEN
    PERFORM public.api_check_inventory_products(p_organization_id, v_old.purchase_order_id, p_inventory_id, p_changes->'rolls');
  END IF;
  v_arrival := CASE WHEN p_changes ? 'arrival_date' THEN coalesce(public.api_date(p_changes->>'arrival_date'), v_old.arrival_date) ELSE v_old.arrival_date END;

  v_old_rolls := public.api_roll_snapshot(p_inventory_id);
  v_title := format('修改進貨單 %s', v_old.receipt_number);

  BEGIN
    IF p_changes ? 'rolls' THEN
      PERFORM public.save_inventory_rolls(p_inventory_id, public.api_order_items_payload(p_changes->'rolls', true));
    END IF;

    UPDATE public.inventories
    SET arrival_date = v_arrival, note = public.api_changed(p_changes, 'note', note)
    WHERE id = p_inventory_id
    RETURNING * INTO v_new;

    v_fields := public.api_changed_fields('到貨日期', v_old.arrival_date::text, v_new.arrival_date::text, '備註', v_old.note, v_new.note)
      || public.api_roll_changes(p_inventory_id, v_old_rolls);

    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, p_inventory_id, v_old.receipt_number, v_title, v_fields);
  END;

  RETURN public.api_result(false, p_inventory_id, v_old.receipt_number, v_title, v_fields);
END;
$function$;

-- One roll: p_changes may hold quantity (received weight), quality, warehouse_id, shelf
CREATE FUNCTION public.update_inventory_roll(
  p_organization_id uuid,
  p_roll_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_roll public.inventory_rolls%ROWTYPE;
  v_receipt text;
  v_old_rolls jsonb;
  v_rolls jsonb;
  v_fields jsonb;
  v_title text;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditInventory');
  PERFORM public.api_check_change_keys(p_changes, ARRAY['quantity', 'quality', 'warehouse_id', 'shelf']);

  SELECT ir.* INTO v_roll
  FROM public.inventory_rolls ir JOIN public.inventories i ON i.id = ir.inventory_id
  WHERE ir.id = p_roll_id AND i.organization_id = p_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此布卷' USING ERRCODE = 'P0002', HINT = 'roll_not_found';
  END IF;
  IF p_changes ? 'quality' AND coalesce(p_changes->>'quality', '') NOT IN ('A', 'B', 'C', 'D', 'defective') THEN
    RAISE EXCEPTION '品質等級不正確' USING ERRCODE = '22023', HINT = 'invalid_quality';
  END IF;
  SELECT receipt_number INTO v_receipt FROM public.inventories WHERE id = v_roll.inventory_id;

  -- The batch's complete roll list with this roll changed, so save_inventory_rolls applies the usual rules
  SELECT jsonb_agg(jsonb_build_object(
           'id', ir.id, 'product_id', ir.product_id, 'specifications', ir.specifications,
           'warehouse_id', CASE WHEN ir.id = p_roll_id AND p_changes ? 'warehouse_id' THEN p_changes->>'warehouse_id' ELSE ir.warehouse_id::text END,
           'shelf', CASE WHEN ir.id = p_roll_id AND p_changes ? 'shelf' THEN p_changes->>'shelf' ELSE ir.shelf END,
           'quality', CASE WHEN ir.id = p_roll_id AND p_changes ? 'quality' THEN p_changes->>'quality' ELSE ir.quality::text END,
           'quantity', CASE WHEN ir.id = p_roll_id AND p_changes ? 'quantity' THEN p_changes->'quantity' ELSE to_jsonb(ir.quantity) END)
         ORDER BY ir.created_at)
  INTO v_rolls FROM public.inventory_rolls ir WHERE ir.inventory_id = v_roll.inventory_id;

  v_old_rolls := public.api_roll_snapshot(v_roll.inventory_id);
  v_title := format('修改布卷 %s', v_roll.roll_number);

  BEGIN
    PERFORM public.save_inventory_rolls(v_roll.inventory_id, v_rolls);
    v_fields := public.api_fields('進貨單', v_receipt) || public.api_roll_changes(v_roll.inventory_id, v_old_rolls);
    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, p_roll_id, v_roll.roll_number, v_title, v_fields);
  END;

  RETURN public.api_result(false, p_roll_id, v_roll.roll_number, v_title, v_fields);
END;
$function$;

-- save_inventory_rolls runs as its caller, so members need the roll number generator too
REVOKE ALL ON FUNCTION public.api_new_roll_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_new_roll_number() TO authenticated;
REVOKE ALL ON FUNCTION public.api_quality_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_roll_label(text, uuid, numeric, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_inventory_fields(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_check_inventory_products(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_roll_changes(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_roll_snapshot(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.receive_inventory(uuid, uuid, jsonb, date, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_inventory(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_inventory_roll(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_inventory(uuid, uuid, jsonb, date, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventory(uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventory_roll(uuid, uuid, jsonb, boolean) TO authenticated;
