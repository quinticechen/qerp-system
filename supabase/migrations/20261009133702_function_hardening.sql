-- 函式清理與資安建議（docs/DATABASE_TABLES.md §4.2，2026-10-09 使用者確認）
--
-- 1. 刪除沒有任何 policy、觸發器、函式或程式呼叫的函式
-- 2. 固定仍在使用的函式的 search_path（資安建議「Function Search Path Mutable」）
-- 3. 觸發器函式只由觸發器呼叫，撤銷用戶端的 EXECUTE（資安建議「Public Can Execute SECURITY DEFINER Function」）。
--    觸發器觸發時不檢查 EXECUTE 權限，只在 CREATE TRIGGER 時檢查，因此觸發器照常運作。
--    touch_query_session_updated_at 屬於 AI Session，已在 SESSION_COORDINATION.md §6 請對方處理。

-- ===== 1. 刪除沒有使用的函式

DROP FUNCTION public.is_admin(uuid);
DROP FUNCTION public.get_user_organizations(uuid);
DROP FUNCTION public.ensure_user_profile();
DROP FUNCTION public.generate_order_number();

-- ===== 2. 固定 search_path

ALTER FUNCTION public.handle_new_user() SET search_path TO 'public';
ALTER FUNCTION public.set_current_quantity() SET search_path TO 'public';
ALTER FUNCTION public.update_updated_at() SET search_path TO 'public';
ALTER FUNCTION public.update_updated_by() SET search_path TO 'public';

-- ===== 3. 觸發器函式不開放用戶端呼叫

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_organization_creation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_by() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_current_quantity() FROM PUBLIC, anon, authenticated;
