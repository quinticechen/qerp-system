-- 1) 使用者管理的「編輯使用者」會更新其他成員的 full_name / phone，
--    但 profiles 的 UPDATE 政策只剩「改自己」（舊的管理員政策已隨舊角色系統移除）。
--    改為以組織為範圍：在某組織擁有 canEditUsers 權限的人，可以更新該組織成員的 profile。
CREATE POLICY "Org members with canEditUsers can update member profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_organizations uo
      WHERE uo.user_id = profiles.id
        AND public.user_has_organization_permission(auth.uid(), uo.organization_id, 'canEditUsers')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_organizations uo
      WHERE uo.user_id = profiles.id
        AND public.user_has_organization_permission(auth.uid(), uo.organization_id, 'canEditUsers')
    )
  );

-- 2) warehouses 的 INSERT 政策 with_check = true，任何登入者都能把倉庫建到任意組織，
--    違反組織隔離（PERMISSIVE 政策以 OR 合併）。移除後，新增倉庫／貨架改由既有的
--    "Users can manage warehouses in their organizations"（檢查 organization_id）管控。
DROP POLICY IF EXISTS "Authenticated users can create warehouses" ON public.warehouses;
