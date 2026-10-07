-- 加入邀請時間欄位，用於計算「等待啟用」邀請是否已超過 7 天效期。
-- 新增使用者時由預設值帶入目前時間；管理員重新發送邀請時，
-- 前端會把這個欄位更新為當下時間以重新起算 7 天效期。
ALTER TABLE public.user_organizations
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 讓 get_organization_member_status 一併回傳 invited_at，
-- 前端才能判斷邀請是等待啟用還是已超過 7 天效期。
CREATE OR REPLACE FUNCTION public.get_organization_member_status(_organization_id UUID)
RETURNS TABLE(user_id UUID, is_pending BOOLEAN, invited_at TIMESTAMPTZ)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT au.id, (au.email_confirmed_at IS NULL) AS is_pending, uo.invited_at
  FROM auth.users au
  JOIN public.user_organizations uo ON uo.user_id = au.id
  WHERE uo.organization_id = _organization_id
    AND uo.is_active = true
    AND public.user_has_organization_permission(auth.uid(), _organization_id, 'canViewUsers');
$$;

-- user_organizations 目前只有 INSERT 政策（組織擁有者或擁有 canCreateUsers 的成員），
-- 沒有開放一般管理員 UPDATE。補上讓擁有 canCreateUsers 權限者可以在「重新發送邀請」時
-- 更新 invited_at 以重新起算 7 天效期。
CREATE POLICY "Org members with canCreateUsers can resend invitations"
  ON public.user_organizations
  FOR UPDATE
  TO authenticated
  USING (
    public.user_has_organization_permission(auth.uid(), organization_id, 'canCreateUsers')
  )
  WITH CHECK (
    public.user_has_organization_permission(auth.uid(), organization_id, 'canCreateUsers')
  );
