-- 「刪除組織」實際上是軟刪除：只把 organizations.is_active 設為 false，
-- 不刪除任何底下的業務資料（客戶、訂單、庫存等），以保留稽核紀錄。
-- 只有組織擁有者可以執行，且必須正確輸入組織名稱才會生效
-- （前端已經擋一次，這裡再驗證一次，避免繞過 UI 直接呼叫 RPC）。
CREATE OR REPLACE FUNCTION public.delete_organization(
  _organization_id uuid,
  _confirm_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actual_name text;
BEGIN
  IF NOT public.is_organization_owner(auth.uid(), _organization_id) THEN
    RAISE EXCEPTION '只有組織擁有者可以刪除組織' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO _actual_name FROM public.organizations WHERE id = _organization_id AND is_active = true;
  IF _actual_name IS NULL THEN
    RAISE EXCEPTION '組織不存在' USING ERRCODE = '22023';
  END IF;

  IF _confirm_name IS DISTINCT FROM _actual_name THEN
    RAISE EXCEPTION '組織名稱確認不符，已取消刪除' USING ERRCODE = '22023';
  END IF;

  UPDATE public.organizations SET is_active = false WHERE id = _organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_organization(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_organization(uuid, text) TO authenticated;

-- get_user_organizations() 原本只檢查 user_organizations.is_active（成員資格是否啟用），
-- 沒有檢查 organizations.is_active 本身——導致軟刪除的組織即使擁有者執行了
-- delete_organization()，所有成員（包含擁有者自己）在 UI 上依然看得到、找得到它。
-- 這個函數同時也是 organizations 表 SELECT RLS policy 的判斷依據，修正這裡
-- 就能讓軟刪除的組織在整個系統中都無法再被一般查詢找到。
CREATE OR REPLACE FUNCTION public.get_user_organizations(_user_id uuid)
RETURNS TABLE(organization_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT uo.organization_id
  FROM public.user_organizations uo
  JOIN public.organizations o ON o.id = uo.organization_id
  WHERE uo.user_id = _user_id
    AND uo.is_active = true
    AND o.is_active = true;
$$;
