
-- 檢查當前的 RLS 政策狀態
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'organizations';

-- 先完全移除所有現有的組織表政策
DROP POLICY IF EXISTS "Users can view organizations they belong to" ON public.organizations;
DROP POLICY IF EXISTS "Organization owners can update their organizations" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations as owner" ON public.organizations;

-- 重新創建正確的政策
-- 1. 允許認證用戶查看他們所屬的組織
CREATE POLICY "Users can view organizations they belong to"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

-- 2. 允許組織擁有者更新他們的組織
CREATE POLICY "Organization owners can update their organizations"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid());

-- 3. 允許認證用戶創建組織（關鍵政策）
CREATE POLICY "Users can create organizations"
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());

-- 確保 RLS 已啟用
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
