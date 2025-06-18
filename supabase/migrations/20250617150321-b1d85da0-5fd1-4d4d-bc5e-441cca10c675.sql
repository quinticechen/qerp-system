
-- 為業務表格添加適當的 RLS 政策以按組織篩選資料

-- Products RLS policies
DROP POLICY IF EXISTS "Users can view products in their organizations" ON public.products_new;
DROP POLICY IF EXISTS "Users can manage products in their organizations" ON public.products_new;

CREATE POLICY "Users can view products in their organizations"
  ON public.products_new
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can manage products in their organizations"
  ON public.products_new
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Customers RLS policies
DROP POLICY IF EXISTS "Users can view customers in their organizations" ON public.customers;
DROP POLICY IF EXISTS "Users can manage customers in their organizations" ON public.customers;

CREATE POLICY "Users can view customers in their organizations"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can manage customers in their organizations"
  ON public.customers
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Factories RLS policies
DROP POLICY IF EXISTS "Users can view factories in their organizations" ON public.factories;
DROP POLICY IF EXISTS "Users can manage factories in their organizations" ON public.factories;

CREATE POLICY "Users can view factories in their organizations"
  ON public.factories
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can manage factories in their organizations"
  ON public.factories
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Orders RLS policies
DROP POLICY IF EXISTS "Users can view orders in their organizations" ON public.orders;
DROP POLICY IF EXISTS "Users can manage orders in their organizations" ON public.orders;

CREATE POLICY "Users can view orders in their organizations"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can manage orders in their organizations"
  ON public.orders
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Purchase Orders RLS policies
DROP POLICY IF EXISTS "Users can view purchase orders in their organizations" ON public.purchase_orders;
DROP POLICY IF EXISTS "Users can manage purchase orders in their organizations" ON public.purchase_orders;

CREATE POLICY "Users can view purchase orders in their organizations"
  ON public.purchase_orders
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can manage purchase orders in their organizations"
  ON public.purchase_orders
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Inventories RLS policies
DROP POLICY IF EXISTS "Users can view inventories in their organizations" ON public.inventories;
DROP POLICY IF EXISTS "Users can manage inventories in their organizations" ON public.inventories;

CREATE POLICY "Users can view inventories in their organizations"
  ON public.inventories
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can manage inventories in their organizations"
  ON public.inventories
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Shippings RLS policies
DROP POLICY IF EXISTS "Users can view shippings in their organizations" ON public.shippings;
DROP POLICY IF EXISTS "Users can manage shippings in their organizations" ON public.shippings;

CREATE POLICY "Users can view shippings in their organizations"
  ON public.shippings
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can manage shippings in their organizations"
  ON public.shippings
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- Warehouses RLS policies
DROP POLICY IF EXISTS "Users can view warehouses in their organizations" ON public.warehouses;
DROP POLICY IF EXISTS "Users can manage warehouses in their organizations" ON public.warehouses;

CREATE POLICY "Users can view warehouses in their organizations"
  ON public.warehouses
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY "Users can manage warehouses in their organizations"
  ON public.warehouses
  FOR ALL
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM public.user_organizations 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- 確保所有業務表格都啟用 RLS
ALTER TABLE public.products_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shippings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
