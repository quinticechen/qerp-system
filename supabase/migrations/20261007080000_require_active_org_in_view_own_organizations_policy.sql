-- "Users can view own organizations" 是實際在生效、org 可見性的真正判斷依據
-- （不是 get_user_organizations()，那個已經不是這張表 SELECT policy 實際用到的
-- 函數了）。這個 policy 的 owner_id = auth.uid() 分支完全沒檢查
-- organizations.is_active，導致軟刪除（delete_organization() 設 is_active=false）
-- 之後，擁有者自己因為 owner_id 仍然相符，還是看得到、甚至還能把它選成目前組織。
-- 用 ALTER POLICY 直接改 USING 條件，不需要先 DROP。
ALTER POLICY "Users can view own organizations"
  ON public.organizations
  USING (
    is_active = true
    AND (
      owner_id = auth.uid()
      OR id IN (
        SELECT user_organizations.organization_id
        FROM public.user_organizations
        WHERE user_organizations.user_id = auth.uid()
          AND user_organizations.is_active = true
      )
    )
  );
