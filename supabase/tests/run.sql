-- 自動產生（build-run.sh），請勿手動修改。
-- 結果為 "ALL TESTS PASSED" 代表通過；"FAIL: ..." 或其他錯誤代表未通過。
-- 最後一定會丟出例外，整批 SQL 會回滾，不會留下任何變更。

-- ===== migration: 20261008132011_rbac_r1_fixed_roles.sql
-- RBAC R1 固定角色（docs/MULTI_TENANT_RBAC.md §4）
--
-- 1. 角色改為管理員、編輯者、訪客三種（擁有者仍由 organizations.owner_id 決定），存在 user_organizations.role，
--    每位成員在每個組織只有一個角色；角色可做的事由全域對照表 role_permissions 決定。
-- 2. user_has_organization_permission() 改讀新的角色，介面不變（RLS、RPC、AI 的 authGuard 不需修改）。
-- 3. 成員的角色與狀態只能經由 RPC 修改：set_member_role()、set_member_active()、邀請、接受邀請、轉移擁有權。
-- 4. organization_roles、user_organization_roles 不再被讀寫，保留供編輯紀錄顯示舊紀錄的角色名稱。
-- 5. 權限判斷函式不再開放給未登入者呼叫。

-- ===== 1. 角色與權限對照表

CREATE TABLE public.role_permissions (
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  permission_key text NOT NULL,
  PRIMARY KEY (role, permission_key)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- The catalog is the same for every organization and contains no organization data
CREATE POLICY "Signed-in users can read role permissions" ON public.role_permissions
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.role_permissions FROM anon, authenticated;
GRANT SELECT ON public.role_permissions TO authenticated;

-- tier: view = 每個角色都可以；write = 管理員與編輯者；member_view = 管理員與編輯者；admin = 只有管理員
WITH keys(permission_key, tier) AS (
  VALUES
    ('canViewProducts', 'view'), ('canCreateProducts', 'write'), ('canEditProducts', 'write'),
    ('canViewCustomers', 'view'), ('canCreateCustomers', 'write'), ('canEditCustomers', 'write'),
    ('canViewFactories', 'view'), ('canCreateFactories', 'write'), ('canEditFactories', 'write'),
    ('canViewShelves', 'view'), ('canCreateShelves', 'write'), ('canEditShelves', 'write'),
    ('canViewOrders', 'view'), ('canCreateOrders', 'write'), ('canEditOrders', 'write'),
    ('canViewPurchases', 'view'), ('canCreatePurchases', 'write'), ('canEditPurchases', 'write'),
    ('canViewInventory', 'view'), ('canCreateInventory', 'write'), ('canEditInventory', 'write'),
    ('canViewShipping', 'view'), ('canCreateShipping', 'write'), ('canEditShipping', 'write'),
    ('canViewUsers', 'member_view'), ('canCreateUsers', 'admin'), ('canEditUsers', 'admin'),
    ('canViewPermissions', 'member_view'),
    ('canViewSystemSettings', 'member_view'), ('canEditSystemSettings', 'admin')
)
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'admin', permission_key FROM keys
UNION ALL
SELECT 'editor', permission_key FROM keys WHERE tier IN ('view', 'write', 'member_view')
UNION ALL
SELECT 'viewer', permission_key FROM keys WHERE tier = 'view';

-- ===== 2. 成員角色

ALTER TABLE public.user_organizations
  ADD COLUMN role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer'));

-- Existing members: the owner and anyone who could manage users become admins, anyone who could create or edit
-- becomes an editor, everyone else a viewer. Pending invitations use the role they were invited with.
UPDATE public.user_organizations uo
SET role = mapped.role
FROM (
  SELECT
    m.id,
    CASE
      WHEN o.owner_id = m.user_id THEN 'admin'
      WHEN bool_or(r.name IN ('owner', 'admin') OR coalesce((r.permissions->>'canEditUsers')::boolean, false)) THEN 'admin'
      WHEN bool_or(EXISTS (
        SELECT 1 FROM jsonb_each_text(r.permissions) p
        WHERE p.value = 'true' AND (p.key LIKE 'canCreate%' OR p.key LIKE 'canEdit%')
      )) THEN 'editor'
      ELSE 'viewer'
    END AS role
  FROM public.user_organizations m
  JOIN public.organizations o ON o.id = m.organization_id
  LEFT JOIN public.organization_roles r ON r.id IN (
    SELECT uor.role_id FROM public.user_organization_roles uor
    WHERE uor.user_id = m.user_id AND uor.organization_id = m.organization_id AND uor.is_active = true
    UNION
    SELECT m.invited_role_id WHERE m.accepted_at IS NULL
  )
  GROUP BY m.id, m.user_id, o.owner_id
) mapped
WHERE mapped.id = uo.id;

-- Clients may still update a membership (e.g. invited_at when resending an invitation), but who the member is,
-- their role and their status only change through the RPCs below, which run as the function owner.
CREATE OR REPLACE FUNCTION public.protect_membership_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION '成員只能經由邀請加入組織' USING ERRCODE = '42501';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    RAISE EXCEPTION '成員的角色與狀態只能經由系統功能修改' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER protect_membership_columns
  BEFORE INSERT OR UPDATE ON public.user_organizations
  FOR EACH ROW EXECUTE FUNCTION public.protect_membership_columns();

-- ===== 3. 權限判斷（介面不變）

-- Active members get their role's permissions; the owner gets the admin set, whatever their role column says
CREATE OR REPLACE FUNCTION public.user_has_organization_permission(_user_id uuid, _organization_id uuid, _permission text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_inspect_organization(_user_id, _organization_id)
     AND EXISTS (
       SELECT 1
       FROM public.role_permissions rp
       WHERE rp.permission_key = _permission
         AND (
           rp.role = (
             SELECT uo.role FROM public.user_organizations uo
             WHERE uo.user_id = _user_id AND uo.organization_id = _organization_id AND uo.is_active = true
           )
           OR (rp.role = 'admin' AND public.is_organization_owner(_user_id, _organization_id))
         )
     );
$function$;

-- ===== 4. 成員管理 RPC

DROP FUNCTION IF EXISTS public.set_member_role(uuid, uuid, uuid);

-- Callers need canEditUsers; nobody can change their own role or the owner's
CREATE FUNCTION public.set_member_role(_organization_id uuid, _user_id uuid, _role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '請先登入' USING ERRCODE = '42501';
  END IF;

  IF NOT public.user_has_organization_permission(auth.uid(), _organization_id, 'canEditUsers') THEN
    RAISE EXCEPTION '權限不足，無法修改成員角色' USING ERRCODE = '42501';
  END IF;

  IF _role = 'owner' THEN
    RAISE EXCEPTION '擁有者只能經由轉移擁有權產生' USING ERRCODE = '42501';
  END IF;

  IF _role IS NULL OR _role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION '角色不存在' USING ERRCODE = '22023';
  END IF;

  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION '不能修改自己的角色' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = _organization_id AND owner_id = _user_id) THEN
    RAISE EXCEPTION '不能修改擁有者的角色' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_organizations
  SET role = _role
  WHERE organization_id = _organization_id AND user_id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '此使用者不是組織成員' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

-- Disable or re-enable a member who has accepted their invitation
CREATE FUNCTION public.set_member_active(_organization_id uuid, _user_id uuid, _is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_accepted_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '請先登入' USING ERRCODE = '42501';
  END IF;

  IF NOT public.user_has_organization_permission(auth.uid(), _organization_id, 'canEditUsers') THEN
    RAISE EXCEPTION '權限不足，無法變更成員狀態' USING ERRCODE = '42501';
  END IF;

  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION '不能停用或啟用自己' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = _organization_id AND owner_id = _user_id) THEN
    RAISE EXCEPTION '不能停用擁有者' USING ERRCODE = '42501';
  END IF;

  SELECT accepted_at INTO v_accepted_at
  FROM public.user_organizations
  WHERE organization_id = _organization_id AND user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '此使用者不是組織成員' USING ERRCODE = 'P0002';
  END IF;

  IF v_accepted_at IS NULL THEN
    RAISE EXCEPTION '此成員尚未接受邀請' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_organizations
  SET is_active = _is_active
  WHERE organization_id = _organization_id AND user_id = _user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_member_role(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_member_active(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_active(uuid, uuid, boolean) TO authenticated;

-- ===== 5. 邀請與接受邀請：邀請時即寫入角色，接受時只需啟用

DROP FUNCTION IF EXISTS public.add_existing_user_to_organization(text, uuid, uuid);

CREATE FUNCTION public.add_existing_user_to_organization(_email text, _organization_id uuid, _role text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  _user_id uuid;
  _membership public.user_organizations%ROWTYPE;
BEGIN
  IF NOT public.user_has_organization_permission(auth.uid(), _organization_id, 'canCreateUsers') THEN
    RAISE EXCEPTION '權限不足，無法將使用者加入此組織' USING ERRCODE = '42501';
  END IF;

  IF _role IS NULL OR _role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION '指定的角色無效' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO _user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(_email))
  LIMIT 1;

  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _membership
  FROM public.user_organizations
  WHERE user_id = _user_id AND organization_id = _organization_id;

  IF _membership.is_active THEN
    RAISE EXCEPTION '此使用者已是組織成員' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.user_organizations
    (user_id, organization_id, is_active, accepted_at, role, invited_by, invited_at)
  VALUES (_user_id, _organization_id, false, NULL, _role, auth.uid(), now())
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET is_active = false,
        accepted_at = NULL,
        role = EXCLUDED.role,
        invited_by = EXCLUDED.invited_by,
        invited_at = now();

  INSERT INTO public.user_operation_logs (operator_id, target_user_id, operation_type, operation_details)
  VALUES (
    auth.uid(), _user_id, 'invite',
    jsonb_build_object('organization_id', _organization_id, 'role', _role, 'existing_user', true)
  );

  RETURN _user_id;
END;
$function$;

DROP FUNCTION IF EXISTS public.complete_user_invitation(uuid, uuid, uuid, text, text);

CREATE FUNCTION public.complete_user_invitation(
  _user_id uuid, _organization_id uuid, _role text, _full_name text DEFAULT NULL, _phone text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_has_organization_permission(auth.uid(), _organization_id, 'canCreateUsers') THEN
    RAISE EXCEPTION '權限不足，無法將使用者加入此組織' USING ERRCODE = '42501';
  END IF;

  IF _role IS NULL OR _role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION '指定的角色無效' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET full_name = COALESCE(_full_name, full_name),
      phone = COALESCE(_phone, phone)
  WHERE id = _user_id;

  INSERT INTO public.user_organizations
    (user_id, organization_id, is_active, accepted_at, role, invited_by, invited_at)
  VALUES (_user_id, _organization_id, false, NULL, _role, auth.uid(), now());

  INSERT INTO public.user_operation_logs (operator_id, target_user_id, operation_type, operation_details)
  VALUES (
    auth.uid(), _user_id, 'invite',
    jsonb_build_object('organization_id', _organization_id, 'role', _role)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.add_existing_user_to_organization(text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_user_invitation(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_existing_user_to_organization(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_user_invitation(uuid, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _membership public.user_organizations%ROWTYPE;
BEGIN
  SELECT * INTO _membership
  FROM public.user_organizations
  WHERE user_id = auth.uid() AND organization_id = _organization_id AND accepted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此組織的邀請' USING ERRCODE = 'P0002';
  END IF;

  IF _membership.invited_at < now() - interval '7 days' THEN
    RAISE EXCEPTION '邀請已過期，請聯絡組織管理員重新發送邀請' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_organizations
  SET is_active = true, accepted_at = now(), joined_at = now()
  WHERE id = _membership.id;

  INSERT INTO public.user_operation_logs (operator_id, target_user_id, operation_type, operation_details)
  VALUES (
    auth.uid(), auth.uid(), 'accept_invitation',
    jsonb_build_object('organization_id', _organization_id, 'role', _membership.role)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_pending_invitations()
RETURNS TABLE(organization_id uuid, organization_name text, role_display_name text, invited_at timestamp with time zone, is_expired boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT uo.organization_id, o.name,
         CASE uo.role WHEN 'admin' THEN '管理員' WHEN 'editor' THEN '編輯者' ELSE '訪客' END,
         uo.invited_at,
         uo.invited_at < now() - interval '7 days'
  FROM public.user_organizations uo
  JOIN public.organizations o ON o.id = uo.organization_id AND o.is_active = true
  WHERE uo.user_id = auth.uid() AND uo.accepted_at IS NULL
  ORDER BY uo.invited_at DESC;
$function$;

-- ===== 6. 轉移擁有權與建立組織

-- The previous owner keeps working as _fallback_role_name (an admin by default)
CREATE OR REPLACE FUNCTION public.transfer_organization_ownership(
  _organization_id uuid, _new_owner_id uuid, _fallback_role_name text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _old_owner_id uuid;
BEGIN
  SELECT owner_id INTO _old_owner_id
  FROM public.organizations
  WHERE id = _organization_id
  FOR UPDATE;

  IF _old_owner_id IS NULL THEN
    RAISE EXCEPTION '組織不存在' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_organization_owner(auth.uid(), _organization_id) THEN
    RAISE EXCEPTION '只有組織擁有者可以轉移所有權' USING ERRCODE = '42501';
  END IF;

  IF _new_owner_id = _old_owner_id THEN
    RAISE EXCEPTION '新擁有者不可與目前擁有者相同' USING ERRCODE = '22023';
  END IF;

  IF NOT public.user_belongs_to_organization(_new_owner_id, _organization_id) THEN
    RAISE EXCEPTION '新擁有者必須是該組織的現有成員' USING ERRCODE = '22023';
  END IF;

  IF _fallback_role_name IS NULL OR _fallback_role_name NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION '指定的角色無效' USING ERRCODE = '22023';
  END IF;

  UPDATE public.organizations SET owner_id = _new_owner_id WHERE id = _organization_id;

  -- The new owner's role column stays admin so they keep admin rights if ownership moves on later
  UPDATE public.user_organizations SET role = 'admin'
  WHERE organization_id = _organization_id AND user_id = _new_owner_id;

  UPDATE public.user_organizations SET role = _fallback_role_name
  WHERE organization_id = _organization_id AND user_id = _old_owner_id;

  INSERT INTO public.user_operation_logs (operator_id, target_user_id, operation_type, operation_details)
  VALUES (
    auth.uid(), _new_owner_id, 'transfer_ownership',
    jsonb_build_object('organization_id', _organization_id, 'previous_owner_id', _old_owner_id, 'fallback_role', _fallback_role_name)
  );
END;
$function$;

-- New organizations no longer get per-organization role rows; the creator joins as an admin (and is the owner)
CREATE OR REPLACE FUNCTION public.handle_organization_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 擁有者是自己建立組織，不是被邀請，所以 accepted_at 在當下就直接設定
  INSERT INTO public.user_organizations (user_id, organization_id, is_active, accepted_at, role)
  VALUES (NEW.owner_id, NEW.id, true, now(), 'admin');
  RETURN NEW;
END;
$function$;

-- ===== 7. 權限判斷函式不開放給未登入者（security advisor：anon_security_definer_function_executable）

REVOKE EXECUTE ON FUNCTION public.can_inspect_organization(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_organization_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_belongs_to_organization(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_has_organization_permission(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_inspect_organization(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_organization_owner(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_belongs_to_organization(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_organization_permission(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;

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
  values ('TEST', (fx->>'customer_id')::uuid, (fx->>'user_id')::uuid, (fx->>'org_id')::uuid) returning id into v_order;
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


do $$ begin raise exception 'ALL TESTS PASSED'; end $$;
