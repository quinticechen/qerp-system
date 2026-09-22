-- 讓前端可以顯示「邀請待接受」狀態。
-- auth.users 不會透過 PostgREST 直接曝露給前端，因此用一個
-- SECURITY DEFINER 函數，只回傳呼叫者在該組織有 canViewUsers 權限時
-- 才看得到的 user_id / is_pending（email 尚未驗證 = 邀請待接受）。

CREATE OR REPLACE FUNCTION public.get_organization_member_status(_organization_id UUID)
RETURNS TABLE(user_id UUID, is_pending BOOLEAN)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT au.id, (au.email_confirmed_at IS NULL) AS is_pending
  FROM auth.users au
  JOIN public.user_organizations uo ON uo.user_id = au.id
  WHERE uo.organization_id = _organization_id
    AND uo.is_active = true
    AND public.user_has_organization_permission(auth.uid(), _organization_id, 'canViewUsers');
$$;
