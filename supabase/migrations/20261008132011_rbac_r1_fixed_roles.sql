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
