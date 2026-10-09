-- SECURITY DEFINER 函式移出公開的 API schema（資安建議 0028、0029，2026-10-09 使用者確認）
--
-- PostgREST 只公開 public schema。以函式擁有者身分執行的函式改放在不公開的 private schema：
-- 1. 業務 API、組織與成員 RPC、權限函式：實作移到 private，public 留下同名、同參數的 SECURITY INVOKER 包裝函式，
--    前端與 AI 的呼叫方式不變（supabase.rpc('<名稱>')）。RLS policy 以 OID 參照函式，會跟著移到 private，直接呼叫實作。
--    之後修改這些函式時改 private 裡的實作（CREATE OR REPLACE FUNCTION private.<名稱>），public 的包裝函式不用動。
-- 2. api_assign_document_number 只給單據編號觸發器使用：移到 private，不留包裝函式，不能再從 /rpc 呼叫。
-- 3. touch_query_session_updated_at 是觸發器函式（AI Session 的物件）：依使用者要求撤銷用戶端的 EXECUTE，只改權限、不改定義。

CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ===== 1. 實作移到 private，public 留包裝函式

DO $$
DECLARE
  v_name text;
  v_fn record;
  v_call text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    -- 業務 API（docs/API.md §3）
    'create_customer', 'update_customer', 'set_customer_active',
    'create_factory', 'update_factory', 'set_factory_active',
    'create_order', 'update_order', 'cancel_order',
    'create_purchase_order', 'update_purchase_order', 'cancel_purchase_order',
    'receive_inventory', 'update_inventory', 'update_inventory_roll',
    'create_shipping', 'update_shipping', 'cancel_shipping',
    'create_product', 'update_product', 'set_product_active',
    'add_product_color', 'update_product_color', 'set_product_color_active',
    'create_shelf', 'update_shelf', 'set_shelf_active',
    -- 組織與成員 RPC（docs/API.md §4）
    'accept_organization_invitation', 'add_existing_user_to_organization', 'complete_user_invitation',
    'delete_organization', 'get_my_pending_invitations', 'get_organization_member_status',
    'set_member_active', 'set_member_role', 'transfer_organization_ownership',
    -- 權限函式（docs/PERMISSIONS.md）
    'user_has_organization_permission', 'user_belongs_to_organization', 'is_organization_owner', 'can_inspect_organization'
  ] LOOP
    SELECT p.oid, p.pronargs, p.proretset, p.provolatile,
           pg_get_function_arguments(p.oid) AS args,
           pg_get_function_identity_arguments(p.oid) AS identity_args,
           pg_get_function_result(p.oid) AS result
    INTO STRICT v_fn
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name AND p.prosecdef;

    EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA private', v_name, v_fn.identity_args);
    EXECUTE format('REVOKE ALL ON FUNCTION private.%I(%s) FROM PUBLIC, anon', v_name, v_fn.identity_args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION private.%I(%s) TO authenticated, service_role', v_name, v_fn.identity_args);

    SELECT coalesce(string_agg('$' || i, ', ' ORDER BY i), '') INTO v_call FROM generate_series(1, v_fn.pronargs) AS i;
    EXECUTE format(
      'CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql %s SECURITY INVOKER SET search_path = '''' AS %L',
      v_name, v_fn.args, v_fn.result,
      CASE v_fn.provolatile WHEN 's' THEN 'STABLE' WHEN 'i' THEN 'IMMUTABLE' ELSE 'VOLATILE' END,
      CASE WHEN v_fn.proretset THEN format('SELECT * FROM private.%I(%s)', v_name, v_call)
           ELSE format('SELECT private.%I(%s)', v_name, v_call) END);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', v_name, v_fn.identity_args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', v_name, v_fn.identity_args);
    EXECUTE format('COMMENT ON FUNCTION public.%I(%s) IS %L', v_name, v_fn.identity_args,
      format('呼叫 private.%s（實作在 private schema）', v_name));
  END LOOP;
END $$;

-- ===== 2. 單據編號只給觸發器使用

ALTER FUNCTION public.api_assign_document_number(uuid, text) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.api_assign_document_number(uuid, text) FROM PUBLIC, anon;
-- Direct inserts by signed-in users run the numbering triggers as `authenticated`
GRANT EXECUTE ON FUNCTION private.api_assign_document_number(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generate_new_order_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.order_number := private.api_assign_document_number(NEW.organization_id, 'order');
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
    NEW.po_number := private.api_assign_document_number(NEW.organization_id, 'purchase_order');
  ELSIF NEW.po_number IS NULL OR NEW.po_number = '' THEN
    NEW.po_number := public.api_next_document_number(NEW.organization_id, 'purchase_order');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.receipt_number := private.api_assign_document_number(NEW.organization_id, 'receiving');
  ELSIF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
    NEW.receipt_number := public.api_next_document_number(NEW.organization_id, 'receiving');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_shipping_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.shipping_number := private.api_assign_document_number(NEW.organization_id, 'shipping');
  ELSIF NEW.shipping_number IS NULL OR NEW.shipping_number = '' THEN
    NEW.shipping_number := public.api_next_document_number(NEW.organization_id, 'shipping');
  END IF;
  RETURN NEW;
END;
$function$;

-- ===== 3. AI Session 的觸發器函式

REVOKE EXECUTE ON FUNCTION public.touch_query_session_updated_at() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
