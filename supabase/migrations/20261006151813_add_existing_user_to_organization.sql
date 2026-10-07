-- 新增使用者時，若信箱已在 auth.users 註冊，前端的 signUp 不會回傳錯誤，
-- 而是回傳一個不存在於 auth.users 的假 user id（Supabase 防帳號列舉機制），
-- 導致 complete_user_invitation 撞上 user_organizations_user_id_fkey。
-- 這個 RPC 讓有 canCreateUsers 權限的管理員直接把既有帳號加入組織：
--   * 找不到信箱 → 回傳 NULL，前端改走 signUp 邀請流程
--   * 已是啟用中的成員 → 拋出錯誤
--   * 曾被停用 → 重新啟用成員資格
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
  _membership_active boolean;
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

  SELECT is_active INTO _membership_active
  FROM public.user_organizations
  WHERE user_id = _user_id AND organization_id = _organization_id;

  IF _membership_active THEN
    RAISE EXCEPTION '此使用者已是組織成員' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.user_organizations (user_id, organization_id, is_active)
  VALUES (_user_id, _organization_id, true)
  ON CONFLICT (user_id, organization_id) DO UPDATE SET is_active = true;

  -- 重新啟用時，舊的角色不應沿用，只保留這次指定的角色
  UPDATE public.user_organization_roles
  SET is_active = false
  WHERE user_id = _user_id AND organization_id = _organization_id AND role_id <> _role_id;

  INSERT INTO public.user_organization_roles (user_id, organization_id, role_id, granted_by, is_active)
  VALUES (_user_id, _organization_id, _role_id, auth.uid(), true)
  ON CONFLICT (user_id, organization_id, role_id) DO UPDATE
    SET is_active = true, granted_by = auth.uid();

  INSERT INTO public.user_operation_logs (operator_id, target_user_id, operation_type, operation_details)
  VALUES (
    auth.uid(), _user_id, 'create',
    jsonb_build_object('organization_id', _organization_id, 'role_id', _role_id, 'existing_user', true)
  );

  RETURN _user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_existing_user_to_organization(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_existing_user_to_organization(text, uuid, uuid) TO authenticated;
