
-- 創建組織表
CREATE TABLE public.organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  settings JSONB DEFAULT '{}',
  owner_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 創建使用者組織關聯表
CREATE TABLE public.user_organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  invited_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

-- 創建組織自定義角色表
CREATE TABLE public.organization_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '{}',
  is_system_role BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID,
  UNIQUE(organization_id, name)
);

-- 創建使用者在組織中的角色關聯表
CREATE TABLE public.user_organization_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.organization_roles(id) ON DELETE CASCADE,
  granted_by UUID,
  granted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id, role_id)
);

-- 為現有業務表格添加 organization_id 欄位
ALTER TABLE public.products_new ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.customers ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.factories ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.orders ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.purchase_orders ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.inventories ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.shippings ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.warehouses ADD COLUMN organization_id UUID REFERENCES public.organizations(id);

-- 啟用 RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_organization_roles ENABLE ROW LEVEL SECURITY;

-- 創建組織相關的安全函數
CREATE OR REPLACE FUNCTION public.get_user_organizations(_user_id UUID)
RETURNS TABLE(organization_id UUID)
LANGUAGE SQL
STABLE SECURITY DEFINER
AS $$
  SELECT uo.organization_id
  FROM public.user_organizations uo
  WHERE uo.user_id = _user_id
    AND uo.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.user_belongs_to_organization(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_organizations uo
    WHERE uo.user_id = _user_id
      AND uo.organization_id = _organization_id
      AND uo.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_organization_owner(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = _organization_id
      AND o.owner_id = _user_id
      AND o.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_organization_permission(_user_id UUID, _organization_id UUID, _permission TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_organization_roles uor
    JOIN public.organization_roles r ON uor.role_id = r.id
    WHERE uor.user_id = _user_id
      AND uor.organization_id = _organization_id
      AND uor.is_active = true
      AND r.is_active = true
      AND (r.permissions->>_permission)::boolean = true
  ) OR public.is_organization_owner(_user_id, _organization_id);
$$;

-- 創建 RLS 政策
-- Organizations 表政策
CREATE POLICY "Users can view organizations they belong to"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization owners can update their organizations"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Authenticated users can create organizations"
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- User Organizations 表政策
CREATE POLICY "Users can view their organization memberships"
  ON public.user_organizations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Organization owners can manage memberships"
  ON public.user_organizations
  FOR ALL
  TO authenticated
  USING (
    public.is_organization_owner(auth.uid(), organization_id)
  );

-- Organization Roles 表政策
CREATE POLICY "Users can view roles in their organizations"
  ON public.organization_roles
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization owners can manage roles"
  ON public.organization_roles
  FOR ALL
  TO authenticated
  USING (
    public.is_organization_owner(auth.uid(), organization_id)
  );

-- User Organization Roles 表政策
CREATE POLICY "Users can view roles in their organizations"
  ON public.user_organization_roles
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization owners can manage user roles"
  ON public.user_organization_roles
  FOR ALL
  TO authenticated
  USING (
    public.is_organization_owner(auth.uid(), organization_id)
  );

-- 更新現有業務表格的 RLS 政策
-- Products
DROP POLICY IF EXISTS "Users can view all products" ON public.products_new;
CREATE POLICY "Users can view products in their organizations"
  ON public.products_new
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

CREATE POLICY "Users can manage products in their organizations"
  ON public.products_new
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

-- 為其他業務表格創建類似的 RLS 政策
CREATE POLICY "Users can view customers in their organizations"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

CREATE POLICY "Users can manage customers in their organizations"
  ON public.customers
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

-- 繼續為其他表格創建政策...
CREATE POLICY "Users can view factories in their organizations"
  ON public.factories
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

CREATE POLICY "Users can manage factories in their organizations"
  ON public.factories
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

CREATE POLICY "Users can view orders in their organizations"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

CREATE POLICY "Users can manage orders in their organizations"
  ON public.orders
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM public.get_user_organizations(auth.uid()))
  );

-- 創建更新 updated_at 的觸發器
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_user_organizations_updated_at
  BEFORE UPDATE ON public.user_organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_organization_roles_updated_at
  BEFORE UPDATE ON public.organization_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_user_organization_roles_updated_at
  BEFORE UPDATE ON public.user_organization_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 創建預設組織角色的函數
CREATE OR REPLACE FUNCTION public.create_default_organization_roles(_organization_id UUID)
RETURNS VOID
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
BEGIN
  -- 創建預設的系統角色
  INSERT INTO public.organization_roles (organization_id, name, display_name, description, permissions, is_system_role)
  VALUES 
    (_organization_id, 'owner', '組織擁有者', '組織的最高權限擁有者', '{"canManageOrganization": true, "canManageUsers": true, "canManageRoles": true, "canViewAll": true, "canEditAll": true, "canDeleteAll": true}', true),
    (_organization_id, 'admin', '管理員', '系統管理員，擁有大部分權限', '{"canViewProducts": true, "canCreateProducts": true, "canEditProducts": true, "canDeleteProducts": true, "canViewInventory": true, "canCreateInventory": true, "canEditInventory": true, "canViewOrders": true, "canCreateOrders": true, "canEditOrders": true, "canViewPurchases": true, "canCreatePurchases": true, "canEditPurchases": true, "canViewShipping": true, "canCreateShipping": true, "canEditShipping": true, "canViewCustomers": true, "canCreateCustomers": true, "canEditCustomers": true, "canViewFactories": true, "canCreateFactories": true, "canEditFactories": true, "canViewUsers": true, "canCreateUsers": true, "canEditUsers": true, "canViewPermissions": true, "canEditPermissions": true, "canViewSystemSettings": true, "canEditSystemSettings": true}', true),
    (_organization_id, 'sales', '業務', '負責銷售和客戶管理', '{"canViewProducts": true, "canCreateProducts": false, "canEditProducts": false, "canDeleteProducts": false, "canViewInventory": true, "canCreateInventory": false, "canEditInventory": false, "canViewOrders": true, "canCreateOrders": true, "canEditOrders": true, "canViewPurchases": true, "canCreatePurchases": false, "canEditPurchases": false, "canViewShipping": true, "canCreateShipping": false, "canEditShipping": false, "canViewCustomers": true, "canCreateCustomers": true, "canEditCustomers": true, "canViewFactories": true, "canCreateFactories": false, "canEditFactories": false}', true),
    (_organization_id, 'assistant', '助理', '協助各種業務操作', '{"canViewProducts": true, "canCreateProducts": true, "canEditProducts": true, "canDeleteProducts": false, "canViewInventory": true, "canCreateInventory": true, "canEditInventory": true, "canViewOrders": true, "canCreateOrders": true, "canEditOrders": true, "canViewPurchases": true, "canCreatePurchases": true, "canEditPurchases": true, "canViewShipping": true, "canCreateShipping": true, "canEditShipping": true, "canViewCustomers": true, "canCreateCustomers": true, "canEditCustomers": true, "canViewFactories": true, "canCreateFactories": true, "canEditFactories": true}', true),
    (_organization_id, 'accounting', '會計', '負責財務相關功能', '{"canViewProducts": true, "canCreateProducts": false, "canEditProducts": false, "canDeleteProducts": false, "canViewInventory": true, "canCreateInventory": false, "canEditInventory": false, "canViewOrders": true, "canCreateOrders": false, "canEditOrders": false, "canViewPurchases": true, "canCreatePurchases": false, "canEditPurchases": false, "canViewShipping": true, "canCreateShipping": false, "canEditShipping": false, "canViewCustomers": true, "canCreateCustomers": false, "canEditCustomers": false, "canViewFactories": true, "canCreateFactories": false, "canEditFactories": false}', true),
    (_organization_id, 'warehouse', '倉庫管理員', '負責庫存和出貨管理', '{"canViewProducts": true, "canCreateProducts": false, "canEditProducts": false, "canDeleteProducts": false, "canViewInventory": true, "canCreateInventory": true, "canEditInventory": true, "canViewOrders": true, "canCreateOrders": false, "canEditOrders": false, "canViewPurchases": true, "canCreatePurchases": false, "canEditPurchases": false, "canViewShipping": true, "canCreateShipping": true, "canEditShipping": true, "canViewCustomers": false, "canCreateCustomers": false, "canEditCustomers": false, "canViewFactories": false, "canCreateFactories": false, "canEditFactories": false}', true);
END;
$$;

-- 創建組織創建的觸發器函數
CREATE OR REPLACE FUNCTION public.handle_organization_creation()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
BEGIN
  -- 創建預設角色
  PERFORM public.create_default_organization_roles(NEW.id);
  
  -- 將擁有者加入組織
  INSERT INTO public.user_organizations (user_id, organization_id, is_active)
  VALUES (NEW.owner_id, NEW.id, true);
  
  -- 給擁有者分配 owner 角色
  INSERT INTO public.user_organization_roles (user_id, organization_id, role_id, granted_by)
  SELECT NEW.owner_id, NEW.id, r.id, NEW.owner_id
  FROM public.organization_roles r
  WHERE r.organization_id = NEW.id AND r.name = 'owner';
  
  RETURN NEW;
END;
$$;

-- 創建觸發器
CREATE TRIGGER trigger_organization_creation
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_organization_creation();
