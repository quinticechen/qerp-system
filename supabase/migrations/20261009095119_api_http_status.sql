-- 業務 API 錯誤改回 4xx HTTP 狀態（docs/BUSINESS_API.md §2.3）
--
-- 原本以 RAISE ... USING ERRCODE, HINT 回報錯誤，PostgREST 依 SQLSTATE 決定 HTTP 狀態：
-- 22023 → 400、42501 → 403，但 P0002（找不到）與 55000（目前狀態不允許）都變成 500，看起來像伺服器故障。
-- 改由 api_fail() 以 PostgREST 的自訂錯誤（SQLSTATE 'PGRST'）回報：
--   回應內容不變：{ code: SQLSTATE, message: 中文訊息, hint: 固定代碼 }，前端與 AI tools 不需修改
--   HTTP 狀態：42501 → 403、P0002 → 404、23505 → 409、55000 → 409、其他（22023 等）→ 400
-- 在資料庫內（SQL 測試、其他函式）看到的 SQLSTATE 改為 PGRST，原本的 code、message、hint 放在 MESSAGE 的 JSON 中。
-- 以下各函式只把錯誤寫法換成 api_fail()，邏輯與訊息都不變；由產生器從各函式最新的定義轉換。

CREATE FUNCTION public.api_fail(p_code text, p_hint text, p_message text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE SQLSTATE 'PGRST' USING
    MESSAGE = json_build_object('code', p_code, 'message', p_message, 'details', NULL, 'hint', p_hint)::text,
    DETAIL = json_build_object('status', CASE p_code
      WHEN '42501' THEN 403
      WHEN 'P0002' THEN 404
      WHEN '23505' THEN 409
      WHEN '55000' THEN 409
      ELSE 400 END)::text;
END;
$function$;

-- save_* functions run as their caller, so members need it too; it only raises
REVOKE ALL ON FUNCTION public.api_fail(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_fail(text, text, text) TO authenticated;

-- add_product_color（原定義：20261008185816_api_a6_products.sql）
CREATE OR REPLACE FUNCTION public.add_product_color(
  p_organization_id uuid,
  p_product_id uuid,
  p_color text,
  p_color_code text DEFAULT NULL,
  p_color_hex text DEFAULT NULL,
  p_stock_threshold numeric DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_group public.product_groups%ROWTYPE;
  v_color text := public.api_clean(p_color);
  v_color_code text := public.api_clean(p_color_code);
  v_color_hex text := public.api_clean(p_color_hex);
  v_id uuid;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateProducts');

  SELECT * INTO v_group FROM public.product_groups WHERE id = p_product_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'product_not_found', '找不到此產品');
  END IF;
  PERFORM public.api_check_product_color(p_product_id, v_color, v_color_code, v_color_hex, p_stock_threshold, NULL);

  v_title := format('新增顏色到「%s」', v_group.name);
  v_fields := public.api_fields('顏色', v_color, '色號', v_color_code, '色值', v_color_hex,
    '安全庫存', public.api_number(p_stock_threshold) || ' 公斤');
  IF p_dry_run THEN
    RETURN public.api_result(true, NULL, NULL, v_title, v_fields);
  END IF;

  INSERT INTO public.products_new (group_id, organization_id, name, color, color_code, color_hex, stock_thresholds, status, user_id)
  VALUES (p_product_id, p_organization_id, v_group.name, v_color, v_color_code, v_color_hex, p_stock_threshold, 'Available', auth.uid())
  RETURNING id INTO v_id;

  RETURN public.api_result(false, v_id, NULL, v_title, v_fields);
END;
$function$;

-- api_assign_document_number（原定義：20261008181853_api_a2_orders.sql）
CREATE OR REPLACE FUNCTION public.api_assign_document_number(p_organization_id uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.user_belongs_to_organization(auth.uid(), p_organization_id)
     AND NOT public.is_organization_owner(auth.uid(), p_organization_id) THEN
    PERFORM public.api_fail('42501', 'forbidden', '您的角色沒有權限執行此操作');
  END IF;
  RETURN public.api_next_document_number(p_organization_id, p_kind);
END;
$function$;

-- api_check_change_keys（原定義：20261008170920_api_a1_customers_factories.sql）
CREATE OR REPLACE FUNCTION public.api_check_change_keys(p_changes jsonb, p_allowed text[])
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_unknown text;
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    PERFORM public.api_fail('22023', 'invalid_changes', '修改內容格式不正確');
  END IF;
  SELECT string_agg(k, '、') INTO v_unknown FROM jsonb_object_keys(p_changes) AS k WHERE k <> ALL (p_allowed);
  IF v_unknown IS NOT NULL THEN
    PERFORM public.api_fail('22023', 'unknown_field', format('不支援修改的欄位：%s', v_unknown));
  END IF;
END;
$function$;

-- api_check_inventory_products（原定義：20261008233705_api_a4_receiving.sql）
CREATE OR REPLACE FUNCTION public.api_check_inventory_products(p_organization_id uuid, p_purchase_order_id uuid, p_inventory_id uuid, p_rolls jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_roll record;
BEGIN
  IF p_rolls IS NULL OR jsonb_typeof(p_rolls) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    PERFORM public.api_fail('22023', 'rolls_required', '入庫紀錄至少需要一卷布');
  END IF;

  FOR v_roll IN SELECT * FROM jsonb_to_recordset(p_rolls) AS x(id uuid, product_id uuid) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.products_new WHERE id = v_roll.product_id AND organization_id = p_organization_id) THEN
      PERFORM public.api_fail('P0002', 'product_not_found', '找不到此產品');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id = p_purchase_order_id AND product_id = v_roll.product_id)
       AND NOT EXISTS (SELECT 1 FROM public.inventory_rolls WHERE inventory_id = p_inventory_id AND id = v_roll.id AND product_id = v_roll.product_id) THEN
      PERFORM public.api_fail('22023', 'product_not_on_purchase_order', format('產品「%s」不在採購單上', public.api_product_label(v_roll.product_id)));
    END IF;
  END LOOP;
END;
$function$;

-- api_check_order_factories（原定義：20261008181853_api_a2_orders.sql）
CREATE OR REPLACE FUNCTION public.api_check_order_factories(p_organization_id uuid, p_order_id uuid, p_factory_ids uuid[])
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory record;
BEGIN
  FOR v_factory IN
    SELECT ids.id, f.name, f.is_active, f.organization_id
    FROM unnest(coalesce(p_factory_ids, '{}')) AS ids(id) LEFT JOIN public.factories f ON f.id = ids.id
  LOOP
    IF v_factory.organization_id IS DISTINCT FROM p_organization_id THEN
      PERFORM public.api_fail('P0002', 'factory_not_found', '找不到此工廠');
    END IF;
    IF NOT v_factory.is_active AND NOT EXISTS (
      SELECT 1 FROM public.order_factories WHERE order_id = p_order_id AND factory_id = v_factory.id
    ) THEN
      PERFORM public.api_fail('22023', 'factory_inactive', format('工廠「%s」已停用', v_factory.name));
    END IF;
  END LOOP;
END;
$function$;

-- api_check_order_products（原定義：20261008185816_api_a6_products.sql）
CREATE OR REPLACE FUNCTION public.api_check_order_products(p_organization_id uuid, p_order_id uuid, p_items jsonb)
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
    PERFORM public.api_fail('22023', 'items_required', '訂單至少需要一項產品');
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id uuid, product_id uuid) LOOP
    SELECT p.status IS DISTINCT FROM 'Unavailable' AND g.is_active INTO v_available
    FROM public.products_new p JOIN public.product_groups g ON g.id = p.group_id
    WHERE p.id = v_line.product_id AND p.organization_id = p_organization_id;
    IF NOT FOUND THEN
      PERFORM public.api_fail('P0002', 'product_not_found', '找不到此產品');
    END IF;
    -- Lines that keep their product may keep one that was disabled since
    IF NOT v_available AND NOT EXISTS (
      SELECT 1 FROM public.order_products
      WHERE order_id = p_order_id AND id = v_line.id AND product_id = v_line.product_id
    ) THEN
      PERFORM public.api_fail('22023', 'product_unavailable', format('產品「%s」已停用', public.api_product_label(v_line.product_id)));
    END IF;
  END LOOP;
END;
$function$;

-- api_check_product_color（原定義：20261008185816_api_a6_products.sql）
CREATE OR REPLACE FUNCTION public.api_check_product_color(
  p_group_id uuid, p_color text, p_color_code text, p_color_hex text, p_stock_threshold numeric, p_except_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_color IS NULL THEN
    PERFORM public.api_fail('22023', 'color_required', '請輸入顏色');
  END IF;
  IF p_color_hex IS NOT NULL AND p_color_hex !~ '^#[0-9A-Fa-f]{6}$' THEN
    PERFORM public.api_fail('22023', 'invalid_color_hex', '色值格式不正確，請使用 #RRGGBB');
  END IF;
  IF p_stock_threshold IS NOT NULL AND p_stock_threshold < 0 THEN
    PERFORM public.api_fail('22023', 'invalid_stock_threshold', '安全庫存不可為負數');
  END IF;
  IF p_group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.products_new
    WHERE group_id = p_group_id AND id IS DISTINCT FROM p_except_id
      AND lower(btrim(coalesce(color, ''))) = lower(p_color)
      AND lower(btrim(coalesce(color_code, ''))) = lower(coalesce(p_color_code, ''))
  ) THEN
    PERFORM public.api_fail('23505', 'product_color_taken', format('此產品已有顏色「%s」', p_color || coalesce('（色號 ' || p_color_code || '）', '')));
  END IF;
END;
$function$;

-- api_check_product_name（原定義：20261008185816_api_a6_products.sql）
CREATE OR REPLACE FUNCTION public.api_check_product_name(p_organization_id uuid, p_name text, p_except_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_name IS NULL THEN
    PERFORM public.api_fail('22023', 'name_required', '請輸入產品名稱');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_groups
    WHERE organization_id = p_organization_id AND lower(name) = lower(p_name) AND id IS DISTINCT FROM p_except_id
  ) THEN
    PERFORM public.api_fail('23505', 'product_name_taken', format('已有同名的產品「%s」，請在該產品下新增顏色', p_name));
  END IF;
END;
$function$;

-- api_check_purchase_factory（原定義：20261008193554_api_a3_purchase_orders.sql）
CREATE OR REPLACE FUNCTION public.api_check_purchase_factory(p_organization_id uuid, p_factory_id uuid, p_current_factory_id uuid)
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
    PERFORM public.api_fail('P0002', 'factory_not_found', '找不到此工廠');
  END IF;
  IF NOT v_factory.is_active AND p_factory_id IS DISTINCT FROM p_current_factory_id THEN
    PERFORM public.api_fail('22023', 'factory_inactive', format('工廠「%s」已停用', v_factory.name));
  END IF;
END;
$function$;

-- api_check_purchase_orders（原定義：20261008193554_api_a3_purchase_orders.sql）
CREATE OR REPLACE FUNCTION public.api_check_purchase_orders(p_organization_id uuid, p_purchase_order_id uuid, p_order_ids uuid[])
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
      PERFORM public.api_fail('P0002', 'order_not_found', '找不到此訂單');
    END IF;
    IF v_order.status = 'cancelled' AND NOT EXISTS (
      SELECT 1 FROM public.purchase_order_relations WHERE purchase_order_id = p_purchase_order_id AND order_id = v_order.id
    ) THEN
      PERFORM public.api_fail('55000', 'order_cancelled', format('訂單 %s 已取消', v_order.order_number));
    END IF;
  END LOOP;
END;
$function$;

-- api_check_purchase_products（原定義：20261008193554_api_a3_purchase_orders.sql）
CREATE OR REPLACE FUNCTION public.api_check_purchase_products(p_organization_id uuid, p_purchase_order_id uuid, p_items jsonb)
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
    PERFORM public.api_fail('22023', 'items_required', '採購單至少需要一項產品');
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id uuid, product_id uuid) LOOP
    SELECT p.status IS DISTINCT FROM 'Unavailable' AND g.is_active INTO v_available
    FROM public.products_new p JOIN public.product_groups g ON g.id = p.group_id
    WHERE p.id = v_line.product_id AND p.organization_id = p_organization_id;
    IF NOT FOUND THEN
      PERFORM public.api_fail('P0002', 'product_not_found', '找不到此產品');
    END IF;
    IF NOT v_available AND NOT EXISTS (
      SELECT 1 FROM public.purchase_order_items
      WHERE purchase_order_id = p_purchase_order_id AND id = v_line.id AND product_id = v_line.product_id
    ) THEN
      PERFORM public.api_fail('22023', 'product_unavailable', format('產品「%s」已停用', public.api_product_label(v_line.product_id)));
    END IF;
  END LOOP;
END;
$function$;

-- api_check_shelf_name（原定義：20261009003415_api_a6_shelves.sql）
CREATE OR REPLACE FUNCTION public.api_check_shelf_name(p_organization_id uuid, p_name text, p_except_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_name IS NULL THEN
    PERFORM public.api_fail('22023', 'name_required', '請輸入貨架名稱');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.warehouses
    WHERE organization_id = p_organization_id AND lower(btrim(name)) = lower(p_name) AND id IS DISTINCT FROM p_except_id
  ) THEN
    PERFORM public.api_fail('23505', 'shelf_name_taken', format('已有同名的貨架「%s」', p_name));
  END IF;
END;
$function$;

-- api_date（原定義：20261008193554_api_a3_purchase_orders.sql）
CREATE OR REPLACE FUNCTION public.api_date(p_value text)
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
  PERFORM public.api_fail('22023', 'invalid_date', format('日期格式不正確：%s', p_value));
END;
$function$;

-- api_require_permission（原定義：20261008170920_api_a1_customers_factories.sql）
CREATE OR REPLACE FUNCTION public.api_require_permission(p_organization_id uuid, p_permission text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    PERFORM public.api_fail('42501', 'not_signed_in', '請先登入');
  END IF;
  IF p_organization_id IS NULL OR NOT public.user_has_organization_permission(auth.uid(), p_organization_id, p_permission) THEN
    PERFORM public.api_fail('42501', 'forbidden', '您的角色沒有權限執行此操作');
  END IF;
END;
$function$;

-- api_validate_contact（原定義：20261008170920_api_a1_customers_factories.sql）
CREATE OR REPLACE FUNCTION public.api_validate_contact(
  p_entity text, p_name text, p_contact_person text, p_phone text, p_landline_phone text, p_email text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_name IS NULL THEN
    PERFORM public.api_fail('22023', 'name_required', format('請輸入%s名稱', p_entity));
  END IF;
  IF p_contact_person IS NULL THEN
    PERFORM public.api_fail('22023', 'contact_person_required', '請輸入聯絡人');
  END IF;
  IF p_phone IS NULL AND p_landline_phone IS NULL THEN
    PERFORM public.api_fail('22023', 'phone_required', '手機或市話至少填一個');
  END IF;
  IF p_email IS NOT NULL AND p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    PERFORM public.api_fail('22023', 'invalid_email', '電子郵件格式不正確');
  END IF;
END;
$function$;

-- cancel_order（原定義：20261009000604_api_a5_shipping.sql）
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
    PERFORM public.api_fail('P0002', 'order_not_found', '找不到此訂單');
  END IF;
  IF v_old.status = 'cancelled' THEN
    PERFORM public.api_fail('55000', 'order_already_cancelled', format('訂單 %s 已取消', v_old.order_number));
  END IF;
  IF EXISTS (SELECT 1 FROM public.shippings WHERE order_id = p_order_id AND status <> 'cancelled') THEN
    PERFORM public.api_fail('55000', 'order_has_shipments', format('訂單 %s 已有出貨紀錄，不能取消', v_old.order_number));
  END IF;

  SELECT po.po_number INTO v_po_number
  FROM public.purchase_orders po
  WHERE po.status <> 'cancelled'
    AND (po.order_id = p_order_id
         OR EXISTS (SELECT 1 FROM public.purchase_order_relations r WHERE r.purchase_order_id = po.id AND r.order_id = p_order_id))
  ORDER BY po.created_at
  LIMIT 1;
  IF v_po_number IS NOT NULL THEN
    PERFORM public.api_fail('55000', 'order_has_purchase_orders', format('訂單 %s 有進行中的採購單 %s，請先取消採購單', v_old.order_number, v_po_number));
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

-- cancel_purchase_order（原定義：20261008193554_api_a3_purchase_orders.sql）
CREATE OR REPLACE FUNCTION public.cancel_purchase_order(
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
    PERFORM public.api_fail('P0002', 'purchase_order_not_found', '找不到此採購單');
  END IF;
  IF v_old.status = 'cancelled' THEN
    PERFORM public.api_fail('55000', 'purchase_order_already_cancelled', format('採購單 %s 已取消', v_old.po_number));
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventories WHERE purchase_order_id = p_purchase_order_id) THEN
    PERFORM public.api_fail('55000', 'purchase_order_received', format('採購單 %s 已有入庫紀錄，不能取消', v_old.po_number));
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

-- cancel_shipping（原定義：20261009000604_api_a5_shipping.sql）
CREATE OR REPLACE FUNCTION public.cancel_shipping(
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
    PERFORM public.api_fail('P0002', 'shipping_not_found', '找不到此出貨單');
  END IF;
  IF v_old.status = 'cancelled' THEN
    PERFORM public.api_fail('55000', 'shipping_already_cancelled', format('出貨單 %s 已取消', v_old.shipping_number));
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

-- create_customer（原定義：20261008170920_api_a1_customers_factories.sql）
CREATE OR REPLACE FUNCTION public.create_customer(
  p_organization_id uuid,
  p_name text,
  p_contact_person text,
  p_phone text DEFAULT NULL,
  p_landline_phone text DEFAULT NULL,
  p_fax text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := public.api_clean(p_name);
  v_contact_person text := public.api_clean(p_contact_person);
  v_phone text := public.api_clean(p_phone);
  v_landline_phone text := public.api_clean(p_landline_phone);
  v_fax text := public.api_clean(p_fax);
  v_email text := public.api_clean(p_email);
  v_address text := public.api_clean(p_address);
  v_note text := public.api_clean(p_note);
  v_fields jsonb;
  v_id uuid;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateCustomers');
  PERFORM public.api_validate_contact('客戶', v_name, v_contact_person, v_phone, v_landline_phone, v_email);

  IF EXISTS (
    SELECT 1 FROM public.customers
    WHERE organization_id = p_organization_id AND lower(btrim(name)) = lower(v_name)
  ) THEN
    PERFORM public.api_fail('23505', 'customer_name_taken', format('已有同名的客戶「%s」', v_name));
  END IF;

  v_fields := public.api_contact_fields(v_name, v_contact_person, v_phone, v_landline_phone, v_fax, v_email, v_address, v_note);
  IF p_dry_run THEN
    RETURN public.api_result(true, NULL, NULL, '建立客戶', v_fields);
  END IF;

  INSERT INTO public.customers (organization_id, name, contact_person, phone, landline_phone, fax, email, address, note)
  VALUES (p_organization_id, v_name, v_contact_person, v_phone, v_landline_phone, v_fax, v_email, v_address, v_note)
  RETURNING id INTO v_id;

  RETURN public.api_result(false, v_id, NULL, '建立客戶', v_fields);
END;
$function$;

-- create_factory（原定義：20261008170920_api_a1_customers_factories.sql）
CREATE OR REPLACE FUNCTION public.create_factory(
  p_organization_id uuid,
  p_name text,
  p_contact_person text,
  p_phone text DEFAULT NULL,
  p_landline_phone text DEFAULT NULL,
  p_fax text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := public.api_clean(p_name);
  v_contact_person text := public.api_clean(p_contact_person);
  v_phone text := public.api_clean(p_phone);
  v_landline_phone text := public.api_clean(p_landline_phone);
  v_fax text := public.api_clean(p_fax);
  v_email text := public.api_clean(p_email);
  v_address text := public.api_clean(p_address);
  v_note text := public.api_clean(p_note);
  v_fields jsonb;
  v_id uuid;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateFactories');
  PERFORM public.api_validate_contact('工廠', v_name, v_contact_person, v_phone, v_landline_phone, v_email);

  IF EXISTS (
    SELECT 1 FROM public.factories
    WHERE organization_id = p_organization_id AND lower(btrim(name)) = lower(v_name)
  ) THEN
    PERFORM public.api_fail('23505', 'factory_name_taken', format('已有同名的工廠「%s」', v_name));
  END IF;

  v_fields := public.api_contact_fields(v_name, v_contact_person, v_phone, v_landline_phone, v_fax, v_email, v_address, v_note);
  IF p_dry_run THEN
    RETURN public.api_result(true, NULL, NULL, '建立工廠', v_fields);
  END IF;

  INSERT INTO public.factories (organization_id, name, contact_person, phone, landline_phone, fax, email, address, note)
  VALUES (p_organization_id, v_name, v_contact_person, v_phone, v_landline_phone, v_fax, v_email, v_address, v_note)
  RETURNING id INTO v_id;

  RETURN public.api_result(false, v_id, NULL, '建立工廠', v_fields);
END;
$function$;

-- create_order（原定義：20261008181853_api_a2_orders.sql）
CREATE OR REPLACE FUNCTION public.create_order(
  p_organization_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_factory_ids uuid[] DEFAULT '{}',
  p_note text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_id uuid;
  v_number text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateOrders');

  SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'customer_not_found', '找不到此客戶');
  END IF;
  IF NOT v_customer.is_active THEN
    PERFORM public.api_fail('22023', 'customer_inactive', format('客戶「%s」已停用', v_customer.name));
  END IF;

  PERFORM public.api_check_order_products(p_organization_id, NULL, p_items);
  PERFORM public.api_check_order_factories(p_organization_id, NULL, p_factory_ids);

  -- Write for real; a dry run rolls this block back after collecting the summary
  BEGIN
    v_number := public.api_next_document_number(p_organization_id, 'order');
    INSERT INTO public.orders (order_number, customer_id, organization_id, user_id, note, status, payment_status, shipping_status)
    VALUES (v_number, p_customer_id, p_organization_id, auth.uid(), public.api_clean(p_note), 'pending', 'unpaid', 'not_started')
    RETURNING id INTO v_id;

    PERFORM public.save_order_items(v_id, public.api_order_items_payload(p_items, false));

    INSERT INTO public.order_factories (order_id, factory_id)
    SELECT DISTINCT v_id, f FROM unnest(coalesce(p_factory_ids, '{}')) AS f;

    v_fields := public.api_order_fields(v_id);
    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, NULL, NULL, '建立訂單', v_fields);
  END;

  RETURN public.api_result(false, v_id, v_number, '建立訂單', v_fields);
END;
$function$;

-- create_product（原定義：20261008185816_api_a6_products.sql）
CREATE OR REPLACE FUNCTION public.create_product(
  p_organization_id uuid,
  p_name text,
  p_colors jsonb,
  p_category text DEFAULT '布料',
  p_unit_of_measure text DEFAULT 'KG',
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := public.api_clean(p_name);
  v_category text := coalesce(public.api_clean(p_category), '布料');
  v_unit text := coalesce(public.api_clean(p_unit_of_measure), 'KG');
  v_color record;
  v_group_id uuid;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateProducts');
  PERFORM public.api_check_product_name(p_organization_id, v_name, NULL);
  IF p_colors IS NULL OR jsonb_typeof(p_colors) <> 'array' OR jsonb_array_length(p_colors) = 0 THEN
    PERFORM public.api_fail('22023', 'colors_required', '產品至少需要一個顏色');
  END IF;

  -- Write for real; a dry run rolls this block back after collecting the summary
  BEGIN
    INSERT INTO public.product_groups (organization_id, name, category, unit_of_measure, created_by)
    VALUES (p_organization_id, v_name, v_category, v_unit, auth.uid())
    RETURNING id INTO v_group_id;

    FOR v_color IN
      SELECT public.api_clean(x->>'color') AS color, public.api_clean(x->>'color_code') AS color_code,
             public.api_clean(x->>'color_hex') AS color_hex, (x->>'stock_threshold')::numeric AS stock_threshold
      FROM jsonb_array_elements(p_colors) WITH ORDINALITY AS c(x, n) ORDER BY n
    LOOP
      PERFORM public.api_check_product_color(v_group_id, v_color.color, v_color.color_code, v_color.color_hex, v_color.stock_threshold, NULL);
      INSERT INTO public.products_new (group_id, organization_id, name, color, color_code, color_hex, stock_thresholds, status, user_id, created_at)
      VALUES (v_group_id, p_organization_id, v_name, v_color.color, v_color.color_code, v_color.color_hex, v_color.stock_threshold,
              'Available', auth.uid(), clock_timestamp());
    END LOOP;

    v_fields := public.api_fields('產品名稱', v_name, '類別', v_category, '單位', v_unit)
      || (SELECT jsonb_agg(jsonb_build_object('label', '顏色 ' || row_number, 'value', label) ORDER BY row_number)
          FROM (SELECT row_number() OVER (ORDER BY created_at, id), public.api_color_label(color, color_code, stock_thresholds) AS label
                FROM public.products_new WHERE group_id = v_group_id) colors);
    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, NULL, NULL, '建立產品', v_fields);
  END;

  RETURN public.api_result(false, v_group_id, NULL, '建立產品', v_fields);
END;
$function$;

-- create_purchase_order（原定義：20261008193554_api_a3_purchase_orders.sql）
CREATE OR REPLACE FUNCTION public.create_purchase_order(
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
    PERFORM public.api_fail('22023', 'invalid_expected_arrival_date', '預計到貨日期不可早於下單日期');
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

-- create_shipping（原定義：20261009000604_api_a5_shipping.sql）
CREATE OR REPLACE FUNCTION public.create_shipping(
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
    PERFORM public.api_fail('P0002', 'order_not_found', '找不到此訂單');
  END IF;
  IF v_order.status = 'cancelled' THEN
    PERFORM public.api_fail('55000', 'order_cancelled', format('訂單 %s 已取消，不能出貨', v_order.order_number));
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

-- receive_inventory（原定義：20261008233705_api_a4_receiving.sql）
CREATE OR REPLACE FUNCTION public.receive_inventory(
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
    PERFORM public.api_fail('P0002', 'purchase_order_not_found', '找不到此採購單');
  END IF;
  IF v_po.status = 'cancelled' THEN
    PERFORM public.api_fail('55000', 'purchase_order_cancelled', format('採購單 %s 已取消，不能入庫', v_po.po_number));
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

-- save_inventory_rolls（原定義：20261009003415_api_a6_shelves.sql）
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
    PERFORM public.api_fail('P0002', 'inventory_not_found', '找不到入庫紀錄，或沒有編輯權限');
  end if;
  if jsonb_typeof(coalesce(p_rolls, '[]')) <> 'array' or jsonb_array_length(coalesce(p_rolls, '[]')) = 0 then
    PERFORM public.api_fail('22023', 'rolls_required', '入庫紀錄至少需要一卷布');
  end if;

  for v_roll in
    select * from jsonb_to_recordset(p_rolls)
      as x(id uuid, product_id uuid, warehouse_id uuid, shelf text, quality fabric_quality,
           quantity numeric, roll_number text, specifications jsonb)
  loop
    if v_roll.product_id is null
      or not exists (select 1 from products_new where id = v_roll.product_id and organization_id = v_org) then
      PERFORM public.api_fail('P0002', 'product_not_found', '請選擇此組織的產品');
    end if;
    if v_roll.warehouse_id is null
      or not exists (select 1 from warehouses where id = v_roll.warehouse_id and organization_id = v_org) then
      PERFORM public.api_fail('P0002', 'warehouse_not_found', '請選擇此組織的倉庫');
    end if;
    -- New rolls and rolls moved to another shelf need an active one; rolls staying put may stay on a disabled shelf
    if not (select is_active from warehouses where id = v_roll.warehouse_id)
      and not exists (select 1 from inventory_rolls where id = v_roll.id and inventory_id = p_inventory_id and warehouse_id = v_roll.warehouse_id) then
      PERFORM public.api_fail('22023', 'warehouse_inactive', format('貨架「%s」已停用', (select name from warehouses where id = v_roll.warehouse_id)));
    end if;
    if coalesce(v_roll.quantity, 0) <= 0 then
      PERFORM public.api_fail('22023', 'invalid_quantity', '布卷重量必須大於 0');
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
      PERFORM public.api_fail('55000', 'roll_shipped', format('布卷「%s」已出貨，不可刪除', v_existing.roll_number));
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
        PERFORM public.api_fail('23505', 'roll_number_taken', format('布卷編號「%s」已被使用', v_number));
      end if;
      -- clock_timestamp() rather than now(): rolls added in one call keep the order they were given in
      insert into inventory_rolls (inventory_id, product_id, warehouse_id, shelf, quality, quantity, current_quantity, roll_number, specifications, created_at)
      values (p_inventory_id, v_roll.product_id, v_roll.warehouse_id, nullif(trim(v_roll.shelf), ''),
              coalesce(v_roll.quality, 'A'), v_roll.quantity, v_roll.quantity, v_number, v_roll.specifications, clock_timestamp());
      continue;
    end if;

    select * into v_existing from inventory_rolls where id = v_roll.id and inventory_id = p_inventory_id;
    if not found then
      PERFORM public.api_fail('P0002', 'roll_not_found', '布卷不屬於此入庫紀錄');
    end if;

    if v_roll.product_id <> v_existing.product_id
      and exists (select 1 from shipping_items where inventory_roll_id = v_existing.id) then
      PERFORM public.api_fail('55000', 'roll_shipped', format('布卷「%s」已出貨，不可更換產品', v_existing.roll_number));
    end if;

    -- Shipped weight stays fixed; current stock follows the corrected received weight
    v_shipped := v_existing.quantity - v_existing.current_quantity;
    if v_roll.quantity < v_shipped then
      PERFORM public.api_fail('55000', 'quantity_below_shipped', format('布卷「%s」的入庫重量不可低於已出貨 %s 公斤', v_existing.roll_number, v_shipped));
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

-- save_order_items（原定義：20261008181853_api_a2_orders.sql）
CREATE OR REPLACE FUNCTION public.save_order_items(p_order_id uuid, p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_item record;
  v_existing order_products;
  v_name text;
begin
  select organization_id into v_org from orders where id = p_order_id for update;
  if not found then
    PERFORM public.api_fail('P0002', 'order_not_found', '找不到訂單，或沒有編輯權限');
  end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    PERFORM public.api_fail('22023', 'items_required', '訂單至少需要一項產品');
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(id uuid, product_id uuid, quantity numeric, unit_price numeric, specifications jsonb, total_rolls int)
  loop
    if v_item.product_id is null
      or not exists (select 1 from products_new where id = v_item.product_id and organization_id = v_org) then
      PERFORM public.api_fail('P0002', 'product_not_found', '請選擇此組織的產品');
    end if;
    if coalesce(v_item.quantity, 0) <= 0 then
      PERFORM public.api_fail('22023', 'invalid_quantity', '數量必須大於 0');
    end if;
    if coalesce(v_item.unit_price, 0) < 0 then
      PERFORM public.api_fail('22023', 'invalid_unit_price', '單價不可為負數');
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
      PERFORM public.api_fail('55000', 'item_shipped', format('產品「%s」已出貨，不可刪除', v_name));
    end if;
    if order_product_is_purchased(p_order_id, v_existing.product_id) then
      PERFORM public.api_fail('55000', 'item_purchased', format('產品「%s」已採購，不可刪除', v_name));
    end if;
    delete from order_products where id = v_existing.id;
  end loop;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(id uuid, product_id uuid, quantity numeric, unit_price numeric, specifications jsonb, total_rolls int)
  loop
    if v_item.id is null then
      -- clock_timestamp() rather than now(): lines added in one call keep the order they were given in
      insert into order_products (order_id, product_id, quantity, unit_price, specifications, total_rolls, created_at)
      values (p_order_id, v_item.product_id, v_item.quantity, v_item.unit_price, v_item.specifications, v_item.total_rolls, clock_timestamp());
      continue;
    end if;

    select * into v_existing from order_products where id = v_item.id and order_id = p_order_id;
    if not found then
      PERFORM public.api_fail('P0002', 'item_not_found', '訂單項目不屬於此訂單');
    end if;
    select name into v_name from products_new where id = v_existing.product_id;

    if v_item.product_id <> v_existing.product_id then
      if coalesce(v_existing.shipped_quantity, 0) > 0 then
        PERFORM public.api_fail('55000', 'item_shipped', format('產品「%s」已出貨，不可更換產品', v_name));
      end if;
      if order_product_is_purchased(p_order_id, v_existing.product_id) then
        PERFORM public.api_fail('55000', 'item_purchased', format('產品「%s」已採購，不可更換產品', v_name));
      end if;
    end if;
    if v_item.quantity < coalesce(v_existing.shipped_quantity, 0) then
      PERFORM public.api_fail('55000', 'quantity_below_shipped', format('產品「%s」的數量不可低於已出貨 %s 公斤', v_name, v_existing.shipped_quantity));
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
$function$;

-- save_purchase_order_items（原定義：20261008193554_api_a3_purchase_orders.sql）
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
    PERFORM public.api_fail('P0002', 'purchase_order_not_found', '找不到採購單，或沒有編輯權限');
  end if;
  if v_status = 'cancelled' then
    PERFORM public.api_fail('55000', 'purchase_order_cancelled', format('採購單 %s 已取消，不能修改', v_number));
  end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    PERFORM public.api_fail('22023', 'items_required', '採購單至少需要一項產品');
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(id uuid, product_id uuid, ordered_quantity numeric, ordered_rolls int, unit_price numeric, specifications jsonb)
  loop
    if v_item.product_id is null
      or not exists (select 1 from products_new where id = v_item.product_id and organization_id = v_org) then
      PERFORM public.api_fail('P0002', 'product_not_found', '請選擇此組織的產品');
    end if;
    if coalesce(v_item.ordered_quantity, 0) <= 0 then
      PERFORM public.api_fail('22023', 'invalid_quantity', '採購數量必須大於 0');
    end if;
    if coalesce(v_item.unit_price, 0) < 0 then
      PERFORM public.api_fail('22023', 'invalid_unit_price', '單價不可為負數');
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
      PERFORM public.api_fail('55000', 'item_received', format('產品「%s」已入庫，不可刪除', v_name));
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
      PERFORM public.api_fail('P0002', 'item_not_found', '採購項目不屬於此採購單');
    end if;
    select name into v_name from products_new where id = v_existing.product_id;

    if v_item.product_id <> v_existing.product_id and coalesce(v_existing.received_quantity, 0) > 0 then
      PERFORM public.api_fail('55000', 'item_received', format('產品「%s」已入庫，不可更換產品', v_name));
    end if;
    if v_item.ordered_quantity < coalesce(v_existing.received_quantity, 0) then
      PERFORM public.api_fail('55000', 'quantity_below_received', format('產品「%s」的採購數量不可低於已入庫 %s 公斤', v_name, v_existing.received_quantity));
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

-- save_shipping_items（原定義：20261009000604_api_a5_shipping.sql）
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
    PERFORM public.api_fail('P0002', 'shipping_not_found', '找不到出貨單，或沒有編輯權限');
  end if;
  if v_status = 'cancelled' then
    PERFORM public.api_fail('55000', 'shipping_cancelled', format('出貨單 %s 已取消，不能修改', v_number));
  end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    PERFORM public.api_fail('22023', 'items_required', '出貨單至少需要一卷布');
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as x(id uuid, inventory_roll_id uuid, shipped_quantity numeric)
  loop
    if coalesce(v_item.shipped_quantity, 0) <= 0 then
      PERFORM public.api_fail('22023', 'invalid_quantity', '出貨重量必須大於 0');
    end if;
    select ir.* into v_roll
    from inventory_rolls ir join inventories i on i.id = ir.inventory_id
    where ir.id = v_item.inventory_roll_id and i.organization_id = v_org;
    if not found then
      PERFORM public.api_fail('P0002', 'roll_not_found', '請選擇此組織的布卷');
    end if;
    if not exists (select 1 from order_products where order_id = v_order and product_id = v_roll.product_id) then
      PERFORM public.api_fail('22023', 'roll_not_in_order', format('布卷「%s」的產品不在此訂單中', v_roll.roll_number));
    end if;
    if v_item.id is not null
      and not exists (select 1 from shipping_items where id = v_item.id and shipping_id = p_shipping_id) then
      PERFORM public.api_fail('P0002', 'item_not_found', '出貨項目不屬於此出貨單');
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
      PERFORM public.api_fail('55000', 'insufficient_stock', format('布卷「%s」庫存不足，最多可再出貨 %s 公斤', v_roll.roll_number, v_roll.current_quantity));
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

-- set_customer_active（原定義：20261008170920_api_a1_customers_factories.sql）
CREATE OR REPLACE FUNCTION public.set_customer_active(
  p_organization_id uuid,
  p_customer_id uuid,
  p_is_active boolean,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.customers%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditCustomers');
  IF p_is_active IS NULL THEN
    PERFORM public.api_fail('22023', 'is_active_required', '請指定要啟用或停用');
  END IF;

  SELECT * INTO v_old FROM public.customers
  WHERE id = p_customer_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'customer_not_found', '找不到此客戶');
  END IF;

  v_title := format('%s客戶「%s」', CASE WHEN p_is_active THEN '啟用' ELSE '停用' END, v_old.name);
  v_fields := public.api_changed_fields('狀態',
    CASE WHEN v_old.is_active THEN '啟用' ELSE '停用' END,
    CASE WHEN p_is_active THEN '啟用' ELSE '停用' END);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_customer_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.customers SET is_active = p_is_active WHERE id = p_customer_id AND is_active IS DISTINCT FROM p_is_active;

  RETURN public.api_result(false, p_customer_id, NULL, v_title, v_fields);
END;
$function$;

-- set_factory_active（原定義：20261008170920_api_a1_customers_factories.sql）
CREATE OR REPLACE FUNCTION public.set_factory_active(
  p_organization_id uuid,
  p_factory_id uuid,
  p_is_active boolean,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.factories%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditFactories');
  IF p_is_active IS NULL THEN
    PERFORM public.api_fail('22023', 'is_active_required', '請指定要啟用或停用');
  END IF;

  SELECT * INTO v_old FROM public.factories
  WHERE id = p_factory_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'factory_not_found', '找不到此工廠');
  END IF;

  v_title := format('%s工廠「%s」', CASE WHEN p_is_active THEN '啟用' ELSE '停用' END, v_old.name);
  v_fields := public.api_changed_fields('狀態',
    CASE WHEN v_old.is_active THEN '啟用' ELSE '停用' END,
    CASE WHEN p_is_active THEN '啟用' ELSE '停用' END);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_factory_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.factories SET is_active = p_is_active WHERE id = p_factory_id AND is_active IS DISTINCT FROM p_is_active;

  RETURN public.api_result(false, p_factory_id, NULL, v_title, v_fields);
END;
$function$;

-- set_product_active（原定義：20261008185816_api_a6_products.sql）
CREATE OR REPLACE FUNCTION public.set_product_active(
  p_organization_id uuid,
  p_product_id uuid,
  p_is_active boolean,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.product_groups%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditProducts');
  IF p_is_active IS NULL THEN
    PERFORM public.api_fail('22023', 'is_active_required', '請指定要啟用或停用');
  END IF;

  SELECT * INTO v_old FROM public.product_groups WHERE id = p_product_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'product_not_found', '找不到此產品');
  END IF;

  v_title := format('%s產品「%s」', CASE WHEN p_is_active THEN '啟用' ELSE '停用' END, v_old.name);
  v_fields := public.api_changed_fields('狀態',
    CASE WHEN v_old.is_active THEN '啟用' ELSE '停用' END,
    CASE WHEN p_is_active THEN '啟用' ELSE '停用' END);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_product_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.product_groups SET is_active = p_is_active WHERE id = p_product_id AND is_active IS DISTINCT FROM p_is_active;

  RETURN public.api_result(false, p_product_id, NULL, v_title, v_fields);
END;
$function$;

-- set_product_color_active（原定義：20261008185816_api_a6_products.sql）
CREATE OR REPLACE FUNCTION public.set_product_color_active(
  p_organization_id uuid,
  p_color_id uuid,
  p_is_active boolean,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.products_new%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditProducts');
  IF p_is_active IS NULL THEN
    PERFORM public.api_fail('22023', 'is_active_required', '請指定要啟用或停用');
  END IF;

  SELECT * INTO v_old FROM public.products_new WHERE id = p_color_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'product_color_not_found', '找不到此顏色');
  END IF;

  v_title := format('%s顏色「%s」', CASE WHEN p_is_active THEN '啟用' ELSE '停用' END, public.api_product_label(p_color_id));
  v_fields := public.api_changed_fields('狀態',
    CASE WHEN v_old.status = 'Unavailable' THEN '停用' ELSE '啟用' END,
    CASE WHEN p_is_active THEN '啟用' ELSE '停用' END);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_color_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.products_new
  SET status = CASE WHEN p_is_active THEN 'Available' ELSE 'Unavailable' END::product_status
  WHERE id = p_color_id AND (status = 'Unavailable') IS DISTINCT FROM NOT p_is_active;

  RETURN public.api_result(false, p_color_id, NULL, v_title, v_fields);
END;
$function$;

-- set_shelf_active（原定義：20261009003415_api_a6_shelves.sql）
CREATE OR REPLACE FUNCTION public.set_shelf_active(
  p_organization_id uuid,
  p_shelf_id uuid,
  p_is_active boolean,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.warehouses%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditShelves');
  IF p_is_active IS NULL THEN
    PERFORM public.api_fail('22023', 'is_active_required', '請指定要啟用或停用');
  END IF;

  SELECT * INTO v_old FROM public.warehouses WHERE id = p_shelf_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'shelf_not_found', '找不到此貨架');
  END IF;

  v_title := format('%s貨架「%s」', CASE WHEN p_is_active THEN '啟用' ELSE '停用' END, v_old.name);
  v_fields := public.api_changed_fields('狀態',
      CASE WHEN v_old.is_active THEN '啟用' ELSE '停用' END,
      CASE WHEN p_is_active THEN '啟用' ELSE '停用' END)
    || CASE WHEN p_is_active THEN '[]'::jsonb ELSE public.api_fields('仍有庫存', public.api_shelf_stock_label(p_shelf_id)) END;
  IF p_dry_run THEN
    RETURN public.api_result(true, p_shelf_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.warehouses SET is_active = p_is_active WHERE id = p_shelf_id AND is_active IS DISTINCT FROM p_is_active;

  RETURN public.api_result(false, p_shelf_id, NULL, v_title, v_fields);
END;
$function$;

-- sync_product_color_with_group（原定義：20261008185816_api_a6_products.sql）
CREATE OR REPLACE FUNCTION public.sync_product_color_with_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_group public.product_groups%ROWTYPE;
BEGIN
  IF NEW.group_id IS NULL THEN
    SELECT * INTO v_group FROM public.product_groups
    WHERE organization_id = NEW.organization_id AND lower(name) = lower(btrim(NEW.name));
    IF NOT FOUND THEN
      INSERT INTO public.product_groups (organization_id, name, category, unit_of_measure, created_by)
      VALUES (NEW.organization_id, btrim(NEW.name), coalesce(NEW.category, '布料'), coalesce(NEW.unit_of_measure, 'KG'), NEW.user_id)
      RETURNING * INTO v_group;
    END IF;
    NEW.group_id := v_group.id;
  ELSE
    SELECT * INTO v_group FROM public.product_groups WHERE id = NEW.group_id;
    IF v_group.organization_id IS DISTINCT FROM NEW.organization_id THEN
      PERFORM public.api_fail('P0002', 'product_not_found', '找不到此產品');
    END IF;
  END IF;

  NEW.name := v_group.name;
  NEW.category := v_group.category;
  NEW.unit_of_measure := v_group.unit_of_measure;
  RETURN NEW;
END;
$function$;

-- update_customer（原定義：20261008170920_api_a1_customers_factories.sql）
CREATE OR REPLACE FUNCTION public.update_customer(
  p_organization_id uuid,
  p_customer_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.customers%ROWTYPE;
  v_name text;
  v_contact_person text;
  v_phone text;
  v_landline_phone text;
  v_fax text;
  v_email text;
  v_address text;
  v_note text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditCustomers');
  PERFORM public.api_check_change_keys(p_changes,
    ARRAY['name', 'contact_person', 'phone', 'landline_phone', 'fax', 'email', 'address', 'note']);

  SELECT * INTO v_old FROM public.customers
  WHERE id = p_customer_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'customer_not_found', '找不到此客戶');
  END IF;

  v_name := public.api_changed(p_changes, 'name', v_old.name);
  v_contact_person := public.api_changed(p_changes, 'contact_person', v_old.contact_person);
  v_phone := public.api_changed(p_changes, 'phone', v_old.phone);
  v_landline_phone := public.api_changed(p_changes, 'landline_phone', v_old.landline_phone);
  v_fax := public.api_changed(p_changes, 'fax', v_old.fax);
  v_email := public.api_changed(p_changes, 'email', v_old.email);
  v_address := public.api_changed(p_changes, 'address', v_old.address);
  v_note := public.api_changed(p_changes, 'note', v_old.note);

  PERFORM public.api_validate_contact('客戶', v_name, v_contact_person, v_phone, v_landline_phone, v_email);

  IF EXISTS (
    SELECT 1 FROM public.customers
    WHERE organization_id = p_organization_id AND id <> p_customer_id AND lower(btrim(name)) = lower(v_name)
  ) THEN
    PERFORM public.api_fail('23505', 'customer_name_taken', format('已有同名的客戶「%s」', v_name));
  END IF;

  v_fields := public.api_changed_fields(
    '名稱', v_old.name, v_name, '聯絡人', v_old.contact_person, v_contact_person,
    '手機', v_old.phone, v_phone, '市話', v_old.landline_phone, v_landline_phone,
    '傳真', v_old.fax, v_fax, '電子郵件', v_old.email, v_email,
    '地址', v_old.address, v_address, '備註', v_old.note, v_note
  );
  IF p_dry_run THEN
    RETURN public.api_result(true, p_customer_id, NULL, format('修改客戶「%s」', v_old.name), v_fields);
  END IF;

  UPDATE public.customers
  SET name = v_name, contact_person = v_contact_person, phone = v_phone, landline_phone = v_landline_phone,
      fax = v_fax, email = v_email, address = v_address, note = v_note
  WHERE id = p_customer_id;

  RETURN public.api_result(false, p_customer_id, NULL, format('修改客戶「%s」', v_old.name), v_fields);
END;
$function$;

-- update_factory（原定義：20261008170920_api_a1_customers_factories.sql）
CREATE OR REPLACE FUNCTION public.update_factory(
  p_organization_id uuid,
  p_factory_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.factories%ROWTYPE;
  v_name text;
  v_contact_person text;
  v_phone text;
  v_landline_phone text;
  v_fax text;
  v_email text;
  v_address text;
  v_note text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditFactories');
  PERFORM public.api_check_change_keys(p_changes,
    ARRAY['name', 'contact_person', 'phone', 'landline_phone', 'fax', 'email', 'address', 'note']);

  SELECT * INTO v_old FROM public.factories
  WHERE id = p_factory_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'factory_not_found', '找不到此工廠');
  END IF;

  v_name := public.api_changed(p_changes, 'name', v_old.name);
  v_contact_person := public.api_changed(p_changes, 'contact_person', v_old.contact_person);
  v_phone := public.api_changed(p_changes, 'phone', v_old.phone);
  v_landline_phone := public.api_changed(p_changes, 'landline_phone', v_old.landline_phone);
  v_fax := public.api_changed(p_changes, 'fax', v_old.fax);
  v_email := public.api_changed(p_changes, 'email', v_old.email);
  v_address := public.api_changed(p_changes, 'address', v_old.address);
  v_note := public.api_changed(p_changes, 'note', v_old.note);

  PERFORM public.api_validate_contact('工廠', v_name, v_contact_person, v_phone, v_landline_phone, v_email);

  IF EXISTS (
    SELECT 1 FROM public.factories
    WHERE organization_id = p_organization_id AND id <> p_factory_id AND lower(btrim(name)) = lower(v_name)
  ) THEN
    PERFORM public.api_fail('23505', 'factory_name_taken', format('已有同名的工廠「%s」', v_name));
  END IF;

  v_fields := public.api_changed_fields(
    '名稱', v_old.name, v_name, '聯絡人', v_old.contact_person, v_contact_person,
    '手機', v_old.phone, v_phone, '市話', v_old.landline_phone, v_landline_phone,
    '傳真', v_old.fax, v_fax, '電子郵件', v_old.email, v_email,
    '地址', v_old.address, v_address, '備註', v_old.note, v_note
  );
  IF p_dry_run THEN
    RETURN public.api_result(true, p_factory_id, NULL, format('修改工廠「%s」', v_old.name), v_fields);
  END IF;

  UPDATE public.factories
  SET name = v_name, contact_person = v_contact_person, phone = v_phone, landline_phone = v_landline_phone,
      fax = v_fax, email = v_email, address = v_address, note = v_note
  WHERE id = p_factory_id;

  RETURN public.api_result(false, p_factory_id, NULL, format('修改工廠「%s」', v_old.name), v_fields);
END;
$function$;

-- update_inventory（原定義：20261008233705_api_a4_receiving.sql）
CREATE OR REPLACE FUNCTION public.update_inventory(
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
    PERFORM public.api_fail('P0002', 'inventory_not_found', '找不到此入庫紀錄');
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

-- update_inventory_roll（原定義：20261008233705_api_a4_receiving.sql）
CREATE OR REPLACE FUNCTION public.update_inventory_roll(
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
    PERFORM public.api_fail('P0002', 'roll_not_found', '找不到此布卷');
  END IF;
  IF p_changes ? 'quality' AND coalesce(p_changes->>'quality', '') NOT IN ('A', 'B', 'C', 'D', 'defective') THEN
    PERFORM public.api_fail('22023', 'invalid_quality', '品質等級不正確');
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

-- update_order（原定義：20261008181853_api_a2_orders.sql）
CREATE OR REPLACE FUNCTION public.update_order(
  p_organization_id uuid,
  p_order_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.orders%ROWTYPE;
  v_new public.orders%ROWTYPE;
  v_old_lines jsonb;
  v_old_factories text;
  v_factory_ids uuid[];
  v_fields jsonb;
  v_title text;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditOrders');
  PERFORM public.api_check_change_keys(p_changes,
    ARRAY['items', 'factory_ids', 'note', 'status', 'payment_status', 'shipping_status']);

  SELECT * INTO v_old FROM public.orders WHERE id = p_order_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'order_not_found', '找不到此訂單');
  END IF;
  IF v_old.status = 'cancelled' THEN
    PERFORM public.api_fail('55000', 'order_cancelled', format('訂單 %s 已取消，不能修改', v_old.order_number));
  END IF;

  IF p_changes->>'status' = 'cancelled' THEN
    PERFORM public.api_fail('22023', 'use_cancel_order', '請使用取消訂單');
  END IF;
  IF p_changes ? 'status' AND p_changes->>'status' NOT IN ('pending', 'confirmed', 'factory_ordered', 'completed') THEN
    PERFORM public.api_fail('22023', 'invalid_status', '訂單狀態不正確');
  END IF;
  IF p_changes ? 'payment_status' AND p_changes->>'payment_status' NOT IN ('unpaid', 'partial_paid', 'paid') THEN
    PERFORM public.api_fail('22023', 'invalid_payment_status', '付款狀態不正確');
  END IF;
  IF p_changes ? 'shipping_status' AND p_changes->>'shipping_status' NOT IN ('not_started', 'partial_shipped', 'shipped') THEN
    PERFORM public.api_fail('22023', 'invalid_shipping_status', '出貨狀態不正確');
  END IF;

  IF p_changes ? 'items' THEN
    PERFORM public.api_check_order_products(p_organization_id, p_order_id, p_changes->'items');
  END IF;
  IF p_changes ? 'factory_ids' THEN
    IF jsonb_typeof(p_changes->'factory_ids') <> 'array' THEN
      PERFORM public.api_fail('22023', 'invalid_factory_ids', '工廠清單格式不正確');
    END IF;
    SELECT coalesce(array_agg(DISTINCT value::uuid), '{}') INTO v_factory_ids FROM jsonb_array_elements_text(p_changes->'factory_ids');
    PERFORM public.api_check_order_factories(p_organization_id, p_order_id, v_factory_ids);
  END IF;

  SELECT coalesce(jsonb_object_agg(op.id, jsonb_build_object('product_id', op.product_id, 'quantity', op.quantity, 'unit_price', op.unit_price)), '{}')
  INTO v_old_lines FROM public.order_products op WHERE op.order_id = p_order_id;
  v_old_factories := public.api_order_factory_names(p_order_id);
  v_title := format('修改訂單 %s', v_old.order_number);

  BEGIN
    IF p_changes ? 'items' THEN
      PERFORM public.save_order_items(p_order_id, public.api_order_items_payload(p_changes->'items', true));
    END IF;

    IF p_changes ? 'factory_ids' THEN
      DELETE FROM public.order_factories WHERE order_id = p_order_id AND factory_id <> ALL (v_factory_ids);
      INSERT INTO public.order_factories (order_id, factory_id)
      SELECT p_order_id, f FROM unnest(v_factory_ids) AS f
      WHERE NOT EXISTS (SELECT 1 FROM public.order_factories WHERE order_id = p_order_id AND factory_id = f);
    END IF;

    -- save_order_items recalculates the shipping status; an explicit shipping_status overrides it
    UPDATE public.orders
    SET status = CASE WHEN p_changes ? 'status' THEN (p_changes->>'status')::order_status ELSE status END,
        payment_status = CASE WHEN p_changes ? 'payment_status' THEN (p_changes->>'payment_status')::payment_status ELSE payment_status END,
        shipping_status = CASE WHEN p_changes ? 'shipping_status' THEN (p_changes->>'shipping_status')::shipping_status ELSE shipping_status END,
        note = public.api_changed(p_changes, 'note', note)
    WHERE id = p_order_id
    RETURNING * INTO v_new;

    v_fields := public.api_changed_fields(
        '訂單狀態', public.api_order_status_label(v_old.status::text), public.api_order_status_label(v_new.status::text),
        '付款狀態', public.api_order_status_label(v_old.payment_status::text), public.api_order_status_label(v_new.payment_status::text),
        '出貨狀態', public.api_order_status_label(v_old.shipping_status::text), public.api_order_status_label(v_new.shipping_status::text),
        '指定工廠', v_old_factories, public.api_order_factory_names(p_order_id),
        '備註', v_old.note, v_new.note)
      -- Line changes: removed, changed and added items
      || coalesce((
           SELECT jsonb_agg(jsonb_build_object('label', '移除品項', 'value',
                    public.api_order_line_label((old.value->>'product_id')::uuid, (old.value->>'quantity')::numeric, (old.value->>'unit_price')::numeric)))
           FROM jsonb_each(v_old_lines) AS old
           WHERE NOT EXISTS (SELECT 1 FROM public.order_products WHERE id = old.key::uuid)
         ), '[]'::jsonb)
      || coalesce((
           SELECT jsonb_agg(jsonb_build_object('label', '修改品項', 'value',
                    public.api_order_line_label((old.value->>'product_id')::uuid, (old.value->>'quantity')::numeric, (old.value->>'unit_price')::numeric)
                    || ' → ' || public.api_order_line_label(op.product_id, op.quantity, op.unit_price)) ORDER BY op.created_at)
           FROM jsonb_each(v_old_lines) AS old JOIN public.order_products op ON op.id = old.key::uuid
           WHERE op.product_id <> (old.value->>'product_id')::uuid
              OR op.quantity <> (old.value->>'quantity')::numeric
              OR op.unit_price <> (old.value->>'unit_price')::numeric
         ), '[]'::jsonb)
      || coalesce((
           SELECT jsonb_agg(jsonb_build_object('label', '新增品項', 'value', public.api_order_line_label(op.product_id, op.quantity, op.unit_price)) ORDER BY op.created_at)
           FROM public.order_products op
           WHERE op.order_id = p_order_id AND NOT v_old_lines ? op.id::text
         ), '[]'::jsonb);

    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, p_order_id, v_old.order_number, v_title, v_fields);
  END;

  RETURN public.api_result(false, p_order_id, v_old.order_number, v_title, v_fields);
END;
$function$;

-- update_product（原定義：20261008185816_api_a6_products.sql）
CREATE OR REPLACE FUNCTION public.update_product(
  p_organization_id uuid,
  p_product_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.product_groups%ROWTYPE;
  v_name text;
  v_category text;
  v_unit text;
  v_fields jsonb;
  v_title text;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditProducts');
  PERFORM public.api_check_change_keys(p_changes, ARRAY['name', 'category', 'unit_of_measure']);

  SELECT * INTO v_old FROM public.product_groups WHERE id = p_product_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'product_not_found', '找不到此產品');
  END IF;

  v_name := public.api_changed(p_changes, 'name', v_old.name);
  v_category := coalesce(public.api_changed(p_changes, 'category', v_old.category), '布料');
  v_unit := coalesce(public.api_changed(p_changes, 'unit_of_measure', v_old.unit_of_measure), 'KG');
  PERFORM public.api_check_product_name(p_organization_id, v_name, p_product_id);

  v_title := format('修改產品「%s」', v_old.name);
  v_fields := public.api_changed_fields('產品名稱', v_old.name, v_name, '類別', v_old.category, v_category, '單位', v_old.unit_of_measure, v_unit);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_product_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.product_groups SET name = v_name, category = v_category, unit_of_measure = v_unit WHERE id = p_product_id;

  RETURN public.api_result(false, p_product_id, NULL, v_title, v_fields);
END;
$function$;

-- update_product_color（原定義：20261008185816_api_a6_products.sql）
CREATE OR REPLACE FUNCTION public.update_product_color(
  p_organization_id uuid,
  p_color_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.products_new%ROWTYPE;
  v_color text;
  v_color_code text;
  v_color_hex text;
  v_threshold numeric;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditProducts');
  PERFORM public.api_check_change_keys(p_changes, ARRAY['color', 'color_code', 'color_hex', 'stock_threshold']);

  SELECT * INTO v_old FROM public.products_new WHERE id = p_color_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'product_color_not_found', '找不到此顏色');
  END IF;

  v_color := public.api_changed(p_changes, 'color', v_old.color);
  v_color_code := public.api_changed(p_changes, 'color_code', v_old.color_code);
  v_color_hex := public.api_changed(p_changes, 'color_hex', v_old.color_hex);
  v_threshold := CASE WHEN p_changes ? 'stock_threshold' THEN (public.api_clean(p_changes->>'stock_threshold'))::numeric ELSE v_old.stock_thresholds END;
  PERFORM public.api_check_product_color(v_old.group_id, v_color, v_color_code, v_color_hex, v_threshold, p_color_id);

  v_title := format('修改顏色「%s」', public.api_product_label(p_color_id));
  v_fields := public.api_changed_fields(
    '顏色', v_old.color, v_color, '色號', v_old.color_code, v_color_code, '色值', v_old.color_hex, v_color_hex,
    '安全庫存', public.api_number(v_old.stock_thresholds) || ' 公斤', public.api_number(v_threshold) || ' 公斤');
  IF p_dry_run THEN
    RETURN public.api_result(true, p_color_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.products_new
  SET color = v_color, color_code = v_color_code, color_hex = v_color_hex, stock_thresholds = v_threshold
  WHERE id = p_color_id;

  RETURN public.api_result(false, p_color_id, NULL, v_title, v_fields);
END;
$function$;

-- update_purchase_order（原定義：20261008193554_api_a3_purchase_orders.sql）
CREATE OR REPLACE FUNCTION public.update_purchase_order(
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
    PERFORM public.api_fail('P0002', 'purchase_order_not_found', '找不到此採購單');
  END IF;
  IF v_old.status = 'cancelled' THEN
    PERFORM public.api_fail('55000', 'purchase_order_cancelled', format('採購單 %s 已取消，不能修改', v_old.po_number));
  END IF;

  IF p_changes->>'status' = 'cancelled' THEN
    PERFORM public.api_fail('22023', 'use_cancel_purchase_order', '請使用取消採購單');
  END IF;
  IF p_changes ? 'status' AND coalesce(p_changes->>'status', '') NOT IN ('pending', 'confirmed', 'partial_received', 'completed') THEN
    PERFORM public.api_fail('22023', 'invalid_status', '採購單狀態不正確');
  END IF;

  IF p_changes ? 'items' THEN
    PERFORM public.api_check_purchase_products(p_organization_id, p_purchase_order_id, p_changes->'items');
  END IF;
  IF p_changes ? 'order_ids' THEN
    IF jsonb_typeof(p_changes->'order_ids') <> 'array' THEN
      PERFORM public.api_fail('22023', 'invalid_order_ids', '訂單清單格式不正確');
    END IF;
    SELECT coalesce(array_agg(DISTINCT value::uuid), '{}') INTO v_order_ids FROM jsonb_array_elements_text(p_changes->'order_ids');
    PERFORM public.api_check_purchase_orders(p_organization_id, p_purchase_order_id, v_order_ids);
  END IF;

  v_factory_id := coalesce((public.api_clean(p_changes->>'factory_id'))::uuid, v_old.factory_id);
  IF v_factory_id <> v_old.factory_id THEN
    PERFORM public.api_check_purchase_factory(p_organization_id, v_factory_id, v_old.factory_id);
    IF EXISTS (SELECT 1 FROM public.inventories WHERE purchase_order_id = p_purchase_order_id) THEN
      PERFORM public.api_fail('55000', 'purchase_order_received', format('採購單 %s 已有入庫紀錄，不能更換工廠', v_old.po_number));
    END IF;
  END IF;

  v_order_date := CASE WHEN p_changes ? 'order_date' THEN coalesce(public.api_date(p_changes->>'order_date'), v_old.order_date) ELSE v_old.order_date END;
  v_arrival := CASE WHEN p_changes ? 'expected_arrival_date' THEN public.api_date(p_changes->>'expected_arrival_date') ELSE v_old.expected_arrival_date END;
  IF v_arrival < v_order_date THEN
    PERFORM public.api_fail('22023', 'invalid_expected_arrival_date', '預計到貨日期不可早於下單日期');
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

-- update_shelf（原定義：20261009003415_api_a6_shelves.sql）
CREATE OR REPLACE FUNCTION public.update_shelf(
  p_organization_id uuid,
  p_shelf_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.warehouses%ROWTYPE;
  v_name text;
  v_location text;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditShelves');
  PERFORM public.api_check_change_keys(p_changes, ARRAY['name', 'location']);

  SELECT * INTO v_old FROM public.warehouses WHERE id = p_shelf_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public.api_fail('P0002', 'shelf_not_found', '找不到此貨架');
  END IF;

  v_name := public.api_changed(p_changes, 'name', v_old.name);
  v_location := public.api_changed(p_changes, 'location', v_old.location);
  PERFORM public.api_check_shelf_name(p_organization_id, v_name, p_shelf_id);

  v_title := format('修改貨架「%s」', v_old.name);
  v_fields := public.api_changed_fields('貨架名稱', v_old.name, v_name, '位置', v_old.location, v_location);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_shelf_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.warehouses SET name = v_name, location = v_location WHERE id = p_shelf_id;

  RETURN public.api_result(false, p_shelf_id, NULL, v_title, v_fields);
END;
$function$;

-- update_shipping（原定義：20261009000604_api_a5_shipping.sql）
CREATE OR REPLACE FUNCTION public.update_shipping(
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
    PERFORM public.api_fail('P0002', 'shipping_not_found', '找不到此出貨單');
  END IF;
  IF v_old.status = 'cancelled' THEN
    PERFORM public.api_fail('55000', 'shipping_cancelled', format('出貨單 %s 已取消，不能修改', v_old.shipping_number));
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
