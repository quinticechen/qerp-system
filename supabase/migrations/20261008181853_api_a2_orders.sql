-- 業務 API A2 訂單（docs/BUSINESS_API.md §3、§5）
--
-- 1. A1 的內部輔助函式固定 search_path（security advisor：function_search_path_mutable）
-- 2. 單據編號統一為「類別字母＋YYYYMMDD＋四位流水號」，組織內唯一、依台灣日期每日重新起算（B8）：
--    訂單 B202610080001、採購單 P202610080001、進貨單 I202610080001、出貨單 O202610080001。
--    由 api_next_document_number() 計算，不再使用 sequence（Phase 0 F14；試算回滾時也不會跳號，B2）。
--    既有單據保留原編號；進貨單新增 receipt_number，既有進貨單依建立日期補號。
-- 3. save_order_items 的錯誤改為 SQLSTATE＋HINT 代碼（訊息不變）；同一次新增的品項依傳入順序排列
-- 4. create_order、update_order、cancel_order；單據的試算在子交易中真的寫入一次再回滾（§2.4）

-- ===== 1. 固定 search_path

ALTER FUNCTION public.api_clean(text) SET search_path TO 'public';
ALTER FUNCTION public.api_fields(text[]) SET search_path TO 'public';
ALTER FUNCTION public.api_changed_fields(text[]) SET search_path TO 'public';
ALTER FUNCTION public.api_result(boolean, uuid, text, text, jsonb) SET search_path TO 'public';
ALTER FUNCTION public.api_check_change_keys(jsonb, text[]) SET search_path TO 'public';
ALTER FUNCTION public.api_changed(jsonb, text, text) SET search_path TO 'public';
ALTER FUNCTION public.api_validate_contact(text, text, text, text, text, text) SET search_path TO 'public';
ALTER FUNCTION public.api_contact_fields(text, text, text, text, text, text, text, text) SET search_path TO 'public';

-- ===== 2. 單據編號

-- The next number of a document kind ('order', 'purchase_order', 'receiving', 'shipping') for an organization:
-- its letter, today's date in Taiwan and a four-digit sequence, e.g. B202610080001. A transaction-level advisory
-- lock serialises callers, so numbers never collide within the organization.
CREATE FUNCTION public.api_next_document_number(p_organization_id uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text;
  v_pattern text;
  v_last int;
BEGIN
  v_prefix := CASE p_kind
      WHEN 'order' THEN 'B' WHEN 'purchase_order' THEN 'P' WHEN 'receiving' THEN 'I' WHEN 'shipping' THEN 'O'
    END || to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD');
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'unknown document kind %', p_kind;
  END IF;
  v_pattern := '^' || v_prefix || '[0-9]{4,}$';

  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_kind || ':' || v_prefix, 0));

  IF p_kind = 'order' THEN
    SELECT max(substring(order_number FROM length(v_prefix) + 1)::int) INTO v_last
    FROM public.orders WHERE organization_id = p_organization_id AND order_number ~ v_pattern;
  ELSIF p_kind = 'purchase_order' THEN
    SELECT max(substring(po_number FROM length(v_prefix) + 1)::int) INTO v_last
    FROM public.purchase_orders WHERE organization_id = p_organization_id AND po_number ~ v_pattern;
  ELSIF p_kind = 'receiving' THEN
    SELECT max(substring(receipt_number FROM length(v_prefix) + 1)::int) INTO v_last
    FROM public.inventories WHERE organization_id = p_organization_id AND receipt_number ~ v_pattern;
  ELSE
    SELECT max(substring(shipping_number FROM length(v_prefix) + 1)::int) INTO v_last
    FROM public.shippings WHERE organization_id = p_organization_id AND shipping_number ~ v_pattern;
  END IF;

  RETURN v_prefix || lpad((coalesce(v_last, 0) + 1)::text, 4, '0');
END;
$function$;

REVOKE ALL ON FUNCTION public.api_next_document_number(uuid, text) FROM PUBLIC, anon, authenticated;

-- Numbers are unique within an organization, not across all of them
ALTER TABLE public.orders DROP CONSTRAINT orders_order_number_key;
ALTER TABLE public.orders ADD CONSTRAINT orders_organization_order_number_key UNIQUE (organization_id, order_number);
ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_po_number_key;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_organization_po_number_key UNIQUE (organization_id, po_number);
ALTER TABLE public.shippings DROP CONSTRAINT shippings_shipping_number_key;
ALTER TABLE public.shippings ADD CONSTRAINT shippings_organization_shipping_number_key UNIQUE (organization_id, shipping_number);

-- Receiving batches (進貨單) get a number too; existing ones are numbered by the day they were created
ALTER TABLE public.inventories ADD COLUMN receipt_number text;
UPDATE public.inventories i
SET receipt_number = numbered.receipt_number
FROM (
  SELECT id,
         'I' || to_char(created_at AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD')
           || lpad(row_number() OVER (PARTITION BY organization_id, (created_at AT TIME ZONE 'Asia/Taipei')::date ORDER BY created_at, id)::text, 4, '0')
           AS receipt_number
  FROM public.inventories
) numbered
WHERE numbered.id = i.id;
ALTER TABLE public.inventories ALTER COLUMN receipt_number SET NOT NULL;
ALTER TABLE public.inventories ADD CONSTRAINT inventories_organization_receipt_number_key UNIQUE (organization_id, receipt_number);

-- The number for a document a member writes directly. Runs as the function owner so it can see the whole
-- organization's numbers, but only answers for organizations the caller belongs to.
CREATE FUNCTION public.api_assign_document_number(p_organization_id uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.user_belongs_to_organization(auth.uid(), p_organization_id)
     AND NOT public.is_organization_owner(auth.uid(), p_organization_id) THEN
    RAISE EXCEPTION '您的角色沒有權限執行此操作' USING ERRCODE = '42501', HINT = 'forbidden';
  END IF;
  RETURN public.api_next_document_number(p_organization_id, p_kind);
END;
$function$;

REVOKE ALL ON FUNCTION public.api_assign_document_number(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_assign_document_number(uuid, text) TO authenticated;

-- The insert triggers number every document a client writes directly (pages and AI tools not yet using the APIs):
-- like before, a client cannot choose its own number (the AI create_order tool sends a placeholder such as
-- ORD-<timestamp>). The APIs run as the function owner, so the numbers they give are kept; other trusted writers
-- (migrations, maintenance) get a number only when they leave it empty.
CREATE OR REPLACE FUNCTION public.generate_new_order_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.order_number := public.api_assign_document_number(NEW.organization_id, 'order');
  ELSIF NEW.order_number IS NULL OR NEW.order_number IN ('', 'temp') THEN
    NEW.order_number := public.api_next_document_number(NEW.organization_id, 'order');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.po_number := public.api_assign_document_number(NEW.organization_id, 'purchase_order');
  ELSIF NEW.po_number IS NULL OR NEW.po_number = '' THEN
    NEW.po_number := public.api_next_document_number(NEW.organization_id, 'purchase_order');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.generate_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.receipt_number := public.api_assign_document_number(NEW.organization_id, 'receiving');
  ELSIF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
    NEW.receipt_number := public.api_next_document_number(NEW.organization_id, 'receiving');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER generate_receipt_number_trigger
  BEFORE INSERT ON public.inventories
  FOR EACH ROW EXECUTE FUNCTION public.generate_receipt_number();

CREATE OR REPLACE FUNCTION public.generate_shipping_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.shipping_number := public.api_assign_document_number(NEW.organization_id, 'shipping');
  ELSIF NEW.shipping_number IS NULL OR NEW.shipping_number = '' THEN
    NEW.shipping_number := public.api_next_document_number(NEW.organization_id, 'shipping');
  END IF;
  RETURN NEW;
END;
$function$;

-- ===== 3. save_order_items：錯誤代碼（訊息與規則不變）

CREATE OR REPLACE FUNCTION public.save_order_items(p_order_id uuid, p_items jsonb)
RETURNS void
LANGUAGE plpgsql
AS $function$
declare
  v_org uuid;
  v_item record;
  v_existing order_products;
  v_name text;
begin
  select organization_id into v_org from orders where id = p_order_id for update;
  if not found then
    raise exception '找不到訂單，或沒有編輯權限' using errcode = 'P0002', hint = 'order_not_found';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) = 0 then
    raise exception '訂單至少需要一項產品' using errcode = '22023', hint = 'items_required';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items)
      as x(id uuid, product_id uuid, quantity numeric, unit_price numeric, specifications jsonb, total_rolls int)
  loop
    if v_item.product_id is null
      or not exists (select 1 from products_new where id = v_item.product_id and organization_id = v_org) then
      raise exception '請選擇此組織的產品' using errcode = 'P0002', hint = 'product_not_found';
    end if;
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception '數量必須大於 0' using errcode = '22023', hint = 'invalid_quantity';
    end if;
    if coalesce(v_item.unit_price, 0) < 0 then
      raise exception '單價不可為負數' using errcode = '22023', hint = 'invalid_unit_price';
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
      raise exception '產品「%」已出貨，不可刪除', v_name using errcode = '55000', hint = 'item_shipped';
    end if;
    if order_product_is_purchased(p_order_id, v_existing.product_id) then
      raise exception '產品「%」已採購，不可刪除', v_name using errcode = '55000', hint = 'item_purchased';
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
      raise exception '訂單項目不屬於此訂單' using errcode = 'P0002', hint = 'item_not_found';
    end if;
    select name into v_name from products_new where id = v_existing.product_id;

    if v_item.product_id <> v_existing.product_id then
      if coalesce(v_existing.shipped_quantity, 0) > 0 then
        raise exception '產品「%」已出貨，不可更換產品', v_name using errcode = '55000', hint = 'item_shipped';
      end if;
      if order_product_is_purchased(p_order_id, v_existing.product_id) then
        raise exception '產品「%」已採購，不可更換產品', v_name using errcode = '55000', hint = 'item_purchased';
      end if;
    end if;
    if v_item.quantity < coalesce(v_existing.shipped_quantity, 0) then
      raise exception '產品「%」的數量不可低於已出貨 % 公斤', v_name, v_existing.shipped_quantity
        using errcode = '55000', hint = 'quantity_below_shipped';
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

-- ===== 4. 訂單 API

ALTER TABLE public.orders ADD COLUMN cancelled_at timestamptz;
ALTER TABLE public.orders ADD COLUMN cancel_reason text;

-- Display labels for order statuses (same wording as the AI confirmation cards)
CREATE FUNCTION public.api_order_status_label(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE p_status
    WHEN 'pending' THEN '待確認' WHEN 'confirmed' THEN '已確認' WHEN 'factory_ordered' THEN '已向工廠下單'
    WHEN 'completed' THEN '已完成' WHEN 'cancelled' THEN '已取消'
    WHEN 'unpaid' THEN '未付款' WHEN 'partial_paid' THEN '部分付款' WHEN 'paid' THEN '已付清'
    WHEN 'not_started' THEN '未出貨' WHEN 'partial_shipped' THEN '部分出貨' WHEN 'shipped' THEN '已出貨'
    ELSE p_status END;
$function$;

-- A number without trailing zeros, e.g. 10 rather than 10.00
CREATE FUNCTION public.api_number(p_value numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT trim_scale(p_value)::text;
$function$;

-- 「名稱 - 顏色（色號 X）」 for a product
CREATE FUNCTION public.api_product_label(p_product_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT p.name || coalesce(' - ' || public.api_clean(p.color), '') || coalesce('（色號 ' || public.api_clean(p.color_code) || '）', '')
  FROM public.products_new p WHERE p.id = p_product_id;
$function$;

-- 「產品 × 數量 公斤，單價 X」 for an order line
CREATE FUNCTION public.api_order_line_label(p_product_id uuid, p_quantity numeric, p_unit_price numeric)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT public.api_product_label(p_product_id) || ' × ' || public.api_number(p_quantity) || ' 公斤，單價 ' || public.api_number(p_unit_price);
$function$;

-- Names of the factories assigned to an order, in name order
CREATE FUNCTION public.api_order_factory_names(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT string_agg(f.name, '、' ORDER BY f.name)
  FROM public.order_factories ofa JOIN public.factories f ON f.id = ofa.factory_id
  WHERE ofa.order_id = p_order_id;
$function$;

-- Card fields describing a whole order: customer, each line, factories, note and total
CREATE FUNCTION public.api_order_fields(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT public.api_fields('客戶', c.name)
    || coalesce((
         SELECT jsonb_agg(jsonb_build_object('label', '品項 ' || rn, 'value', public.api_order_line_label(product_id, quantity, unit_price)) ORDER BY rn)
         FROM (SELECT op.*, row_number() OVER (ORDER BY op.created_at, op.id) AS rn FROM public.order_products op WHERE op.order_id = o.id) lines
       ), '[]'::jsonb)
    || public.api_fields(
         '指定工廠', public.api_order_factory_names(o.id),
         '備註', o.note,
         '訂單總額', (SELECT public.api_number(sum(quantity * unit_price)) FROM public.order_products WHERE order_id = o.id)
       )
  FROM public.orders o JOIN public.customers c ON c.id = o.customer_id
  WHERE o.id = p_order_id;
$function$;

-- Raise unless every product of the given lines belongs to the organization and is available.
-- Lines that keep an existing product (same id and product as before) may keep a product that was disabled since.
CREATE FUNCTION public.api_check_order_products(p_organization_id uuid, p_order_id uuid, p_items jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_line record;
  v_status product_status;
  v_name text;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '訂單至少需要一項產品' USING ERRCODE = '22023', HINT = 'items_required';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id uuid, product_id uuid) LOOP
    SELECT status, name INTO v_status, v_name FROM public.products_new
    WHERE id = v_line.product_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '找不到此產品' USING ERRCODE = 'P0002', HINT = 'product_not_found';
    END IF;
    IF v_status = 'Unavailable' AND NOT EXISTS (
      SELECT 1 FROM public.order_products
      WHERE order_id = p_order_id AND id = v_line.id AND product_id = v_line.product_id
    ) THEN
      RAISE EXCEPTION '產品「%」已停用', public.api_product_label(v_line.product_id) USING ERRCODE = '22023', HINT = 'product_unavailable';
    END IF;
  END LOOP;
END;
$function$;

-- Raise unless every factory belongs to the organization; newly assigned ones must also be active
CREATE FUNCTION public.api_check_order_factories(p_organization_id uuid, p_order_id uuid, p_factory_ids uuid[])
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
      RAISE EXCEPTION '找不到此工廠' USING ERRCODE = 'P0002', HINT = 'factory_not_found';
    END IF;
    IF NOT v_factory.is_active AND NOT EXISTS (
      SELECT 1 FROM public.order_factories WHERE order_id = p_order_id AND factory_id = v_factory.id
    ) THEN
      RAISE EXCEPTION '工廠「%」已停用', v_factory.name USING ERRCODE = '22023', HINT = 'factory_inactive';
    END IF;
  END LOOP;
END;
$function$;

-- Lines of p_items as save_order_items expects them; ids are dropped when creating
CREATE FUNCTION public.api_order_items_payload(p_items jsonb, p_keep_ids boolean)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(
           CASE WHEN p_keep_ids THEN line ELSE line - 'id' END
         ), '[]'::jsonb)
  FROM jsonb_array_elements(coalesce(p_items, '[]')) AS line;
$function$;

-- p_items: [{ product_id, quantity, unit_price, total_rolls?, specifications? }]
CREATE FUNCTION public.create_order(
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
    RAISE EXCEPTION '找不到此客戶' USING ERRCODE = 'P0002', HINT = 'customer_not_found';
  END IF;
  IF NOT v_customer.is_active THEN
    RAISE EXCEPTION '客戶「%」已停用', v_customer.name USING ERRCODE = '22023', HINT = 'customer_inactive';
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

-- p_changes may hold: items (the complete list, as save_order_items expects), factory_ids (the complete list),
-- note, status (pending / confirmed / factory_ordered / completed), payment_status, shipping_status
CREATE FUNCTION public.update_order(
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
    RAISE EXCEPTION '找不到此訂單' USING ERRCODE = 'P0002', HINT = 'order_not_found';
  END IF;
  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION '訂單 % 已取消，不能修改', v_old.order_number USING ERRCODE = '55000', HINT = 'order_cancelled';
  END IF;

  IF p_changes->>'status' = 'cancelled' THEN
    RAISE EXCEPTION '請使用取消訂單' USING ERRCODE = '22023', HINT = 'use_cancel_order';
  END IF;
  IF p_changes ? 'status' AND p_changes->>'status' NOT IN ('pending', 'confirmed', 'factory_ordered', 'completed') THEN
    RAISE EXCEPTION '訂單狀態不正確' USING ERRCODE = '22023', HINT = 'invalid_status';
  END IF;
  IF p_changes ? 'payment_status' AND p_changes->>'payment_status' NOT IN ('unpaid', 'partial_paid', 'paid') THEN
    RAISE EXCEPTION '付款狀態不正確' USING ERRCODE = '22023', HINT = 'invalid_payment_status';
  END IF;
  IF p_changes ? 'shipping_status' AND p_changes->>'shipping_status' NOT IN ('not_started', 'partial_shipped', 'shipped') THEN
    RAISE EXCEPTION '出貨狀態不正確' USING ERRCODE = '22023', HINT = 'invalid_shipping_status';
  END IF;

  IF p_changes ? 'items' THEN
    PERFORM public.api_check_order_products(p_organization_id, p_order_id, p_changes->'items');
  END IF;
  IF p_changes ? 'factory_ids' THEN
    IF jsonb_typeof(p_changes->'factory_ids') <> 'array' THEN
      RAISE EXCEPTION '工廠清單格式不正確' USING ERRCODE = '22023', HINT = 'invalid_factory_ids';
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

-- Cancelling is refused once the order has shipments or purchase orders that are not cancelled
CREATE FUNCTION public.cancel_order(
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
  IF EXISTS (SELECT 1 FROM public.shippings WHERE order_id = p_order_id) THEN
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

REVOKE ALL ON FUNCTION public.api_order_status_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_number(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_product_label(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_order_line_label(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_order_factory_names(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_order_fields(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_check_order_products(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_check_order_factories(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_order_items_payload(jsonb, boolean) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_order(uuid, uuid, jsonb, uuid[], text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_order(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_order(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, jsonb, uuid[], text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order(uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, uuid, text, boolean) TO authenticated;
