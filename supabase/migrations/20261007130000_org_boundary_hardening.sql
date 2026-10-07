-- 組織邊界強化：組織的資料與成員資訊不可跨越組織邊界
-- 見 docs/QUERY_AGENT_PHASE0.md §9 P0-3（F10、F12）
--
-- 1. 庫存 view 改為 security_invoker，套用查詢者自己的 RLS（先前以擁有者身分執行，
--    任何登入使用者都能讀到所有組織的庫存），並在最後加上 organization_id 供前端篩選
-- 2. 權限／成員判斷函式只回答「關於自己」或「關於自己所屬組織」的問題
--    （先前任何人都能查詢任何使用者在任何組織的權限、擁有者身分與成員資格）
-- 3. create_default_organization_roles 只供建立組織的 trigger 使用，不再對外開放
--    （先前任何人，包含未登入者，都能在任意組織插入角色）

-- ── 1. 庫存 view ──────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.inventory_summary
WITH (security_invoker = true) AS
SELECT p.id AS product_id,
    p.name AS product_name,
    p.color,
    COALESCE(sum(ir.current_quantity), 0::numeric) AS total_stock,
    count(ir.id) AS total_rolls,
    COALESCE(sum(CASE WHEN ir.quality = 'A'::fabric_quality THEN ir.current_quantity ELSE 0::numeric END), 0::numeric) AS a_grade_stock,
    COALESCE(sum(CASE WHEN ir.quality = 'B'::fabric_quality THEN ir.current_quantity ELSE 0::numeric END), 0::numeric) AS b_grade_stock,
    COALESCE(sum(CASE WHEN ir.quality = 'C'::fabric_quality THEN ir.current_quantity ELSE 0::numeric END), 0::numeric) AS c_grade_stock,
    COALESCE(sum(CASE WHEN ir.quality = 'D'::fabric_quality THEN ir.current_quantity ELSE 0::numeric END), 0::numeric) AS d_grade_stock,
    COALESCE(sum(CASE WHEN ir.quality = 'defective'::fabric_quality THEN ir.current_quantity ELSE 0::numeric END), 0::numeric) AS defective_stock,
    p.organization_id
FROM products_new p
  LEFT JOIN inventory_rolls ir ON p.id = ir.product_id AND ir.current_quantity > 0::numeric
GROUP BY p.id, p.name, p.color, p.organization_id
ORDER BY p.name, p.color;

CREATE OR REPLACE VIEW public.inventory_summary_enhanced
WITH (security_invoker = true) AS
WITH inventory_stats AS (
  SELECT ir.product_id,
      p.name AS product_name,
      p.color,
      p.color_code,
      p.stock_thresholds,
      p.status AS product_status,
      sum(ir.current_quantity) AS total_stock,
      count(ir.id) AS total_rolls,
      sum(CASE WHEN ir.quality = 'A'::fabric_quality THEN ir.current_quantity ELSE 0::numeric END) AS a_grade_stock,
      sum(CASE WHEN ir.quality = 'B'::fabric_quality THEN ir.current_quantity ELSE 0::numeric END) AS b_grade_stock,
      sum(CASE WHEN ir.quality = 'C'::fabric_quality THEN ir.current_quantity ELSE 0::numeric END) AS c_grade_stock,
      sum(CASE WHEN ir.quality = 'D'::fabric_quality THEN ir.current_quantity ELSE 0::numeric END) AS d_grade_stock,
      sum(CASE WHEN ir.quality = 'defective'::fabric_quality THEN ir.current_quantity ELSE 0::numeric END) AS defective_stock,
      count(CASE WHEN ir.quality = 'A'::fabric_quality THEN 1 ELSE NULL::integer END) AS a_grade_rolls,
      count(CASE WHEN ir.quality = 'B'::fabric_quality THEN 1 ELSE NULL::integer END) AS b_grade_rolls,
      count(CASE WHEN ir.quality = 'C'::fabric_quality THEN 1 ELSE NULL::integer END) AS c_grade_rolls,
      count(CASE WHEN ir.quality = 'D'::fabric_quality THEN 1 ELSE NULL::integer END) AS d_grade_rolls,
      count(CASE WHEN ir.quality = 'defective'::fabric_quality THEN 1 ELSE NULL::integer END) AS defective_rolls,
      array_agg(CASE WHEN ir.quality = 'A'::fabric_quality THEN ir.current_quantity::text ELSE NULL::text END ORDER BY ir.current_quantity) FILTER (WHERE ir.quality = 'A'::fabric_quality) AS a_grade_details,
      array_agg(CASE WHEN ir.quality = 'B'::fabric_quality THEN ir.current_quantity::text ELSE NULL::text END ORDER BY ir.current_quantity) FILTER (WHERE ir.quality = 'B'::fabric_quality) AS b_grade_details,
      array_agg(CASE WHEN ir.quality = 'C'::fabric_quality THEN ir.current_quantity::text ELSE NULL::text END ORDER BY ir.current_quantity) FILTER (WHERE ir.quality = 'C'::fabric_quality) AS c_grade_details,
      array_agg(CASE WHEN ir.quality = 'D'::fabric_quality THEN ir.current_quantity::text ELSE NULL::text END ORDER BY ir.current_quantity) FILTER (WHERE ir.quality = 'D'::fabric_quality) AS d_grade_details,
      array_agg(CASE WHEN ir.quality = 'defective'::fabric_quality THEN ir.current_quantity::text ELSE NULL::text END ORDER BY ir.current_quantity) FILTER (WHERE ir.quality = 'defective'::fabric_quality) AS defective_details
  FROM inventory_rolls ir
    JOIN products_new p ON ir.product_id = p.id
  WHERE ir.current_quantity > 0::numeric
  GROUP BY ir.product_id, p.name, p.color, p.color_code, p.stock_thresholds, p.status
), pending_inventory AS (
  SELECT poi.product_id,
      sum(poi.ordered_quantity - COALESCE(poi.received_quantity, 0::numeric)) AS pending_in_quantity
  FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.purchase_order_id = po.id
  WHERE po.status = ANY (ARRAY['pending'::purchase_order_status, 'partial_received'::purchase_order_status])
  GROUP BY poi.product_id
), pending_shipping AS (
  SELECT op.product_id,
      sum(op.quantity - COALESCE(op.shipped_quantity, 0::numeric)) AS pending_out_quantity
  FROM order_products op
    JOIN orders o ON op.order_id = o.id
  WHERE o.shipping_status = ANY (ARRAY['not_started'::shipping_status, 'partial_shipped'::shipping_status])
  GROUP BY op.product_id
)
SELECT COALESCE(inv.product_id, pi.product_id, ps.product_id) AS product_id,
    COALESCE(inv.product_name, p2.name) AS product_name,
    COALESCE(inv.color, p2.color) AS color,
    COALESCE(inv.color_code, p2.color_code) AS color_code,
    COALESCE(inv.stock_thresholds, p2.stock_thresholds) AS stock_thresholds,
    COALESCE(inv.product_status, p2.status) AS product_status,
    COALESCE(inv.total_stock, 0::numeric) AS total_stock,
    COALESCE(inv.total_rolls, 0::bigint) AS total_rolls,
    COALESCE(inv.a_grade_stock, 0::numeric) AS a_grade_stock,
    COALESCE(inv.b_grade_stock, 0::numeric) AS b_grade_stock,
    COALESCE(inv.c_grade_stock, 0::numeric) AS c_grade_stock,
    COALESCE(inv.d_grade_stock, 0::numeric) AS d_grade_stock,
    COALESCE(inv.defective_stock, 0::numeric) AS defective_stock,
    COALESCE(inv.a_grade_rolls, 0::bigint) AS a_grade_rolls,
    COALESCE(inv.b_grade_rolls, 0::bigint) AS b_grade_rolls,
    COALESCE(inv.c_grade_rolls, 0::bigint) AS c_grade_rolls,
    COALESCE(inv.d_grade_rolls, 0::bigint) AS d_grade_rolls,
    COALESCE(inv.defective_rolls, 0::bigint) AS defective_rolls,
    inv.a_grade_details,
    inv.b_grade_details,
    inv.c_grade_details,
    inv.d_grade_details,
    inv.defective_details,
    COALESCE(pi.pending_in_quantity, 0::numeric) AS pending_in_quantity,
    COALESCE(ps.pending_out_quantity, 0::numeric) AS pending_out_quantity,
    p2.organization_id
FROM inventory_stats inv
  FULL JOIN pending_inventory pi ON inv.product_id = pi.product_id
  FULL JOIN pending_shipping ps ON COALESCE(inv.product_id, pi.product_id) = ps.product_id
  LEFT JOIN products_new p2 ON COALESCE(inv.product_id, pi.product_id, ps.product_id) = p2.id;

-- ── 2. 權限／成員判斷函式的邊界 ───────────────────────────────────────────────

-- 呼叫者可以詢問：自己的資訊，或自己所屬（或擁有）組織內的資訊。
-- 所有 RLS policy 傳入的都是 auth.uid()；唯一查詢他人的是 transfer_organization_ownership
-- （檢查新擁有者是否為成員），此時呼叫者已驗證為該組織擁有者。
-- 不經 PostgREST 的連線（migration、後台 SQL、Realtime 等，session_user 不是 authenticator）
-- 與 service_role 維持原本行為。
CREATE OR REPLACE FUNCTION public.can_inspect_organization(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
       _user_id = auth.uid()
    OR auth.role() = 'service_role'
    OR session_user <> 'authenticator'
    OR EXISTS (
         SELECT 1 FROM public.user_organizations m
         WHERE m.user_id = auth.uid() AND m.organization_id = _organization_id AND m.is_active = true
       )
    OR EXISTS (
         SELECT 1 FROM public.organizations o
         WHERE o.id = _organization_id AND o.owner_id = auth.uid() AND o.is_active = true
       ),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.is_organization_owner(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_inspect_organization(_user_id, _organization_id)
     AND EXISTS (
       SELECT 1
       FROM public.organizations o
       WHERE o.id = _organization_id
         AND o.owner_id = _user_id
         AND o.is_active = true
     );
$function$;

CREATE OR REPLACE FUNCTION public.user_belongs_to_organization(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_inspect_organization(_user_id, _organization_id)
     AND EXISTS (
       SELECT 1
       FROM public.user_organizations uo
       WHERE uo.user_id = _user_id
         AND uo.organization_id = _organization_id
         AND uo.is_active = true
     );
$function$;

CREATE OR REPLACE FUNCTION public.user_has_organization_permission(_user_id uuid, _organization_id uuid, _permission text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_inspect_organization(_user_id, _organization_id)
     AND (
       EXISTS (
         SELECT 1
         FROM public.user_organization_roles uor
         JOIN public.organization_roles r ON uor.role_id = r.id
         JOIN public.user_organizations uo
           ON uo.user_id = uor.user_id AND uo.organization_id = uor.organization_id AND uo.is_active = true
         WHERE uor.user_id = _user_id
           AND uor.organization_id = _organization_id
           AND uor.is_active = true
           AND r.is_active = true
           AND (r.permissions->>_permission)::boolean = true
       )
       OR public.is_organization_owner(_user_id, _organization_id)
     );
$function$;

-- 只列出呼叫者也看得到的組織（自己的，或與呼叫者共同所屬的組織）
CREATE OR REPLACE FUNCTION public.get_user_organizations(_user_id uuid)
RETURNS TABLE(organization_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT uo.organization_id
  FROM public.user_organizations uo
  WHERE uo.user_id = _user_id
    AND uo.is_active = true
    AND public.can_inspect_organization(_user_id, uo.organization_id);
$function$;

-- ── 3. 不該從 API 直接呼叫的函式 ──────────────────────────────────────────────

-- 只由 handle_organization_creation trigger（SECURITY DEFINER，postgres 身分）呼叫
REVOKE EXECUTE ON FUNCTION public.create_default_organization_roles(uuid) FROM PUBLIC, anon, authenticated;

-- 這些函式內部都需要登入身分（auth.uid()），未登入者沒有呼叫的理由；
-- 且不被任何 RLS policy 使用，撤銷不影響未登入請求的 policy 評估
REVOKE EXECUTE ON FUNCTION public.complete_user_invitation(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_organization_ownership(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_organizations(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_user_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_user_invitation(uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_organization_ownership(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_organizations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_inspect_organization(uuid, uuid) TO authenticated, anon;
