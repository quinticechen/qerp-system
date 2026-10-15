-- 註冊時把電話一起寫進用戶資料（2026-10-09）
--
-- 邀請新用戶時，前端以 signUp 的 metadata 帶入姓名與電話；handle_new_user 原本只寫姓名，
-- complete_user_invitation 之後再補電話，編輯紀錄因此多出一筆「修改用戶資料」。
-- 改為建立用戶資料時就寫入電話，complete_user_invitation 的更新沒有變化，不會再留下紀錄。

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NULLIF(btrim(NEW.raw_user_meta_data->>'phone'), ''),
    true
  );
  RETURN NEW;
END;
$function$;
