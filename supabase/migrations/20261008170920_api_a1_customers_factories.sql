-- 業務 API A0 共用基礎＋A1 客戶與工廠（docs/BUSINESS_API.md §2、§3）
--
-- A0：所有業務 API 共用的權限檢查、文字整理、回傳格式（試算結果與 AI 確認卡片相同的 { title, fields }）。
-- A1：create／update／set_active 客戶與工廠。客戶、工廠新增 is_active（停用取代刪除，R5）。
-- 錯誤一律為「中文訊息＋SQLSTATE 類別＋HINT 代碼」（§2.3）。

-- ===== A0 共用基礎（只在 API 內部使用，不開放直接呼叫）

-- Raise unless the caller is signed in and holds the permission in the organization
CREATE FUNCTION public.api_require_permission(p_organization_id uuid, p_permission text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '請先登入' USING ERRCODE = '42501', HINT = 'not_signed_in';
  END IF;
  IF p_organization_id IS NULL OR NOT public.user_has_organization_permission(auth.uid(), p_organization_id, p_permission) THEN
    RAISE EXCEPTION '您的角色沒有權限執行此操作' USING ERRCODE = '42501', HINT = 'forbidden';
  END IF;
END;
$function$;

-- Trimmed text, or null when empty
CREATE FUNCTION public.api_clean(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT nullif(btrim(p_value), '');
$function$;

-- Card fields from alternating label/value arguments, skipping empty values
CREATE FUNCTION public.api_fields(VARIADIC p_pairs text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object('label', p_pairs[i], 'value', p_pairs[i + 1]) ORDER BY i), '[]'::jsonb)
  FROM generate_subscripts(p_pairs, 1) AS i
  WHERE i % 2 = 1 AND public.api_clean(p_pairs[i + 1]) IS NOT NULL;
$function$;

-- Card fields for changed values only, from label/old/new triples, shown as「舊值 → 新值」
CREATE FUNCTION public.api_changed_fields(VARIADIC p_triples text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'label', p_triples[i],
           'value', coalesce(public.api_clean(p_triples[i + 1]), '（空白）') || ' → ' || coalesce(public.api_clean(p_triples[i + 2]), '（空白）')
         ) ORDER BY i), '[]'::jsonb)
  FROM generate_subscripts(p_triples, 1) AS i
  WHERE i % 3 = 1 AND public.api_clean(p_triples[i + 1]) IS DISTINCT FROM public.api_clean(p_triples[i + 2]);
$function$;

-- The common write-API result: { dry_run, id, number, summary: { title, fields } }
CREATE FUNCTION public.api_result(p_dry_run boolean, p_id uuid, p_number text, p_title text, p_fields jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'dry_run', p_dry_run,
    'id', p_id,
    'number', p_number,
    'summary', jsonb_build_object('title', p_title, 'fields', coalesce(p_fields, '[]'::jsonb))
  );
$function$;

-- Raise unless every key of p_changes is one the API lets callers change
CREATE FUNCTION public.api_check_change_keys(p_changes jsonb, p_allowed text[])
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_unknown text;
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION '修改內容格式不正確' USING ERRCODE = '22023', HINT = 'invalid_changes';
  END IF;
  SELECT string_agg(k, '、') INTO v_unknown FROM jsonb_object_keys(p_changes) AS k WHERE k <> ALL (p_allowed);
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION '不支援修改的欄位：%', v_unknown USING ERRCODE = '22023', HINT = 'unknown_field';
  END IF;
END;
$function$;

-- The new value of a field: the change when the key is present (empty clears it), otherwise the current value
CREATE FUNCTION public.api_changed(p_changes jsonb, p_key text, p_current text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE WHEN p_changes ? p_key THEN public.api_clean(p_changes->>p_key) ELSE p_current END;
$function$;

-- Shared rules for customers and factories (p_entity is 客戶 or 工廠)
CREATE FUNCTION public.api_validate_contact(
  p_entity text, p_name text, p_contact_person text, p_phone text, p_landline_phone text, p_email text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
  IF p_name IS NULL THEN
    RAISE EXCEPTION '請輸入%名稱', p_entity USING ERRCODE = '22023', HINT = 'name_required';
  END IF;
  IF p_contact_person IS NULL THEN
    RAISE EXCEPTION '請輸入聯絡人' USING ERRCODE = '22023', HINT = 'contact_person_required';
  END IF;
  IF p_phone IS NULL AND p_landline_phone IS NULL THEN
    RAISE EXCEPTION '手機或市話至少填一個' USING ERRCODE = '22023', HINT = 'phone_required';
  END IF;
  IF p_email IS NOT NULL AND p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION '電子郵件格式不正確' USING ERRCODE = '22023', HINT = 'invalid_email';
  END IF;
END;
$function$;

-- Card fields describing a customer or factory
CREATE FUNCTION public.api_contact_fields(
  p_name text, p_contact_person text, p_phone text, p_landline_phone text,
  p_fax text, p_email text, p_address text, p_note text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT public.api_fields(
    '名稱', p_name, '聯絡人', p_contact_person, '手機', p_phone, '市話', p_landline_phone,
    '傳真', p_fax, '電子郵件', p_email, '地址', p_address, '備註', p_note
  );
$function$;

REVOKE ALL ON FUNCTION public.api_require_permission(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_clean(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_fields(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_changed_fields(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_result(boolean, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_check_change_keys(jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_changed(jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_validate_contact(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_contact_fields(text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ===== A1 停用取代刪除

ALTER TABLE public.customers ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.factories ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- ===== A1 客戶

CREATE FUNCTION public.create_customer(
  p_organization_id uuid,
  p_name text,
  p_contact_person text,
  p_phone text DEFAULT NULL,
  p_landline_phone text DEFAULT NULL,
  p_fax text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := public.api_clean(p_name);
  v_contact_person text := public.api_clean(p_contact_person);
  v_phone text := public.api_clean(p_phone);
  v_landline_phone text := public.api_clean(p_landline_phone);
  v_fax text := public.api_clean(p_fax);
  v_email text := public.api_clean(p_email);
  v_address text := public.api_clean(p_address);
  v_note text := public.api_clean(p_note);
  v_fields jsonb;
  v_id uuid;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateCustomers');
  PERFORM public.api_validate_contact('客戶', v_name, v_contact_person, v_phone, v_landline_phone, v_email);

  IF EXISTS (
    SELECT 1 FROM public.customers
    WHERE organization_id = p_organization_id AND lower(btrim(name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION '已有同名的客戶「%」', v_name USING ERRCODE = '23505', HINT = 'customer_name_taken';
  END IF;

  v_fields := public.api_contact_fields(v_name, v_contact_person, v_phone, v_landline_phone, v_fax, v_email, v_address, v_note);
  IF p_dry_run THEN
    RETURN public.api_result(true, NULL, NULL, '建立客戶', v_fields);
  END IF;

  INSERT INTO public.customers (organization_id, name, contact_person, phone, landline_phone, fax, email, address, note)
  VALUES (p_organization_id, v_name, v_contact_person, v_phone, v_landline_phone, v_fax, v_email, v_address, v_note)
  RETURNING id INTO v_id;

  RETURN public.api_result(false, v_id, NULL, '建立客戶', v_fields);
END;
$function$;

-- p_changes may hold name, contact_person, phone, landline_phone, fax, email, address, note
CREATE FUNCTION public.update_customer(
  p_organization_id uuid,
  p_customer_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.customers%ROWTYPE;
  v_name text;
  v_contact_person text;
  v_phone text;
  v_landline_phone text;
  v_fax text;
  v_email text;
  v_address text;
  v_note text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditCustomers');
  PERFORM public.api_check_change_keys(p_changes,
    ARRAY['name', 'contact_person', 'phone', 'landline_phone', 'fax', 'email', 'address', 'note']);

  SELECT * INTO v_old FROM public.customers
  WHERE id = p_customer_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此客戶' USING ERRCODE = 'P0002', HINT = 'customer_not_found';
  END IF;

  v_name := public.api_changed(p_changes, 'name', v_old.name);
  v_contact_person := public.api_changed(p_changes, 'contact_person', v_old.contact_person);
  v_phone := public.api_changed(p_changes, 'phone', v_old.phone);
  v_landline_phone := public.api_changed(p_changes, 'landline_phone', v_old.landline_phone);
  v_fax := public.api_changed(p_changes, 'fax', v_old.fax);
  v_email := public.api_changed(p_changes, 'email', v_old.email);
  v_address := public.api_changed(p_changes, 'address', v_old.address);
  v_note := public.api_changed(p_changes, 'note', v_old.note);

  PERFORM public.api_validate_contact('客戶', v_name, v_contact_person, v_phone, v_landline_phone, v_email);

  IF EXISTS (
    SELECT 1 FROM public.customers
    WHERE organization_id = p_organization_id AND id <> p_customer_id AND lower(btrim(name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION '已有同名的客戶「%」', v_name USING ERRCODE = '23505', HINT = 'customer_name_taken';
  END IF;

  v_fields := public.api_changed_fields(
    '名稱', v_old.name, v_name, '聯絡人', v_old.contact_person, v_contact_person,
    '手機', v_old.phone, v_phone, '市話', v_old.landline_phone, v_landline_phone,
    '傳真', v_old.fax, v_fax, '電子郵件', v_old.email, v_email,
    '地址', v_old.address, v_address, '備註', v_old.note, v_note
  );
  IF p_dry_run THEN
    RETURN public.api_result(true, p_customer_id, NULL, format('修改客戶「%s」', v_old.name), v_fields);
  END IF;

  UPDATE public.customers
  SET name = v_name, contact_person = v_contact_person, phone = v_phone, landline_phone = v_landline_phone,
      fax = v_fax, email = v_email, address = v_address, note = v_note
  WHERE id = p_customer_id;

  RETURN public.api_result(false, p_customer_id, NULL, format('修改客戶「%s」', v_old.name), v_fields);
END;
$function$;

-- Disabled customers stay on existing documents but are left out of pickers for new ones
CREATE FUNCTION public.set_customer_active(
  p_organization_id uuid,
  p_customer_id uuid,
  p_is_active boolean,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.customers%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditCustomers');
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION '請指定要啟用或停用' USING ERRCODE = '22023', HINT = 'is_active_required';
  END IF;

  SELECT * INTO v_old FROM public.customers
  WHERE id = p_customer_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此客戶' USING ERRCODE = 'P0002', HINT = 'customer_not_found';
  END IF;

  v_title := format('%s客戶「%s」', CASE WHEN p_is_active THEN '啟用' ELSE '停用' END, v_old.name);
  v_fields := public.api_changed_fields('狀態',
    CASE WHEN v_old.is_active THEN '啟用' ELSE '停用' END,
    CASE WHEN p_is_active THEN '啟用' ELSE '停用' END);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_customer_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.customers SET is_active = p_is_active WHERE id = p_customer_id AND is_active IS DISTINCT FROM p_is_active;

  RETURN public.api_result(false, p_customer_id, NULL, v_title, v_fields);
END;
$function$;

-- ===== A1 工廠（規則與客戶相同）

CREATE FUNCTION public.create_factory(
  p_organization_id uuid,
  p_name text,
  p_contact_person text,
  p_phone text DEFAULT NULL,
  p_landline_phone text DEFAULT NULL,
  p_fax text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := public.api_clean(p_name);
  v_contact_person text := public.api_clean(p_contact_person);
  v_phone text := public.api_clean(p_phone);
  v_landline_phone text := public.api_clean(p_landline_phone);
  v_fax text := public.api_clean(p_fax);
  v_email text := public.api_clean(p_email);
  v_address text := public.api_clean(p_address);
  v_note text := public.api_clean(p_note);
  v_fields jsonb;
  v_id uuid;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canCreateFactories');
  PERFORM public.api_validate_contact('工廠', v_name, v_contact_person, v_phone, v_landline_phone, v_email);

  IF EXISTS (
    SELECT 1 FROM public.factories
    WHERE organization_id = p_organization_id AND lower(btrim(name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION '已有同名的工廠「%」', v_name USING ERRCODE = '23505', HINT = 'factory_name_taken';
  END IF;

  v_fields := public.api_contact_fields(v_name, v_contact_person, v_phone, v_landline_phone, v_fax, v_email, v_address, v_note);
  IF p_dry_run THEN
    RETURN public.api_result(true, NULL, NULL, '建立工廠', v_fields);
  END IF;

  INSERT INTO public.factories (organization_id, name, contact_person, phone, landline_phone, fax, email, address, note)
  VALUES (p_organization_id, v_name, v_contact_person, v_phone, v_landline_phone, v_fax, v_email, v_address, v_note)
  RETURNING id INTO v_id;

  RETURN public.api_result(false, v_id, NULL, '建立工廠', v_fields);
END;
$function$;

CREATE FUNCTION public.update_factory(
  p_organization_id uuid,
  p_factory_id uuid,
  p_changes jsonb,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.factories%ROWTYPE;
  v_name text;
  v_contact_person text;
  v_phone text;
  v_landline_phone text;
  v_fax text;
  v_email text;
  v_address text;
  v_note text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditFactories');
  PERFORM public.api_check_change_keys(p_changes,
    ARRAY['name', 'contact_person', 'phone', 'landline_phone', 'fax', 'email', 'address', 'note']);

  SELECT * INTO v_old FROM public.factories
  WHERE id = p_factory_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此工廠' USING ERRCODE = 'P0002', HINT = 'factory_not_found';
  END IF;

  v_name := public.api_changed(p_changes, 'name', v_old.name);
  v_contact_person := public.api_changed(p_changes, 'contact_person', v_old.contact_person);
  v_phone := public.api_changed(p_changes, 'phone', v_old.phone);
  v_landline_phone := public.api_changed(p_changes, 'landline_phone', v_old.landline_phone);
  v_fax := public.api_changed(p_changes, 'fax', v_old.fax);
  v_email := public.api_changed(p_changes, 'email', v_old.email);
  v_address := public.api_changed(p_changes, 'address', v_old.address);
  v_note := public.api_changed(p_changes, 'note', v_old.note);

  PERFORM public.api_validate_contact('工廠', v_name, v_contact_person, v_phone, v_landline_phone, v_email);

  IF EXISTS (
    SELECT 1 FROM public.factories
    WHERE organization_id = p_organization_id AND id <> p_factory_id AND lower(btrim(name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION '已有同名的工廠「%」', v_name USING ERRCODE = '23505', HINT = 'factory_name_taken';
  END IF;

  v_fields := public.api_changed_fields(
    '名稱', v_old.name, v_name, '聯絡人', v_old.contact_person, v_contact_person,
    '手機', v_old.phone, v_phone, '市話', v_old.landline_phone, v_landline_phone,
    '傳真', v_old.fax, v_fax, '電子郵件', v_old.email, v_email,
    '地址', v_old.address, v_address, '備註', v_old.note, v_note
  );
  IF p_dry_run THEN
    RETURN public.api_result(true, p_factory_id, NULL, format('修改工廠「%s」', v_old.name), v_fields);
  END IF;

  UPDATE public.factories
  SET name = v_name, contact_person = v_contact_person, phone = v_phone, landline_phone = v_landline_phone,
      fax = v_fax, email = v_email, address = v_address, note = v_note
  WHERE id = p_factory_id;

  RETURN public.api_result(false, p_factory_id, NULL, format('修改工廠「%s」', v_old.name), v_fields);
END;
$function$;

CREATE FUNCTION public.set_factory_active(
  p_organization_id uuid,
  p_factory_id uuid,
  p_is_active boolean,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.factories%ROWTYPE;
  v_title text;
  v_fields jsonb;
BEGIN
  PERFORM public.api_require_permission(p_organization_id, 'canEditFactories');
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION '請指定要啟用或停用' USING ERRCODE = '22023', HINT = 'is_active_required';
  END IF;

  SELECT * INTO v_old FROM public.factories
  WHERE id = p_factory_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到此工廠' USING ERRCODE = 'P0002', HINT = 'factory_not_found';
  END IF;

  v_title := format('%s工廠「%s」', CASE WHEN p_is_active THEN '啟用' ELSE '停用' END, v_old.name);
  v_fields := public.api_changed_fields('狀態',
    CASE WHEN v_old.is_active THEN '啟用' ELSE '停用' END,
    CASE WHEN p_is_active THEN '啟用' ELSE '停用' END);
  IF p_dry_run THEN
    RETURN public.api_result(true, p_factory_id, NULL, v_title, v_fields);
  END IF;

  UPDATE public.factories SET is_active = p_is_active WHERE id = p_factory_id AND is_active IS DISTINCT FROM p_is_active;

  RETURN public.api_result(false, p_factory_id, NULL, v_title, v_fields);
END;
$function$;

-- ===== 開放給登入使用者

REVOKE ALL ON FUNCTION public.create_customer(uuid, text, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_customer(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_customer_active(uuid, uuid, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_factory(uuid, text, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_factory(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_factory_active(uuid, uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer(uuid, text, text, text, text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_customer(uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_active(uuid, uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_factory(uuid, text, text, text, text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_factory(uuid, uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_factory_active(uuid, uuid, boolean, boolean) TO authenticated;
