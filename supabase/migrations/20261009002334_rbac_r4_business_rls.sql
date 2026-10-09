-- RBAC R4：業務資料表依權限鍵收緊 RLS（docs/MULTI_TENANT_RBAC.md §4.4、§5；R3、R5）
--
-- 原本業務資料表只檢查「是不是組織成員」，訪客也能直接寫入與刪除。改為：
--   主檔與單據：SELECT → 查看鍵、INSERT → 新增鍵、UPDATE → 編輯鍵；不開放 DELETE（停用／取消取代刪除，R5）
--   明細與關聯（品項、指定工廠、採購關聯、布卷、出貨項目、出貨紀錄）：依上層單據的組織判斷；
--     SELECT → 查看鍵、INSERT → 新增或編輯鍵、UPDATE／DELETE → 編輯鍵（編輯單據時替換品項需要刪除明細）
-- 業務 API（A1–A6）以函式擁有者身分執行，不受影響；仍直接寫表的頁面（貨架）與 AI tools 只要使用者有對應的鍵就照常運作。
-- 條件一律使用 user_has_organization_permission(auth.uid(), organization_id, '<鍵>')，與 RPC、AI authGuard 相同。
-- policy 只開放給 authenticated，匿名請求讀不到也寫不了任何一列。

-- ===== 1. 移除舊的「組織成員即可」policy

DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (
      'customers', 'factories', 'products_new', 'warehouses',
      'orders', 'order_products', 'order_factories',
      'purchase_orders', 'purchase_order_items', 'purchase_order_relations',
      'inventories', 'inventory_rolls',
      'shippings', 'shipping_items', 'shipment_history')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_policy.tablename);
  END LOOP;
END $$;

-- ===== 2. 主檔與單據

DO $$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT * FROM (VALUES
      ('customers', 'Customers'),
      ('factories', 'Factories'),
      ('products_new', 'Products'),
      ('warehouses', 'Shelves'),
      ('orders', 'Orders'),
      ('purchase_orders', 'Purchases'),
      ('inventories', 'Inventory'),
      ('shippings', 'Shipping')
    ) AS t(name, area)
  LOOP
    EXECUTE format($p$CREATE POLICY rbac_select ON public.%I FOR SELECT TO authenticated
      USING (public.user_has_organization_permission(auth.uid(), organization_id, %L))$p$, v_table.name, 'canView' || v_table.area);
    EXECUTE format($p$CREATE POLICY rbac_insert ON public.%I FOR INSERT TO authenticated
      WITH CHECK (public.user_has_organization_permission(auth.uid(), organization_id, %L))$p$, v_table.name, 'canCreate' || v_table.area);
    EXECUTE format($p$CREATE POLICY rbac_update ON public.%I FOR UPDATE TO authenticated
      USING (public.user_has_organization_permission(auth.uid(), organization_id, %L))
      WITH CHECK (public.user_has_organization_permission(auth.uid(), organization_id, %L))$p$,
      v_table.name, 'canEdit' || v_table.area, 'canEdit' || v_table.area);
  END LOOP;
END $$;

-- ===== 3. 明細與關聯：依上層單據的組織

-- Child tables whose rows belong to a parent document through a foreign key
DO $$
DECLARE
  v_table record;
  v_parent text;
BEGIN
  FOR v_table IN
    SELECT * FROM (VALUES
      ('order_products', 'order_id', 'orders', 'Orders'),
      ('purchase_order_items', 'purchase_order_id', 'purchase_orders', 'Purchases'),
      ('inventory_rolls', 'inventory_id', 'inventories', 'Inventory'),
      ('shipping_items', 'shipping_id', 'shippings', 'Shipping')
    ) AS t(name, fk, parent, area)
  LOOP
    -- The child's column is qualified with its table name so it never resolves to a parent column
    v_parent := format('EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I AND public.user_has_organization_permission(auth.uid(), p.organization_id, %%L))',
      v_table.parent, v_table.name, v_table.fk);
    EXECUTE format('CREATE POLICY rbac_select ON public.%I FOR SELECT TO authenticated USING (' || v_parent || ')',
      v_table.name, 'canView' || v_table.area);
    EXECUTE format('CREATE POLICY rbac_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (' || v_parent || ' OR ' || v_parent || ')',
      v_table.name, 'canCreate' || v_table.area, 'canEdit' || v_table.area);
    EXECUTE format('CREATE POLICY rbac_update ON public.%I FOR UPDATE TO authenticated USING (' || v_parent || ') WITH CHECK (' || v_parent || ')',
      v_table.name, 'canEdit' || v_table.area, 'canEdit' || v_table.area);
    EXECUTE format('CREATE POLICY rbac_delete ON public.%I FOR DELETE TO authenticated USING (' || v_parent || ')',
      v_table.name, 'canEdit' || v_table.area);
  END LOOP;
END $$;

-- An order's factories: the factory must be in the order's organization (R0 S4)
CREATE POLICY rbac_select ON public.order_factories FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_factories.order_id
                 AND public.user_has_organization_permission(auth.uid(), o.organization_id, 'canViewOrders')));
CREATE POLICY rbac_insert ON public.order_factories FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o JOIN public.factories f ON f.id = order_factories.factory_id AND f.organization_id = o.organization_id
                      WHERE o.id = order_factories.order_id
                        AND (public.user_has_organization_permission(auth.uid(), o.organization_id, 'canCreateOrders')
                             OR public.user_has_organization_permission(auth.uid(), o.organization_id, 'canEditOrders'))));
CREATE POLICY rbac_update ON public.order_factories FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_factories.order_id
                 AND public.user_has_organization_permission(auth.uid(), o.organization_id, 'canEditOrders')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o JOIN public.factories f ON f.id = order_factories.factory_id AND f.organization_id = o.organization_id
                      WHERE o.id = order_factories.order_id AND public.user_has_organization_permission(auth.uid(), o.organization_id, 'canEditOrders')));
CREATE POLICY rbac_delete ON public.order_factories FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_factories.order_id
                 AND public.user_has_organization_permission(auth.uid(), o.organization_id, 'canEditOrders')));

-- A purchase order's linked orders: the order must be in the purchase order's organization (R0 S4)
CREATE POLICY rbac_select ON public.purchase_order_relations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_relations.purchase_order_id
                 AND public.user_has_organization_permission(auth.uid(), po.organization_id, 'canViewPurchases')));
CREATE POLICY rbac_insert ON public.purchase_order_relations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_orders po JOIN public.orders o ON o.id = purchase_order_relations.order_id AND o.organization_id = po.organization_id
                      WHERE po.id = purchase_order_relations.purchase_order_id
                        AND (public.user_has_organization_permission(auth.uid(), po.organization_id, 'canCreatePurchases')
                             OR public.user_has_organization_permission(auth.uid(), po.organization_id, 'canEditPurchases'))));
CREATE POLICY rbac_update ON public.purchase_order_relations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_relations.purchase_order_id
                 AND public.user_has_organization_permission(auth.uid(), po.organization_id, 'canEditPurchases')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_orders po JOIN public.orders o ON o.id = purchase_order_relations.order_id AND o.organization_id = po.organization_id
                      WHERE po.id = purchase_order_relations.purchase_order_id AND public.user_has_organization_permission(auth.uid(), po.organization_id, 'canEditPurchases')));
CREATE POLICY rbac_delete ON public.purchase_order_relations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.id = purchase_order_relations.purchase_order_id
                 AND public.user_has_organization_permission(auth.uid(), po.organization_id, 'canEditPurchases')));

-- Shipment history rows belong to the organization of their customer
CREATE POLICY rbac_select ON public.shipment_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = shipment_history.customer_id
                 AND public.user_has_organization_permission(auth.uid(), c.organization_id, 'canViewShipping')));
CREATE POLICY rbac_insert ON public.shipment_history FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = shipment_history.customer_id
                      AND (public.user_has_organization_permission(auth.uid(), c.organization_id, 'canCreateShipping')
                           OR public.user_has_organization_permission(auth.uid(), c.organization_id, 'canEditShipping'))));
CREATE POLICY rbac_update ON public.shipment_history FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = shipment_history.customer_id
                 AND public.user_has_organization_permission(auth.uid(), c.organization_id, 'canEditShipping')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = shipment_history.customer_id
                      AND public.user_has_organization_permission(auth.uid(), c.organization_id, 'canEditShipping')));
CREATE POLICY rbac_delete ON public.shipment_history FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = shipment_history.customer_id
                 AND public.user_has_organization_permission(auth.uid(), c.organization_id, 'canEditShipping')));
