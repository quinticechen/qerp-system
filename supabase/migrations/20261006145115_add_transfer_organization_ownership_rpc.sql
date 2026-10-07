-- Flow 3 修復：TransferOwnershipDialog 原本用四次獨立 client-side 呼叫
-- （更新 organizations.owner_id → 查 owner 角色 id → 停用舊擁有者的 owner
-- 角色 → upsert 新擁有者的 owner 角色），任何一步失敗都只 console.error，
-- 可能讓 organizations.owner_id（is_organization_owner() 的判斷依據）跟
-- user_organization_roles（畫面顯示/角色統計用）兩個真相來源對不起來。
-- 且舊擁有者的 owner 角色被拿掉後完全沒有補上任何新角色，等於轉移當下
-- 立刻失去所有權限。
-- 這裡收進一個 transaction 式 RPC，並讓舊擁有者自動取得一個預設角色
-- （預設 admin）而不是變成無角色。
CREATE OR REPLACE FUNCTION public.transfer_organization_ownership(
  _organization_id uuid,
  _new_owner_id uuid,
  _fallback_role_name text DEFAULT 'admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_owner_id uuid;
  _owner_role_id uuid;
  _fallback_role_id uuid;
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

  SELECT id INTO _owner_role_id
  FROM public.organization_roles
  WHERE organization_id = _organization_id AND name = 'owner' AND is_active = true;

  IF _owner_role_id IS NULL THEN
    RAISE EXCEPTION '找不到組織擁有者角色' USING ERRCODE = '22023';
  END IF;

  -- 1. 更新 organizations.owner_id（is_organization_owner() 判斷的依據）
  UPDATE public.organizations SET owner_id = _new_owner_id WHERE id = _organization_id;

  -- 2. 新擁有者取得 owner 角色
  INSERT INTO public.user_organization_roles (user_id, organization_id, role_id, granted_by, is_active)
  VALUES (_new_owner_id, _organization_id, _owner_role_id, auth.uid(), true)
  ON CONFLICT (user_id, organization_id, role_id)
  DO UPDATE SET is_active = true, granted_by = excluded.granted_by, granted_at = now();

  -- 3. 舊擁有者移除 owner 角色
  UPDATE public.user_organization_roles
  SET is_active = false
  WHERE organization_id = _organization_id AND role_id = _owner_role_id AND user_id = _old_owner_id;

  -- 4. 舊擁有者改配一個預設角色（例如 admin），避免轉移後完全無角色、瞬間失去所有權限
  SELECT id INTO _fallback_role_id
  FROM public.organization_roles
  WHERE organization_id = _organization_id AND name = _fallback_role_name AND is_active = true;

  IF _fallback_role_id IS NOT NULL THEN
    INSERT INTO public.user_organization_roles (user_id, organization_id, role_id, granted_by, is_active)
    VALUES (_old_owner_id, _organization_id, _fallback_role_id, auth.uid(), true)
    ON CONFLICT (user_id, organization_id, role_id)
    DO UPDATE SET is_active = true, granted_by = excluded.granted_by, granted_at = now();
  END IF;

  -- 5. 記錄操作日誌
  INSERT INTO public.user_operation_logs (operator_id, target_user_id, operation_type, operation_details)
  VALUES (
    auth.uid(), _new_owner_id, 'transfer_ownership',
    jsonb_build_object('organization_id', _organization_id, 'previous_owner_id', _old_owner_id, 'fallback_role', _fallback_role_name)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_organization_ownership(uuid, uuid, text) TO authenticated;
