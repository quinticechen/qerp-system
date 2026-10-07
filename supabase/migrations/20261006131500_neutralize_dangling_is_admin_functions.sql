-- 緊急修復：使用者手動在 Studio 跑完 user_roles / users_with_roles 的刪除後，
-- profiles 與 user_operation_logs 上還留著 5 條會呼叫 is_admin()/has_role() 的
-- policy，而這兩個函式查詢的 public.user_roles 已經不存在，導致這兩張表的
-- 每一次存取（幾乎等於整個系統的使用者相關功能）都直接報錯：
--   ERROR: relation "public.user_roles" does not exist
-- 用 CREATE OR REPLACE 把這兩個函式改成固定回傳 false 先恢復正常運作
-- （user_roles 從未被任何程式真正寫入過，這個全域 admin 後門本來就形同虛設）。
-- 剩下那 5 條 policy 已經不會再噴錯，可以之後再找時間清掉，詳見
-- 20261006130000_drop_legacy_user_roles_system.sql。
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT false;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.user_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT false;
$$;
