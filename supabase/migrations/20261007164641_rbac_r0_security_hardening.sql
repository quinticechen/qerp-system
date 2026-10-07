-- RBAC R0 安全修補（docs/MULTI_TENANT_RBAC.md §2.1 的 S1–S7）
--
-- S1–S3：移除讓任何登入者自行加入組織、替自己指派角色、在任意組織建立角色的 policy。
--        正常流程（建立組織、邀請、接受邀請、轉移擁有權）都經由 SECURITY DEFINER 函式，不依賴這些 policy。
-- S7：   修改成員角色改由 set_member_role() 在交易內完成替換，取代前端「先刪除再新增」。
-- S4–S5：移除條件為 true 的 policy，子表改以父單的組織判斷（不加入權限鍵檢查，那是 R4 的範圍）。
-- S6：   移除以 legacy is_admin() 判斷的 policy（is_admin() 目前固定回傳 false，僅為清理）。

-- ===== S1–S3

DROP POLICY IF EXISTS "Users can insert own memberships" ON public.user_organizations;
DROP POLICY IF EXISTS "System can assign roles" ON public.user_organization_roles;
DROP POLICY IF EXISTS "System can create default roles" ON public.organization_roles;

-- ===== S7

-- Replace a member's roles in one transaction. Callers need canEditUsers in the organization;
-- nobody can change their own role or the owner's, and the owner role is only granted by transferring ownership.
CREATE OR REPLACE FUNCTION public.set_member_role(_organization_id uuid, _user_id uuid, _role_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '請先登入' USING ERRCODE = '42501';
  END IF;

  IF NOT public.user_has_organization_permission(auth.uid(), _organization_id, 'canEditUsers') THEN
    RAISE EXCEPTION '權限不足，無法修改成員角色' USING ERRCODE = '42501';
  END IF;

  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION '不能修改自己的角色' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = _organization_id AND owner_id = _user_id) THEN
    RAISE EXCEPTION '不能修改擁有者的角色' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_organizations WHERE organization_id = _organization_id AND user_id = _user_id
  ) THEN
    RAISE EXCEPTION '此使用者不是組織成員' USING ERRCODE = 'P0002';
  END IF;

  SELECT name INTO v_role_name
  FROM public.organization_roles
  WHERE id = _role_id AND organization_id = _organization_id AND is_active = true;

  IF v_role_name IS NULL THEN
    RAISE EXCEPTION '角色不存在' USING ERRCODE = 'P0002';
  END IF;

  IF v_role_name = 'owner' THEN
    RAISE EXCEPTION '擁有者角色只能經由轉移擁有權取得' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_organization_roles
  WHERE organization_id = _organization_id AND user_id = _user_id;

  INSERT INTO public.user_organization_roles (user_id, organization_id, role_id, granted_by, is_active)
  VALUES (_user_id, _organization_id, _role_id, auth.uid(), true);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_member_role(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, uuid, uuid) TO authenticated;

-- ===== S4：order_factories、purchase_order_relations

DROP POLICY IF EXISTS "Users can view order factories" ON public.order_factories;
DROP POLICY IF EXISTS "Users can create order factories" ON public.order_factories;
DROP POLICY IF EXISTS "Users can update order factories" ON public.order_factories;
DROP POLICY IF EXISTS "Users can delete order factories" ON public.order_factories;

CREATE POLICY "org_isolation_select" ON public.order_factories
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT o.id FROM public.orders o
      WHERE o.organization_id IN (
        SELECT uo.organization_id FROM public.user_organizations uo
        WHERE uo.user_id = auth.uid() AND uo.is_active = true
      )
    )
  );

-- Writes also require the factory to belong to the order's organization
CREATE POLICY "org_isolation_modify" ON public.order_factories
  FOR ALL TO authenticated
  USING (
    order_id IN (
      SELECT o.id FROM public.orders o
      WHERE o.organization_id IN (
        SELECT uo.organization_id FROM public.user_organizations uo
        WHERE uo.user_id = auth.uid() AND uo.is_active = true
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.orders o
      JOIN public.factories f ON f.id = order_factories.factory_id AND f.organization_id = o.organization_id
      WHERE o.id = order_factories.order_id
        AND o.organization_id IN (
          SELECT uo.organization_id FROM public.user_organizations uo
          WHERE uo.user_id = auth.uid() AND uo.is_active = true
        )
    )
  );

DROP POLICY IF EXISTS "Users can view purchase order relations" ON public.purchase_order_relations;
DROP POLICY IF EXISTS "Users can create purchase order relations" ON public.purchase_order_relations;
DROP POLICY IF EXISTS "Users can update purchase order relations" ON public.purchase_order_relations;
DROP POLICY IF EXISTS "Users can delete purchase order relations" ON public.purchase_order_relations;

CREATE POLICY "org_isolation_select" ON public.purchase_order_relations
  FOR SELECT TO authenticated
  USING (
    purchase_order_id IN (
      SELECT po.id FROM public.purchase_orders po
      WHERE po.organization_id IN (
        SELECT uo.organization_id FROM public.user_organizations uo
        WHERE uo.user_id = auth.uid() AND uo.is_active = true
      )
    )
  );

-- Writes also require the order to belong to the purchase order's organization
CREATE POLICY "org_isolation_modify" ON public.purchase_order_relations
  FOR ALL TO authenticated
  USING (
    purchase_order_id IN (
      SELECT po.id FROM public.purchase_orders po
      WHERE po.organization_id IN (
        SELECT uo.organization_id FROM public.user_organizations uo
        WHERE uo.user_id = auth.uid() AND uo.is_active = true
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.purchase_orders po
      JOIN public.orders o ON o.id = purchase_order_relations.order_id AND o.organization_id = po.organization_id
      WHERE po.id = purchase_order_relations.purchase_order_id
        AND po.organization_id IN (
          SELECT uo.organization_id FROM public.user_organizations uo
          WHERE uo.user_id = auth.uid() AND uo.is_active = true
        )
    )
  );

-- ===== S5：其餘子表已有 org_isolation_* policy，只移除與之 OR 的 true policy

DROP POLICY IF EXISTS "Authenticated users can view order products" ON public.order_products;
DROP POLICY IF EXISTS "Authenticated users can view purchase order items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Authenticated users can create shipping_items" ON public.shipping_items;
DROP POLICY IF EXISTS "Authenticated users can create shipment_history" ON public.shipment_history;

-- ===== S6

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admin can view operation logs" ON public.user_operation_logs;
