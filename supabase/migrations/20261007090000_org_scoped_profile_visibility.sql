-- 舊的「管理員可看所有 profiles」政策依賴 get_current_user_role() / is_admin()，
-- 已隨舊角色系統移除（is_admin 現在永遠回傳 false），導致使用者管理頁面
-- 只看得到自己的 profile，其他成員與邀請中的使用者都不會顯示。
--
-- 改為以組織為範圍：在某組織擁有 canViewUsers 權限的人，可以讀取該組織
-- 成員資格（包含啟用、停用、邀請中）所對應的 profile。
CREATE POLICY "Org members with canViewUsers can view member profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_organizations uo
      WHERE uo.user_id = profiles.id
        AND public.user_has_organization_permission(auth.uid(), uo.organization_id, 'canViewUsers')
    )
  );
