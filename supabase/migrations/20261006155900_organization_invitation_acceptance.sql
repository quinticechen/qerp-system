-- 組織邀請改為「需要被邀請者接受」才生效。
--
-- 之前「等待啟用」只靠 auth.users.email_confirmed_at 判斷，已註冊過的帳號
-- 被加入組織時會立刻變成啟用中的成員並取得角色權限。改為：
--   * 邀請中：user_organizations.is_active = false 且 accepted_at IS NULL，
--     要給的角色暫存在 invited_role_id，user_organization_roles 不會有啟用中的角色，
--     因此既有 RLS（看 is_active）與權限檢查（看啟用中角色）都不會讓邀請中的人存取資料，
--     角色的「使用者數量」也不會把邀請中的人算進去。
--   * 被邀請者呼叫 accept_organization_invitation 後才變成啟用成員並套用角色。
--   * 停用成員：is_active = false 且 accepted_at IS NOT NULL（與邀請中區分）。

-- 欄位新增與資料轉換只在第一次執行時進行。
-- 若重複執行，「既有成員視為已接受」的 backfill 會把已轉成邀請中的列
-- 又標回已接受，因此整段用欄位是否存在來判斷。
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_organizations' AND column_name = 'accepted_at'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.user_organizations
    ADD COLUMN accepted_at TIMESTAMPTZ,
    ADD COLUMN invited_role_id UUID REFERENCES public.organization_roles(id) ON DELETE SET NULL;

  -- 把「其實還沒接受」的成員轉回邀請中（先記下角色，accepted_at 維持 NULL）：
  --   1) 信箱尚未驗證的新帳號（舊流程的「等待啟用」）
  --   2) 透過 add_existing_user_to_organization 直接加入的既有帳號
  UPDATE public.user_organizations uo
  SET is_active = false,
      invited_role_id = (
        SELECT uor.role_id FROM public.user_organization_roles uor
        WHERE uor.user_id = uo.user_id AND uor.organization_id = uo.organization_id
        ORDER BY uor.is_active DESC, uor.granted_at DESC
        LIMIT 1
      )
  FROM public.organizations o
  WHERE o.id = uo.organization_id
    AND o.owner_id <> uo.user_id
    AND (
      EXISTS (SELECT 1 FROM auth.users au WHERE au.id = uo.user_id AND au.email_confirmed_at IS NULL)
      OR EXISTS (
        SELECT 1 FROM public.user_operation_logs l
        WHERE l.target_user_id = uo.user_id
          AND l.operation_details->>'organization_id' = uo.organization_id::text
          AND (l.operation_details->>'existing_user')::boolean = true
      )
    );

  -- 其餘既有成員資格視為已接受
  UPDATE public.user_organizations
  SET accepted_at = joined_at
  WHERE invited_role_id IS NULL;

  UPDATE public.user_organization_roles uor
  SET is_active = false
  FROM public.user_organizations uo
  WHERE uo.user_id = uor.user_id
    AND uo.organization_id = uor.organization_id
    AND uo.accepted_at IS NULL
    AND uor.is_active = true;
END
$migration$;

-- 新帳號邀請：建立邀請中的成員資格，角色等接受後才套用
CREATE OR REPLACE FUNCTION public.complete_user_invitation(
  _user_id uuid,
  _organization_id uuid,
  _role_id uuid,
  _full_name text DEFAULT NULL,
  _phone text DEFAULT NULL
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

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_roles
    WHERE id = _role_id AND organization_id = _organization_id AND is_active = true AND name <> 'owner'
  ) THEN
    RAISE EXCEPTION '指定的角色無效' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET full_name = COALESCE(_full_name, full_name),
      phone = COALESCE(_phone, phone)
  WHERE id = _user_id;

  INSERT INTO public.user_organizations
    (user_id, organization_id, is_active, accepted_at, invited_role_id, invited_by, invited_at)
  VALUES (_user_id, _organization_id, false, NULL, _role_id, auth.uid(), now());

  INSERT INTO public.user_operation_logs (operator_id, target_user_id, operation_type, operation_details)
  VALUES (
    auth.uid(), _user_id, 'invite',
    jsonb_build_object('organization_id', _organization_id, 'role_id', _role_id)
  );
END;
$function$;

-- 既有帳號邀請：同樣建立邀請中的成員資格；若已在邀請中則重新起算效期並更新角色
CREATE OR REPLACE FUNCTION public.add_existing_user_to_organization(
  _email text,
  _organization_id uuid,
  _role_id uuid
)
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

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_roles
    WHERE id = _role_id AND organization_id = _organization_id AND is_active = true AND name <> 'owner'
  ) THEN
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
    (user_id, organization_id, is_active, accepted_at, invited_role_id, invited_by, invited_at)
  VALUES (_user_id, _organization_id, false, NULL, _role_id, auth.uid(), now())
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET is_active = false,
        accepted_at = NULL,
        invited_role_id = EXCLUDED.invited_role_id,
        invited_by = EXCLUDED.invited_by,
        invited_at = now();

  INSERT INTO public.user_operation_logs (operator_id, target_user_id, operation_type, operation_details)
  VALUES (
    auth.uid(), _user_id, 'invite',
    jsonb_build_object('organization_id', _organization_id, 'role_id', _role_id, 'existing_user', true)
  );

  RETURN _user_id;
END;
$function$;

-- 被邀請者接受邀請（7 天效期）
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

  IF _membership.invited_role_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organization_roles
    WHERE id = _membership.invited_role_id AND organization_id = _organization_id AND is_active = true
  ) THEN
    RAISE EXCEPTION '邀請的角色已失效，請聯絡組織管理員重新發送邀請' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_organizations
  SET is_active = true, accepted_at = now(), joined_at = now()
  WHERE id = _membership.id;

  UPDATE public.user_organization_roles
  SET is_active = false
  WHERE user_id = auth.uid() AND organization_id = _organization_id AND role_id <> _membership.invited_role_id;

  INSERT INTO public.user_organization_roles (user_id, organization_id, role_id, granted_by, is_active)
  VALUES (auth.uid(), _organization_id, _membership.invited_role_id, _membership.invited_by, true)
  ON CONFLICT (user_id, organization_id, role_id) DO UPDATE
    SET is_active = true, granted_by = EXCLUDED.granted_by, granted_at = now();

  INSERT INTO public.user_operation_logs (operator_id, target_user_id, operation_type, operation_details)
  VALUES (
    auth.uid(), auth.uid(), 'accept_invitation',
    jsonb_build_object('organization_id', _organization_id, 'role_id', _membership.invited_role_id)
  );
END;
$function$;

-- 目前登入者收到的邀請（organizations 的 RLS 只開放給啟用中成員，因此用 SECURITY DEFINER）
CREATE OR REPLACE FUNCTION public.get_my_pending_invitations()
RETURNS TABLE(
  organization_id uuid,
  organization_name text,
  role_display_name text,
  invited_at timestamptz,
  is_expired boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT uo.organization_id, o.name, r.display_name, uo.invited_at,
         uo.invited_at < now() - interval '7 days'
  FROM public.user_organizations uo
  JOIN public.organizations o ON o.id = uo.organization_id AND o.is_active = true
  LEFT JOIN public.organization_roles r ON r.id = uo.invited_role_id
  WHERE uo.user_id = auth.uid() AND uo.accepted_at IS NULL
  ORDER BY uo.invited_at DESC;
$function$;

-- 使用者管理用：成員狀態改以 accepted_at 判斷，回傳該組織所有成員資格
-- （啟用、停用、邀請中），讓停用的成員仍能在列表中被重新啟用
DROP FUNCTION IF EXISTS public.get_organization_member_status(uuid);
CREATE FUNCTION public.get_organization_member_status(_organization_id uuid)
RETURNS TABLE(user_id uuid, is_pending boolean, invited_at timestamptz, email_confirmed boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT au.id, (uo.accepted_at IS NULL), uo.invited_at, (au.email_confirmed_at IS NOT NULL)
  FROM auth.users au
  JOIN public.user_organizations uo ON uo.user_id = au.id
  WHERE uo.organization_id = _organization_id
    AND public.user_has_organization_permission(auth.uid(), _organization_id, 'canViewUsers');
$function$;

-- 角色權限必須搭配「啟用中的成員資格」才有效。
-- 停用／啟用改為只切換 user_organizations.is_active（以組織為單位），
-- 因此被停用或仍在邀請中的人，即使 user_organization_roles 還留著角色也不能使用權限。
CREATE OR REPLACE FUNCTION public.user_has_organization_permission(_user_id uuid, _organization_id uuid, _permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
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
  ) OR public.is_organization_owner(_user_id, _organization_id);
$function$;

REVOKE ALL ON FUNCTION public.accept_organization_invitation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_pending_invitations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_organization_member_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_pending_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_member_status(uuid) TO authenticated;
