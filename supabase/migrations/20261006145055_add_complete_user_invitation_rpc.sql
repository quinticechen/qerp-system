-- Flow 2 修復：CreateUserDialog 原本在 signUp() 之後，用三次獨立、
-- 沒有 transaction 保護的 client-side insert 把使用者加入組織/指派角色，
-- 而且失敗時只 console.error、不會讓管理員看到，導致可能留下「有 profile
-- 但沒有 user_organizations」或「有 membership 但沒有角色」的殘缺資料——
-- 這正是先前在 lo1/qq/GF 三個組織發現的幽靈資料成因之一。
-- 把後三步（補 profile 欄位、加入組織、指派角色、寫操作紀錄）收進一個
-- SECURITY DEFINER function，全部在同一個 transaction 內完成，任何一步
-- 失敗就整個 rollback，並把錯誤往外拋給呼叫端。
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
SET search_path = public
AS $$
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

  INSERT INTO public.user_organizations (user_id, organization_id, is_active)
  VALUES (_user_id, _organization_id, true);

  INSERT INTO public.user_organization_roles (user_id, organization_id, role_id, granted_by, is_active)
  VALUES (_user_id, _organization_id, _role_id, auth.uid(), true);

  INSERT INTO public.user_operation_logs (operator_id, target_user_id, operation_type, operation_details)
  VALUES (
    auth.uid(), _user_id, 'create',
    jsonb_build_object('organization_id', _organization_id, 'role_id', _role_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_user_invitation(uuid, uuid, uuid, text, text) TO authenticated;
