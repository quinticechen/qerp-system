-- 清理棄用的資料表、欄位與函式（docs/DATABASE_TABLES.md §4，2026-10-09 使用者確認）
--
-- 1. 刪除 R1 之前的自訂角色表 organization_roles、user_organization_roles 與其編輯紀錄（不再顯示 R1 之前的角色紀錄），
--    以及只寫入這些表的 create_default_organization_roles()
-- 2. 刪除從未使用的 shipment_history（出貨紀錄在 shipping_items）
-- 3. 刪除棄用欄位：purchase_orders.order_id（改用 purchase_order_relations，現有資料皆為空值）、
--    user_organizations.invited_role_id（邀請直接寫 role）、organizations.settings（沒有功能讀寫）
--    仍檢查 purchase_orders.order_id 的函式改為只看 purchase_order_relations

-- ===== 1. 只看採購關聯的函式

CREATE OR REPLACE FUNCTION public.order_product_is_purchased(p_order_id uuid, p_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    JOIN public.purchase_order_relations r ON r.purchase_order_id = po.id AND r.order_id = p_order_id
    WHERE poi.product_id = p_product_id AND po.status <> 'cancelled'
  );
$function$;

-- Orders marked 已向工廠下單 that no longer have a live purchase order go back to 已確認
CREATE OR REPLACE FUNCTION public.api_release_orders(p_order_ids uuid[])
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
      JOIN public.purchase_order_relations r ON r.purchase_order_id = po.id AND r.order_id = o.id
      WHERE po.status <> 'cancelled'
    );
$function$;

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
    AND EXISTS (SELECT 1 FROM public.purchase_order_relations r WHERE r.purchase_order_id = po.id AND r.order_id = p_order_id)
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
  PERFORM public.api_release_orders(v_order_ids);

  RETURN public.api_result(false, p_purchase_order_id, v_old.po_number, v_title, v_fields);
END;
$function$;

-- ===== 2. 刪除欄位

ALTER TABLE public.purchase_orders DROP COLUMN order_id;
ALTER TABLE public.user_organizations DROP COLUMN invited_role_id;
ALTER TABLE public.organizations DROP COLUMN settings;

-- ===== 3. 刪除資料表與函式

DROP FUNCTION public.create_default_organization_roles(uuid);
DROP TABLE public.shipment_history;
DROP TABLE public.user_organization_roles;
DROP TABLE public.organization_roles;

-- The history of the dropped tables is no longer shown anywhere
DELETE FROM public.record_audit_logs WHERE table_name IN ('organization_roles', 'user_organization_roles', 'shipment_history');
