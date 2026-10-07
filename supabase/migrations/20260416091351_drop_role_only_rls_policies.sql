
-- Drop all role-only policies that bypass org isolation.
-- The org-isolation policies ("Users can manage/view X in their organizations")
-- already cover all CRUD operations correctly.
-- Role enforcement lives in the application layer (auth-guard.ts).

-- customers
DROP POLICY IF EXISTS "Authenticated users can create customers"       ON public.customers;
DROP POLICY IF EXISTS "Sales, assistants and admins can manage customers" ON public.customers;

-- factories
DROP POLICY IF EXISTS "Authenticated users can create factories"       ON public.factories;
DROP POLICY IF EXISTS "Sales, assistants and admins can manage factories" ON public.factories;

-- inventories
DROP POLICY IF EXISTS "Authenticated users can create inventories"     ON public.inventories;
DROP POLICY IF EXISTS "Warehouse staff and admins can manage inventories" ON public.inventories;

-- inventory_rolls
DROP POLICY IF EXISTS "Authenticated users can create inventory_rolls" ON public.inventory_rolls;
DROP POLICY IF EXISTS "Warehouse staff and admins can manage inventory rolls" ON public.inventory_rolls;

-- orders
DROP POLICY IF EXISTS "Sales, assistants and admins can manage orders" ON public.orders;

-- products_new
DROP POLICY IF EXISTS "Sales and admins can manage products"           ON public.products_new;
DROP POLICY IF EXISTS "Users can create their own products"            ON public.products_new;

-- purchase_orders
DROP POLICY IF EXISTS "Sales and admins can manage purchase orders"    ON public.purchase_orders;

-- shippings
DROP POLICY IF EXISTS "Authenticated users can create shippings"       ON public.shippings;
DROP POLICY IF EXISTS "Warehouse staff and admins can manage shippings" ON public.shippings;
