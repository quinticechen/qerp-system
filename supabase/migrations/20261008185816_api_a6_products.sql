-- 業務 API A6 產品（docs/BUSINESS_API.md §7，決策 B5、B7）
--
-- 1. 產品改為兩層：產品（母，product_groups：名稱、類別、單位、啟用）＋顏色（子，既有的 products_new：
--    顏色、色號、色值、安全庫存、狀態）。單據與庫存原本就指向顏色那一列，關聯不變。
-- 2. 產品名稱組織內唯一；同一產品下「顏色＋色號」唯一（取代全域的 UNIQUE (name, color, color_code)，B5）。
-- 3. 顏色列保留 name／category／unit_of_measure，一律由母表同步；尚未改用 API 的寫入會自動歸到同名產品。
-- 4. 唯讀 view product_catalog：產品、顏色、每個顏色的庫存與是否低於安全庫存。
-- 5. API：create_product、update_product、set_product_active、add_product_color、update_product_color、
--    set_product_color_active；停用的產品不能再下新訂單。
-- 6. save_order_items 補回固定 search_path（A2 重新定義時遺漏）。

ALTER FUNCTION public.save_order_items(uuid, jsonb) SET search_path TO 'public';

-- ===== 1. 產品（母）

CREATE TABLE public.product_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  category text NOT NULL DEFAULT '布料',
  unit_of_measure text NOT NULL DEFAULT 'KG',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX product_groups_organization_name_key ON public.product_groups (organization_id, lower(name));

ALTER TABLE public.product_groups ENABLE ROW LEVEL SECURITY;

-- Products are written only through the APIs; members who may view products can read them
CREATE POLICY "Members with canViewProducts can view products" ON public.product_groups
  FOR SELECT TO authenticated
  USING (public.user_has_organization_permission(auth.uid(), organization_id, 'canViewProducts'));

REVOKE ALL ON public.product_groups FROM anon, authenticated;
GRANT SELECT ON public.product_groups TO authenticated;

CREATE TRIGGER update_product_groups_updated_at
  BEFORE UPDATE ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER audit_record_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.log_record_change();

-- Existing products: one product per organization and name, keeping the earliest row's spelling, category and unit
INSERT INTO public.product_groups (organization_id, name, category, unit_of_measure, created_by, created_at)
SELECT DISTINCT ON (organization_id, lower(btrim(name)))
       organization_id, btrim(name), category, unit_of_measure, user_id, created_at
FROM public.products_new
ORDER BY organization_id, lower(btrim(name)), created_at, id;

-- ===== 2. 顏色（子）

ALTER TABLE public.products_new ADD COLUMN group_id uuid REFERENCES public.product_groups(id);
ALTER TABLE public.products_new ADD COLUMN color_hex text CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$');

-- Filing existing colors under their product is not an edit of the color: keep it out of the colors' history
ALTER TABLE public.products_new DISABLE TRIGGER audit_record_changes;
UPDATE public.products_new p
SET group_id = g.id
FROM public.product_groups g
WHERE g.organization_id = p.organization_id AND lower(g.name) = lower(btrim(p.name));
ALTER TABLE public.products_new ENABLE TRIGGER audit_record_changes;

ALTER TABLE public.products_new ALTER COLUMN group_id SET NOT NULL;

-- Each layer has its own history: a product's name, category or unit copied onto its colors (by the trigger
-- below) is recorded once, on the product, not again on every color
DROP TRIGGER audit_record_changes ON public.products_new;
CREATE TRIGGER audit_record_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.products_new
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION public.log_record_change();

ALTER TABLE public.products_new DROP CONSTRAINT products_new_name_color_color_code_key;
CREATE UNIQUE INDEX products_new_group_color_key
  ON public.products_new (group_id, lower(btrim(coalesce(color, ''))), lower(btrim(coalesce(color_code, ''))));

-- A color always carries its product's name, category and unit. Writers that predate products (pages and
-- tools not yet using the APIs) give only a name: the color is filed under that product, created if needed.
CREATE FUNCTION public.sync_product_color_with_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_group public.product_groups%ROWTYPE;
BEGIN
  IF NEW.group_id IS NULL THEN
    SELECT * INTO v_group FROM public.product_groups
    WHERE organization_id = NEW.organization_id AND lower(name) = lower(btrim(NEW.name));
    IF NOT FOUND THEN
      INSERT INTO public.product_groups (organization_id, name, category, unit_of_measure, created_by)
      VALUES (NEW.organization_id, btrim(NEW.name), coalesce(NEW.category, '布料'), coalesce(NEW.unit_of_measure, 'KG'), NEW.user_id)
      RETURNING * INTO v_group;
    END IF;
    NEW.group_id := v_group.id;
  ELSE
    SELECT * INTO v_group FROM public.product_groups WHERE id = NEW.group_id;
    IF v_group.organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION '找不到此產品' USING ERRCODE = 'P0002', HINT = 'product_not_found';
    END IF;
  END IF;

  NEW.name := v_group.name;
  NEW.category := v_group.category;
  NEW.unit_of_measure := v_group.unit_of_measure;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_product_color_with_group() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_product_color_with_group
  BEFORE INSERT OR UPDATE ON public.products_new
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_color_with_group();

-- Renaming a product, or changing its category or unit, updates every color of it
CREATE FUNCTION public.sync_product_group_to_colors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.unit_of_measure IS DISTINCT FROM OLD.unit_of_measure THEN
    UPDATE public.products_new
    SET name = NEW.name, category = NEW.category, unit_of_measure = NEW.unit_of_measure
    WHERE group_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_product_group_to_colors() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_product_group_to_colors
  AFTER UPDATE ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_group_to_colors();

-- ===== 3. 產品目錄（前端與 AI 共用的唯讀 view）

CREATE VIEW public.product_catalog WITH (security_invoker = true) AS
SELECT
  g.organization_id,
  g.id AS product_id,
  g.name AS product_name,
  g.category,
  g.unit_of_measure,
  g.is_active AS product_is_active,
  p.id AS color_id,
  p.color,
  p.color_code,
  p.color_hex,
  p.stock_thresholds AS stock_threshold,
  p.status = 'Available' AS color_is_active,
  coalesce(stock.quantity, 0) AS stock_quantity,
  coalesce(stock.rolls, 0) AS stock_rolls,
  p.stock_thresholds IS NOT NULL AND coalesce(stock.quantity, 0) < p.stock_thresholds AS is_low_stock,
  g.created_by AS product_created_by,
  g.created_at AS product_created_at,
  p.user_id AS color_created_by,
  p.created_at AS color_created_at
FROM public.product_groups g
JOIN public.products_new p ON p.group_id = g.id
LEFT JOIN LATERAL (
  SELECT sum(ir.current_quantity) AS quantity, count(*) FILTER (WHERE ir.current_quantity > 0)::int AS rolls
  FROM public.inventory_rolls ir
  WHERE ir.product_id = p.id
) stock ON true;

REVOKE ALL ON public.product_catalog FROM anon, authenticated;
GRANT SELECT ON public.product_catalog TO authenticated;

-- ===== 4. 停用的產品不能再下新訂單（A2 的檢查加上母層狀態）

CREATE OR REPLACE FUNCTION public.api_check_order_products(p_organization_id uuid, p_order_id uuid, p_items jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_line record;
  v_available boolean;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '訂單至少需要一項產品' USING ERRCODE = '22023', HINT = 'items_required';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id uuid, product_id uuid) LOOP
    SELECT p.status IS DISTINCT FROM 'Unavailable' AND g.is_active INTO v_available
    FROM public.products_new p JOIN public.product_groups g ON g.id = p.group_id
    WHERE p.id = v_line.product_id AND p.organization_id = p_organization_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '找不到此產品' USING ERRCODE = 'P0002', HINT = 'product_not_found';
    END IF;
    -- Lines that keep their product may keep one that was disabled since
    IF NOT v_available AND NOT EXISTS (
      SELECT 1 FROM public.order_products
      WHERE order_id = p_order_id AND id = v_line.id AND product_id = v_line.product_id
    ) THEN
      RAISE EXCEPTION '產品「%」已停用', public.api_product_label(v_line.product_id) USING ERRCODE = '22023', HINT = 'product_unavailable';
    END IF;
  END LOOP;
END;
$function$;

-- ===== 5. 產品 API

-- Raise unless a product name is given and not used by another product of the organization
CREATE FUNCTION public.api_check_product_name(p_organization_id uuid, p_name text, p_except_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_name IS NULL THEN
    RAISE EXCEPTION '請輸入產品名稱' USING ERRCODE = '22023', HINT = 'name_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_groups
    WHERE organization_id = p_organization_id AND lower(name) = lower(p_name) AND id IS DISTINCT FROM p_except_id
  ) THEN
    RAISE EXCEPTION '已有同名的產品「%」，請在該產品下新增顏色', p_name USING ERRCODE = '23505', HINT = 'product_name_taken';
  END IF;
END;
$function$;

-- Raise unless a color is valid and not already on the product (p_except_id: the color being edited)
CREATE FUNCTION public.api_check_product_color(
  p_group_id uuid, p_color text, p_color_code text, p_color_hex text, p_stock_threshold numeric, p_except_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_color IS NULL THEN
    RAISE EXCEPTION '請輸入顏色' USING ERRCODE = '22023', HINT = 'color_required';
  END IF;
  IF p_color_hex IS NOT NULL AND p_color_hex !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION '色值格式不正確，請使用 #RRGGBB' USING ERRCODE = '22023', HINT = 'invalid_color_hex';
  END IF;
  IF p_stock_threshold IS NOT NULL AND p_stock_threshold < 0 THEN
    RAISE EXCEPTION '安全庫存不可為負數' USING ERRCODE = '22023', HINT = 'invalid_stock_threshold';
  END IF;
  IF p_group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.products_new
    WHERE group_id = p_group_id AND id IS DISTINCT FROM p_except_id
      AND lower(btrim(coalesce(color, ''))) = lower(p_color)
      AND lower(btrim(coalesce(color_code, ''))) = lower(coalesce(p_color_code, ''))
  ) THEN
    RAISE EXCEPTION '此產品已有顏色「%」', p_color || coalesce('（色號 ' || p_color_code || '）', '')
      USING ERRCODE = '23505', HINT = 'product_color_taken';
  END IF;
END;
$function$;

-- 「顏色（色號 X），安全庫存 N 公斤」 for a color
CREATE FUNCTION public.api_color_label(p_color text, p_color_code text, p_stock_threshold numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT p_color || coalesce('（色號 ' || p_color_code || '）', '')
    || coalesce('，安全庫存 ' || public.api_number(p_stock_threshold) || ' 公斤', '');
$function$;

-- p_colors: [{ color, color_code?, color_hex?, stock_threshold? }]
CREATE FUNCTION public.create_product(
  p_organization_id uuid,
  p_name text,
  p_colors jsonb,
  p_category text DEFAULT '布料',
  p_unit_of_measure text DEFAULT 'KG',
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := public.api_clean(p_name);
  v_category text := coalesce(public.api_clean(p_category), '布料');
  v_unit text := coalesce(public.api_clean(p_unit_of_measure), 'KG');
  v_color record;
  v_group_id uuid;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateProducts');
  PERFORM public.api_check_product_name(p_organization_id, v_name, NULL);
  IF p_colors IS NULL OR jsonb_typeof(p_colors) <> 'array' OR jsonb_array_length(p_colors) = 0 THEN
    RAISE EXCEPTION '產品至少需要一個顏色' USING ERRCODE = '22023', HINT = 'colors_required';
  END IF;

  -- Write for real; a dry run rolls this block back after collecting the summary
  BEGIN
    INSERT INTO public.product_groups (organization_id, name, category, unit_of_measure, created_by)
    VALUES (p_organization_id, v_name, v_category, v_unit, auth.uid())
    RETURNING id INTO v_group_id;

    FOR v_color IN
      SELECT public.api_clean(x->>'color') AS color, public.api_clean(x->>'color_code') AS color_code,
             public.api_clean(x->>'color_hex') AS color_hex, (x->>'stock_threshold')::numeric AS stock_threshold
      FROM jsonb_array_elements(p_colors) WITH ORDINALITY AS c(x, n) ORDER BY n
    LOOP
      PERFORM public.api_check_product_color(v_group_id, v_color.color, v_color.color_code, v_color.color_hex, v_color.stock_threshold, NULL);
      INSERT INTO public.products_new (group_id, organization_id, name, color, color_code, color_hex, stock_thresholds, status, user_id, created_at)
      VALUES (v_group_id, p_organization_id, v_name, v_color.color, v_color.color_code, v_color.color_hex, v_color.stock_threshold,
              'Available', auth.uid(), clock_timestamp());
    END LOOP;

    v_fields := public.api_fields('產品名稱', v_name, '類別', v_category, '單位', v_unit)
      || (SELECT jsonb_agg(jsonb_build_object('label', '顏色 ' || row_number, 'value', label) ORDER BY row_number)
          FROM (SELECT row_number() OVER (ORDER BY created_at, id), public.api_color_label(color, color_code, stock_thresholds) AS label
                FROM public.products_new WHERE group_id = v_group_id) colors);
    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'DRYRN';
    END IF;
  EXCEPTION WHEN SQLSTATE 'DRYRN' THEN
    RETURN public.api_result(true, NULL, NULL, '建立產品', v_fields);
  END;

  RETURN public.api_result(false, v_group_id, NULL, '建立產品', v_fields);
END;
$function$;

-- p_changes may hold name, category, unit_of_measure; the colors follow automatically
CREATE FUNCTION public.update_product(
  p_organization_id uuid,
  p_product_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.product_groups%ROWTYPE;
  v_name text;
  v_category text;
  v_unit text;
  v_fields jsonb;
  v_title text;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditProducts');
  PERFORM public.api_check_change_keys(p_changes, ARRAY['name', 'category', 'unit_of_measure']);

  SELECT * INTO v_old FROM public.product_groups WHERE id = p_product_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此產品' USING ERRCODE = 'P0002', HINT = 'product_not_found';
  END IF;

  v_name := public.api_changed(p_changes, 'name', v_old.name);
  v_category := coalesce(public.api_changed(p_changes, 'category', v_old.category), '布料');
  v_unit := coalesce(public.api_changed(p_changes, 'unit_of_measure', v_old.unit_of_measure), 'KG');
  PERFORM public.api_check_product_name(p_organization_id, v_name, p_product_id);

  v_title := format('修改產品「%s」', v_old.name);
  v_fields := public.api_changed_fields('產品名稱', v_old.name, v_name, '類別', v_old.category, v_category, '單位', v_old.unit_of_measure, v_unit);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_product_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.product_groups SET name = v_name, category = v_category, unit_of_measure = v_unit WHERE id = p_product_id;

  RETURN public.api_result(false, p_product_id, NULL, v_title, v_fields);
END;
$function$;

-- A disabled product keeps its colors on existing documents but none of them can be ordered again
CREATE FUNCTION public.set_product_active(
  p_organization_id uuid,
  p_product_id uuid,
  p_is_active boolean,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.product_groups%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditProducts');
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION '請指定要啟用或停用' USING ERRCODE = '22023', HINT = 'is_active_required';
  END IF;

  SELECT * INTO v_old FROM public.product_groups WHERE id = p_product_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此產品' USING ERRCODE = 'P0002', HINT = 'product_not_found';
  END IF;

  v_title := format('%s產品「%s」', CASE WHEN p_is_active THEN '啟用' ELSE '停用' END, v_old.name);
  v_fields := public.api_changed_fields('狀態',
    CASE WHEN v_old.is_active THEN '啟用' ELSE '停用' END,
    CASE WHEN p_is_active THEN '啟用' ELSE '停用' END);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_product_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.product_groups SET is_active = p_is_active WHERE id = p_product_id AND is_active IS DISTINCT FROM p_is_active;

  RETURN public.api_result(false, p_product_id, NULL, v_title, v_fields);
END;
$function$;

CREATE FUNCTION public.add_product_color(
  p_organization_id uuid,
  p_product_id uuid,
  p_color text,
  p_color_code text DEFAULT NULL,
  p_color_hex text DEFAULT NULL,
  p_stock_threshold numeric DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_group public.product_groups%ROWTYPE;
  v_color text := public.api_clean(p_color);
  v_color_code text := public.api_clean(p_color_code);
  v_color_hex text := public.api_clean(p_color_hex);
  v_id uuid;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateProducts');

  SELECT * INTO v_group FROM public.product_groups WHERE id = p_product_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此產品' USING ERRCODE = 'P0002', HINT = 'product_not_found';
  END IF;
  PERFORM public.api_check_product_color(p_product_id, v_color, v_color_code, v_color_hex, p_stock_threshold, NULL);

  v_title := format('新增顏色到「%s」', v_group.name);
  v_fields := public.api_fields('顏色', v_color, '色號', v_color_code, '色值', v_color_hex,
    '安全庫存', public.api_number(p_stock_threshold) || ' 公斤');
  IF p_dry_run THEN
    RETURN public.api_result(true, NULL, NULL, v_title, v_fields);
  END IF;

  INSERT INTO public.products_new (group_id, organization_id, name, color, color_code, color_hex, stock_thresholds, status, user_id)
  VALUES (p_product_id, p_organization_id, v_group.name, v_color, v_color_code, v_color_hex, p_stock_threshold, 'Available', auth.uid())
  RETURNING id INTO v_id;

  RETURN public.api_result(false, v_id, NULL, v_title, v_fields);
END;
$function$;

-- p_changes may hold color, color_code, color_hex, stock_threshold
CREATE FUNCTION public.update_product_color(
  p_organization_id uuid,
  p_color_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.products_new%ROWTYPE;
  v_color text;
  v_color_code text;
  v_color_hex text;
  v_threshold numeric;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditProducts');
  PERFORM public.api_check_change_keys(p_changes, ARRAY['color', 'color_code', 'color_hex', 'stock_threshold']);

  SELECT * INTO v_old FROM public.products_new WHERE id = p_color_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此顏色' USING ERRCODE = 'P0002', HINT = 'product_color_not_found';
  END IF;

  v_color := public.api_changed(p_changes, 'color', v_old.color);
  v_color_code := public.api_changed(p_changes, 'color_code', v_old.color_code);
  v_color_hex := public.api_changed(p_changes, 'color_hex', v_old.color_hex);
  v_threshold := CASE WHEN p_changes ? 'stock_threshold' THEN (public.api_clean(p_changes->>'stock_threshold'))::numeric ELSE v_old.stock_thresholds END;
  PERFORM public.api_check_product_color(v_old.group_id, v_color, v_color_code, v_color_hex, v_threshold, p_color_id);

  v_title := format('修改顏色「%s」', public.api_product_label(p_color_id));
  v_fields := public.api_changed_fields(
    '顏色', v_old.color, v_color, '色號', v_old.color_code, v_color_code, '色值', v_old.color_hex, v_color_hex,
    '安全庫存', public.api_number(v_old.stock_thresholds) || ' 公斤', public.api_number(v_threshold) || ' 公斤');
  IF p_dry_run THEN
    RETURN public.api_result(true, p_color_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.products_new
  SET color = v_color, color_code = v_color_code, color_hex = v_color_hex, stock_thresholds = v_threshold
  WHERE id = p_color_id;

  RETURN public.api_result(false, p_color_id, NULL, v_title, v_fields);
END;
$function$;

CREATE FUNCTION public.set_product_color_active(
  p_organization_id uuid,
  p_color_id uuid,
  p_is_active boolean,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.products_new%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditProducts');
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION '請指定要啟用或停用' USING ERRCODE = '22023', HINT = 'is_active_required';
  END IF;

  SELECT * INTO v_old FROM public.products_new WHERE id = p_color_id AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此顏色' USING ERRCODE = 'P0002', HINT = 'product_color_not_found';
  END IF;

  v_title := format('%s顏色「%s」', CASE WHEN p_is_active THEN '啟用' ELSE '停用' END, public.api_product_label(p_color_id));
  v_fields := public.api_changed_fields('狀態',
    CASE WHEN v_old.status = 'Unavailable' THEN '停用' ELSE '啟用' END,
    CASE WHEN p_is_active THEN '啟用' ELSE '停用' END);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_color_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.products_new
  SET status = CASE WHEN p_is_active THEN 'Available' ELSE 'Unavailable' END::product_status
  WHERE id = p_color_id AND (status = 'Unavailable') IS DISTINCT FROM NOT p_is_active;

  RETURN public.api_result(false, p_color_id, NULL, v_title, v_fields);
END;
$function$;

REVOKE ALL ON FUNCTION public.api_check_product_name(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_check_product_color(uuid, text, text, text, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_color_label(text, text, numeric) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_product(uuid, text, jsonb, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_product(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_product_active(uuid, uuid, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_product_color(uuid, uuid, text, text, text, numeric, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_product_color(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_product_color_active(uuid, uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product(uuid, text, jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product(uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_active(uuid, uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_product_color(uuid, uuid, text, text, text, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_color(uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_product_color_active(uuid, uuid, boolean, boolean) TO authenticated;
