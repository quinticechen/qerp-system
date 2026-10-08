-- 自動產生（build-run.sh），請勿手動修改。
-- 結果為 "ALL TESTS PASSED" 代表通過；"FAIL: ..." 或其他錯誤代表未通過。
-- 最後一定會丟出例外，整批 SQL 會回滾，不會留下任何變更。

-- ===== migration: 20261008181853_api_a2_orders.sql
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


do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
