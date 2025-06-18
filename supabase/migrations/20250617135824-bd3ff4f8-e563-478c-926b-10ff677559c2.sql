
-- 修復 RLS 政策，避免重複創建錯誤
-- 檢查並修復組織表的插入政策
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations as owner" ON public.organizations;
DROP POLICY IF EXISTS "Allow authenticated users to create organizations" ON public.organizations;

-- 創建正確的組織插入政策
CREATE POLICY "Allow authenticated users to create organizations"
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

-- 修復 user_organizations 表的插入政策
DROP POLICY IF EXISTS "Allow organization creation to add owner membership" ON public.user_organizations;
CREATE POLICY "Allow organization creation to add owner membership"
  ON public.user_organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 修復 organization_roles 表的插入政策
DROP POLICY IF EXISTS "Allow system to create default roles" ON public.organization_roles;
CREATE POLICY "Allow system to create default roles"
  ON public.organization_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 修復 user_organization_roles 表的插入政策
DROP POLICY IF EXISTS "Allow system to assign owner role" ON public.user_organization_roles;
CREATE POLICY "Allow system to assign owner role"
  ON public.user_organization_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR granted_by = auth.uid());
