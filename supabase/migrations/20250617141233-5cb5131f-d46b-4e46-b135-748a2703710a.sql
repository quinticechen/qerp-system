
-- 首先檢查 profiles 表的政策結構，然後重新配置 organizations 表
-- 刪除所有現有的 organizations 表政策並重新創建

-- 完全重置 organizations 表的 RLS 政策
DROP POLICY IF EXISTS "Users can view organizations they belong to" ON public.organizations;
DROP POLICY IF EXISTS "Organization owners can update their organizations" ON public.organizations;
DROP POLICY IF EXISTS "Allow authenticated users to create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations as owner" ON public.organizations;

-- 重新創建簡單且正確的政策，類似 profiles 表的結構
-- 1. 允許認證用戶創建組織（只能設定自己為擁有者）
CREATE POLICY "Users can insert own organization" 
  ON public.organizations
  FOR INSERT 
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- 2. 允許用戶查看他們所屬的組織
CREATE POLICY "Users can view own organizations" 
  ON public.organizations
  FOR SELECT 
  TO authenticated
  USING (
    owner_id = auth.uid() OR 
    id IN (SELECT organization_id FROM public.user_organizations WHERE user_id = auth.uid() AND is_active = true)
  );

-- 3. 允許組織擁有者更新組織
CREATE POLICY "Users can update own organizations" 
  ON public.organizations
  FOR UPDATE 
  TO authenticated
  USING (owner_id = auth.uid());

-- 同時修復相關表的政策
-- user_organizations 表
DROP POLICY IF EXISTS "Users can view their organization memberships" ON public.user_organizations;
DROP POLICY IF EXISTS "Allow organization creation to add owner membership" ON public.user_organizations;

CREATE POLICY "Users can view own memberships" 
  ON public.user_organizations
  FOR SELECT 
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own memberships" 
  ON public.user_organizations
  FOR INSERT 
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- organization_roles 表
DROP POLICY IF EXISTS "Users can view roles in their organizations" ON public.organization_roles;
DROP POLICY IF EXISTS "Allow system to create default roles" ON public.organization_roles;

CREATE POLICY "Users can view organization roles" 
  ON public.organization_roles
  FOR SELECT 
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "System can create default roles" 
  ON public.organization_roles
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- user_organization_roles 表
DROP POLICY IF EXISTS "Users can view roles in their organizations" ON public.user_organization_roles;
DROP POLICY IF EXISTS "Allow system to assign owner role" ON public.user_organization_roles;

CREATE POLICY "Users can view own organization roles" 
  ON public.user_organization_roles
  FOR SELECT 
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can assign roles" 
  ON public.user_organization_roles
  FOR INSERT 
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR granted_by = auth.uid());

-- 確保所有表都啟用了 RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_organization_roles ENABLE ROW LEVEL SECURITY;
