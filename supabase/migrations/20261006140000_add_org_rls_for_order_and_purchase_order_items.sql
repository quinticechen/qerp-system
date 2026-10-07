-- 把 order_products / purchase_order_items 補上跟 shipping_items /
-- shipment_history / warehouses 一致的組織制 RLS，這兩張表原本完全沒有
-- 組織隔離的替代方案，全部寫入權限都靠 get_current_user_role()。
-- 新舊 policy 先共存（RLS 是 OR 關係，不會造成任何功能中斷），等確認運作
-- 正常後再執行 20261006150000_drop_legacy_profile_role_system.sql
-- 清掉舊的角色制 policy 跟 profiles.role 欄位本身。
CREATE POLICY "org_isolation_select" ON public.order_products
FOR SELECT
USING (
  order_id IN (
    SELECT o.id FROM public.orders o
    WHERE o.organization_id IN (
      SELECT uo.organization_id FROM public.user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.is_active = true
    )
  )
);

CREATE POLICY "org_isolation_modify" ON public.order_products
FOR ALL
USING (
  order_id IN (
    SELECT o.id FROM public.orders o
    WHERE o.organization_id IN (
      SELECT uo.organization_id FROM public.user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.is_active = true
    )
  )
)
WITH CHECK (
  order_id IN (
    SELECT o.id FROM public.orders o
    WHERE o.organization_id IN (
      SELECT uo.organization_id FROM public.user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.is_active = true
    )
  )
);

CREATE POLICY "org_isolation_select" ON public.purchase_order_items
FOR SELECT
USING (
  purchase_order_id IN (
    SELECT po.id FROM public.purchase_orders po
    WHERE po.organization_id IN (
      SELECT uo.organization_id FROM public.user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.is_active = true
    )
  )
);

CREATE POLICY "org_isolation_modify" ON public.purchase_order_items
FOR ALL
USING (
  purchase_order_id IN (
    SELECT po.id FROM public.purchase_orders po
    WHERE po.organization_id IN (
      SELECT uo.organization_id FROM public.user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.is_active = true
    )
  )
)
WITH CHECK (
  purchase_order_id IN (
    SELECT po.id FROM public.purchase_orders po
    WHERE po.organization_id IN (
      SELECT uo.organization_id FROM public.user_organizations uo
      WHERE uo.user_id = auth.uid() AND uo.is_active = true
    )
  )
);

-- 這兩個 trigger function 會寫入 profiles.role，先移除這個欄位依賴，
-- 之後才能安全刪除該欄位，不會讓新使用者註冊失敗。
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    true
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_user_profile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_record RECORD;
BEGIN
  FOR user_record IN
    SELECT au.id, au.email, au.raw_user_meta_data
    FROM auth.users au
    LEFT JOIN public.profiles p ON au.id = p.id
    WHERE p.id IS NULL
  LOOP
    INSERT INTO public.profiles (id, email, full_name, is_active)
    VALUES (
      user_record.id,
      user_record.email,
      COALESCE(user_record.raw_user_meta_data->>'full_name', user_record.email),
      true
    );
  END LOOP;
END;
$$;
