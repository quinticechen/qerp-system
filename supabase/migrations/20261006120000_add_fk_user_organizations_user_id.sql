-- 防止未來再出現「user_organizations / user_organization_roles 的 user_id
-- 根本不存在於 auth.users」的幽靈資料（如 lo1、qq、GF 三個組織曾發生過的狀況）。
-- 用 NOT VALID 新增，不去驗證既有資料（其中已知的壞資料已被軟停用：
-- is_active = false），但往後任何新 insert/update 都會被這個約束擋下來。
ALTER TABLE public.user_organizations
  ADD CONSTRAINT user_organizations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.user_organization_roles
  ADD CONSTRAINT user_organization_roles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
  NOT VALID;
