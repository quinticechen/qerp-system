
-- =============================================
-- 清除所有 USING (true) 的危險 policy
-- =============================================

-- customers
DROP POLICY IF EXISTS "Authenticated users can view customers" ON public.customers;
DROP POLICY IF EXISTS "Authenticated users can update customers" ON public.customers;
DROP POLICY IF EXISTS "Authenticated users can delete customers" ON public.customers;

-- factories
DROP POLICY IF EXISTS "Authenticated users can view all factories" ON public.factories;
DROP POLICY IF EXISTS "Authenticated users can view factories" ON public.factories;
DROP POLICY IF EXISTS "Authenticated users can update factories" ON public.factories;
DROP POLICY IF EXISTS "Authenticated users can delete factories" ON public.factories;

-- products_new
DROP POLICY IF EXISTS "Authenticated users can view all products" ON public.products_new;
DROP POLICY IF EXISTS "Authenticated users can view products" ON public.products_new;
DROP POLICY IF EXISTS "Authenticated users can update products" ON public.products_new;
DROP POLICY IF EXISTS "Authenticated users can delete products" ON public.products_new;

-- inventories
DROP POLICY IF EXISTS "Authenticated users can view all inventories" ON public.inventories;
DROP POLICY IF EXISTS "Authenticated users can view inventories" ON public.inventories;
DROP POLICY IF EXISTS "Authenticated users can update inventories" ON public.inventories;
DROP POLICY IF EXISTS "Authenticated users can delete inventories" ON public.inventories;

-- orders
DROP POLICY IF EXISTS "Authenticated users can view orders" ON public.orders;

-- purchase_orders
DROP POLICY IF EXISTS "Authenticated users can view purchase orders" ON public.purchase_orders;

-- shippings
DROP POLICY IF EXISTS "Authenticated users can view all shippings" ON public.shippings;
DROP POLICY IF EXISTS "Authenticated users can view shippings" ON public.shippings;
DROP POLICY IF EXISTS "Authenticated users can update shippings" ON public.shippings;
DROP POLICY IF EXISTS "Authenticated users can delete shippings" ON public.shippings;

-- shipping_items
DROP POLICY IF EXISTS "Authenticated users can view all shipping_items" ON public.shipping_items;
DROP POLICY IF EXISTS "Authenticated users can view shipping items" ON public.shipping_items;
DROP POLICY IF EXISTS "Authenticated users can update shipping_items" ON public.shipping_items;
DROP POLICY IF EXISTS "Authenticated users can delete shipping_items" ON public.shipping_items;

-- shipment_history
DROP POLICY IF EXISTS "Authenticated users can view all shipment_history" ON public.shipment_history;
DROP POLICY IF EXISTS "Authenticated users can view shipment history" ON public.shipment_history;
DROP POLICY IF EXISTS "Authenticated users can update shipment_history" ON public.shipment_history;
DROP POLICY IF EXISTS "Authenticated users can delete shipment_history" ON public.shipment_history;

-- inventory_rolls
DROP POLICY IF EXISTS "Authenticated users can view all inventory_rolls" ON public.inventory_rolls;
DROP POLICY IF EXISTS "Authenticated users can view inventory rolls" ON public.inventory_rolls;
DROP POLICY IF EXISTS "Authenticated users can update inventory_rolls" ON public.inventory_rolls;
DROP POLICY IF EXISTS "Authenticated users can delete inventory_rolls" ON public.inventory_rolls;

-- warehouses
DROP POLICY IF EXISTS "Authenticated users can view all warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Authenticated users can view warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Authenticated users can update warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Authenticated users can delete warehouses" ON public.warehouses;

-- =============================================
-- 為子資料表補上 org 隔離 policy（透過父表 JOIN）
-- =============================================

-- inventory_rolls → 透過 inventories.organization_id 隔離
CREATE POLICY "org_isolation_select" ON public.inventory_rolls
  FOR SELECT TO authenticated
  USING (inventory_id IN (
    SELECT id FROM public.inventories
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_organizations
      WHERE user_id = auth.uid() AND is_active = true
    )
  ));

CREATE POLICY "org_isolation_modify" ON public.inventory_rolls
  FOR ALL TO authenticated
  USING (inventory_id IN (
    SELECT id FROM public.inventories
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_organizations
      WHERE user_id = auth.uid() AND is_active = true
    )
  ))
  WITH CHECK (inventory_id IN (
    SELECT id FROM public.inventories
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_organizations
      WHERE user_id = auth.uid() AND is_active = true
    )
  ));

-- shipping_items → 透過 shippings.organization_id 隔離
CREATE POLICY "org_isolation_select" ON public.shipping_items
  FOR SELECT TO authenticated
  USING (shipping_id IN (
    SELECT id FROM public.shippings
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_organizations
      WHERE user_id = auth.uid() AND is_active = true
    )
  ));

CREATE POLICY "org_isolation_modify" ON public.shipping_items
  FOR ALL TO authenticated
  USING (shipping_id IN (
    SELECT id FROM public.shippings
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_organizations
      WHERE user_id = auth.uid() AND is_active = true
    )
  ))
  WITH CHECK (shipping_id IN (
    SELECT id FROM public.shippings
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_organizations
      WHERE user_id = auth.uid() AND is_active = true
    )
  ));

-- shipment_history → 透過 customers.organization_id 隔離
CREATE POLICY "org_isolation_select" ON public.shipment_history
  FOR SELECT TO authenticated
  USING (customer_id IN (
    SELECT id FROM public.customers
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_organizations
      WHERE user_id = auth.uid() AND is_active = true
    )
  ));

CREATE POLICY "org_isolation_modify" ON public.shipment_history
  FOR ALL TO authenticated
  USING (customer_id IN (
    SELECT id FROM public.customers
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_organizations
      WHERE user_id = auth.uid() AND is_active = true
    )
  ))
  WITH CHECK (customer_id IN (
    SELECT id FROM public.customers
    WHERE organization_id IN (
      SELECT organization_id FROM public.user_organizations
      WHERE user_id = auth.uid() AND is_active = true
    )
  ));
