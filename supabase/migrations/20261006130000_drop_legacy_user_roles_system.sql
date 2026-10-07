-- 狀態更新：user_roles / users_with_roles 已由使用者在 Supabase Studio 手動刪除。
-- 但這導致 profiles / user_operation_logs 上殘留的 5 條 policy（會呼叫
-- is_admin()/has_role()）全部報錯，因為它們查詢的 user_roles 已經不存在——
-- 緊急用 20261006131500_neutralize_dangling_is_admin_functions.sql
-- 把這兩個函式改成固定回傳 false 先恢復運作。
--
-- 這個檔案剩下的，是「非緊急」的最後清理：把這 5 條已經形同虛設（永遠回傳
-- false，不會再出錯，只是邏輯上是死的）的 policy 一併移除，讓 schema 乾淨。
-- 可以隨時執行，不影響任何現有功能。

drop policy if exists "Admin can view operation logs" on public.user_operation_logs;
drop policy if exists "Admins can delete profiles" on public.profiles;
drop policy if exists "Admins can insert profiles" on public.profiles;
drop policy if exists "Admins can update all profiles" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;
drop function if exists public.is_admin(uuid);
drop function if exists public.has_role(uuid, public.user_role);
