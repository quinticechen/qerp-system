-- 業務 API A6 貨架（docs/BUSINESS_API.md §3、§5，決策 B4、B6）
--
-- 1. 貨架（warehouses）新增 is_active；名稱組織內唯一（不分大小寫）
-- 2. create_shelf、update_shelf（名稱、位置）、set_shelf_active
-- 3. 停用的貨架不能放新布卷，也不能把布卷移過去；已在上面的布卷不受影響（save_inventory_rolls，其餘與 A4 相同）

-- ===== 1. 貨架狀態與唯一性

ALTER TABLE public.warehouses ADD COLUMN is_active boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX warehouses_organization_name_key ON public.warehouses (organization_id, lower(btrim(name)));

-- ===== 2. 停用的貨架不能再放布卷

CREATE OR REPLACE FUNCTION public.save_inventory_rolls(p_inventory_id uuid, p_rolls jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_roll record;
  v_existing inventory_rolls;
  v_shipped numeric;
  v_number text;
begin
  select organization_id into v_org from inventories where id = p_inventory_id for update;
  if not found then
    raise exception '找不到入庫紀錄，或沒有編輯權限' using errcode = 'P0002', hint = 'inventory_not_found';
  end if;
  if jsonb_typeof(coalesce(p_rolls, '[]')) <> 'array' or jsonb_array_length(coalesce(p_rolls, '[]')) = 0 then
    raise exception '入庫紀錄至少需要一卷布' using errcode = '22023', hint = 'rolls_required';
  end if;

  for v_roll in
    select * from jsonb_to_recordset(p_rolls)
      as x(id uuid, product_id uuid, warehouse_id uuid, shelf text, quality fabric_quality,
           quantity numeric, roll_number text, specifications jsonb)
  loop
    if v_roll.product_id is null
      or not exists (select 1 from products_new where id = v_roll.product_id and organization_id = v_org) then
      raise exception '請選擇此組織的產品' using errcode = 'P0002', hint = 'product_not_found';
    end if;
    if v_roll.warehouse_id is null
      or not exists (select 1 from warehouses where id = v_roll.warehouse_id and organization_id = v_org) then
      raise exception '請選擇此組織的倉庫' using errcode = 'P0002', hint = 'warehouse_not_found';
    end if;
    -- New rolls and rolls moved to another shelf need an active one; rolls staying put may stay on a disabled shelf
    if not (select is_active from warehouses where id = v_roll.warehouse_id)
      and not exists (select 1 from inventory_rolls where id = v_roll.id and inventory_id = p_inventory_id and warehouse_id = v_roll.warehouse_id) then
      raise exception '貨架「%」已停用', (select name from warehouses where id = v_roll.warehouse_id)
        using errcode = '22023', hint = 'warehouse_inactive';
    end if;
    if coalesce(v_roll.quantity, 0) <= 0 then
      raise exception '布卷重量必須大於 0' using errcode = '22023', hint = 'invalid_quantity';
    end if;
  end loop;

  for v_existing in
    select * from inventory_rolls ir
    where ir.inventory_id = p_inventory_id
      and ir.id not in (
        select x.id from jsonb_to_recordset(p_rolls) as x(id uuid) where x.id is not null
      )
  loop
    if exists (select 1 from shipping_items where inventory_roll_id = v_existing.id) then
      raise exception '布卷「%」已出貨，不可刪除', v_existing.roll_number using errcode = '55000', hint = 'roll_shipped';
    end if;
    delete from inventory_rolls where id = v_existing.id;
  end loop;

  for v_roll in
    select * from jsonb_to_recordset(p_rolls)
      as x(id uuid, product_id uuid, warehouse_id uuid, shelf text, quality fabric_quality,
           quantity numeric, roll_number text, specifications jsonb)
  loop
    if v_roll.id is null then
      v_number := coalesce(nullif(trim(v_roll.roll_number), ''), api_new_roll_number());
      if exists (select 1 from inventory_rolls where roll_number = v_number) then
        raise exception '布卷編號「%」已被使用', v_number using errcode = '23505', hint = 'roll_number_taken';
      end if;
      -- clock_timestamp() rather than now(): rolls added in one call keep the order they were given in
      insert into inventory_rolls (inventory_id, product_id, warehouse_id, shelf, quality, quantity, current_quantity, roll_number, specifications, created_at)
      values (p_inventory_id, v_roll.product_id, v_roll.warehouse_id, nullif(trim(v_roll.shelf), ''),
              coalesce(v_roll.quality, 'A'), v_roll.quantity, v_roll.quantity, v_number, v_roll.specifications, clock_timestamp());
      continue;
    end if;

    select * into v_existing from inventory_rolls where id = v_roll.id and inventory_id = p_inventory_id;
    if not found then
      raise exception '布卷不屬於此入庫紀錄' using errcode = 'P0002', hint = 'roll_not_found';
    end if;

    if v_roll.product_id <> v_existing.product_id
      and exists (select 1 from shipping_items where inventory_roll_id = v_existing.id) then
      raise exception '布卷「%」已出貨，不可更換產品', v_existing.roll_number using errcode = '55000', hint = 'roll_shipped';
    end if;

    -- Shipped weight stays fixed; current stock follows the corrected received weight
    v_shipped := v_existing.quantity - v_existing.current_quantity;
    if v_roll.quantity < v_shipped then
      raise exception '布卷「%」的入庫重量不可低於已出貨 % 公斤', v_existing.roll_number, v_shipped
        using errcode = '55000', hint = 'quantity_below_shipped';
    end if;

    update inventory_rolls
    set product_id = v_roll.product_id,
        warehouse_id = v_roll.warehouse_id,
        shelf = nullif(trim(v_roll.shelf), ''),
        quality = coalesce(v_roll.quality, v_existing.quality),
        quantity = v_roll.quantity,
        current_quantity = v_roll.quantity - v_shipped,
        is_allocated = (v_roll.quantity - v_shipped) <= 0,
        specifications = v_roll.specifications
    where id = v_roll.id;
  end loop;
end;
$function$;

-- ===== 3. 貨架 API

-- Raise unless a shelf name is given and not used by another shelf of the organization
CREATE FUNCTION public.api_check_shelf_name(p_organization_id uuid, p_name text, p_except_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_name IS NULL THEN
    RAISE EXCEPTION '請輸入貨架名稱' USING ERRCODE = '22023', HINT = 'name_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.warehouses
    WHERE organization_id = p_organization_id AND lower(btrim(name)) = lower(p_name) AND id IS DISTINCT FROM p_except_id
  ) THEN
    RAISE EXCEPTION '已有同名的貨架「%」', p_name USING ERRCODE = '23505', HINT = 'shelf_name_taken';
  END IF;
END;
$function$;

-- 「N 卷，X 公斤」 still on a shelf
CREATE FUNCTION public.api_shelf_stock_label(p_shelf_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE count(*) || ' 卷，' || public.api_number(sum(current_quantity)) || ' 公斤' END
  FROM public.inventory_rolls WHERE warehouse_id = p_shelf_id AND current_quantity > 0;
$function$;

CREATE FUNCTION public.create_shelf(
  p_organization_id uuid,
  p_name text,
  p_location text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := public.api_clean(p_name);
  v_location text := public.api_clean(p_location);
  v_id uuid;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateShelves');
  PERFORM public.api_check_shelf_name(p_organization_id, v_name, NULL);

  v_fields := public.api_fields('貨架名稱', v_name, '位置', v_location);
  IF p_dry_run THEN
    RETURN public.api_result(true, NULL, NULL, '建立貨架', v_fields);
  END IF;

  INSERT INTO public.warehouses (organization_id, name, location) VALUES (p_organization_id, v_name, v_location)
  RETURNING id INTO v_id;

  RETURN public.api_result(false, v_id, NULL, '建立貨架', v_fields);
END;
$function$;

-- p_changes may hold name, location
CREATE FUNCTION public.update_shelf(
  p_organization_id uuid,
  p_shelf_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.warehouses%ROWTYPE;
  v_name text;
  v_location text;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditShelves');
  PERFORM public.api_check_change_keys(p_changes, ARRAY['name', 'location']);

  SELECT * INTO v_old FROM public.warehouses WHERE id = p_shelf_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此貨架' USING ERRCODE = 'P0002', HINT = 'shelf_not_found';
  END IF;

  v_name := public.api_changed(p_changes, 'name', v_old.name);
  v_location := public.api_changed(p_changes, 'location', v_old.location);
  PERFORM public.api_check_shelf_name(p_organization_id, v_name, p_shelf_id);

  v_title := format('修改貨架「%s」', v_old.name);
  v_fields := public.api_changed_fields('貨架名稱', v_old.name, v_name, '位置', v_old.location, v_location);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_shelf_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.warehouses SET name = v_name, location = v_location WHERE id = p_shelf_id;

  RETURN public.api_result(false, p_shelf_id, NULL, v_title, v_fields);
END;
$function$;

-- A disabled shelf keeps the rolls on it but gets no new ones; the card shows what is still there
CREATE FUNCTION public.set_shelf_active(
  p_organization_id uuid,
  p_shelf_id uuid,
  p_is_active boolean,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.warehouses%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditShelves');
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION '請指定要啟用或停用' USING ERRCODE = '22023', HINT = 'is_active_required';
  END IF;

  SELECT * INTO v_old FROM public.warehouses WHERE id = p_shelf_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此貨架' USING ERRCODE = 'P0002', HINT = 'shelf_not_found';
  END IF;

  v_title := format('%s貨架「%s」', CASE WHEN p_is_active THEN '啟用' ELSE '停用' END, v_old.name);
  v_fields := public.api_changed_fields('狀態',
      CASE WHEN v_old.is_active THEN '啟用' ELSE '停用' END,
      CASE WHEN p_is_active THEN '啟用' ELSE '停用' END)
    || CASE WHEN p_is_active THEN '[]'::jsonb ELSE public.api_fields('仍有庫存', public.api_shelf_stock_label(p_shelf_id)) END;
  IF p_dry_run THEN
    RETURN public.api_result(true, p_shelf_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.warehouses SET is_active = p_is_active WHERE id = p_shelf_id AND is_active IS DISTINCT FROM p_is_active;

  RETURN public.api_result(false, p_shelf_id, NULL, v_title, v_fields);
END;
$function$;

REVOKE ALL ON FUNCTION public.api_check_shelf_name(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_shelf_stock_label(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_shelf(uuid, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_shelf(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_shelf_active(uuid, uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shelf(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_shelf(uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_shelf_active(uuid, uuid, boolean, boolean) TO authenticated;
