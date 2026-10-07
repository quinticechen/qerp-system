-- get_organization_member_status() 現在用 user_organizations.accepted_at IS NULL
-- 判斷「邀請中」，但 handle_organization_creation()（使用者自己建立新組織時觸發）
-- 從來沒有把擁有者自己那筆 user_organizations 設定 accepted_at——擁有者不是被
-- 邀請加入的，根本不該有「邀請中」這個狀態，但因為這個函數沒有設定該欄位，
-- 新建立的組織其擁有者永遠卡在「邀請中」，直到有人手動處理。
-- 修正：建立組織當下，擁有者視為立即 accepted。

CREATE OR REPLACE FUNCTION public.handle_organization_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- 創建預設角色
  PERFORM public.create_default_organization_roles(NEW.id);

  -- 將擁有者加入組織；擁有者是自己建立組織，不是被邀請，
  -- 所以 accepted_at 在當下就直接設定，不會卡在「邀請中」狀態
  INSERT INTO public.user_organizations (user_id, organization_id, is_active, accepted_at)
  VALUES (NEW.owner_id, NEW.id, true, now());

  -- 給擁有者分配 owner 角色
  INSERT INTO public.user_organization_roles (user_id, organization_id, role_id, granted_by)
  SELECT NEW.owner_id, NEW.id, r.id, NEW.owner_id
  FROM public.organization_roles r
  WHERE r.organization_id = NEW.id AND r.name = 'owner';

  RETURN NEW;
END;
$function$;

-- 補救目前已經卡在「邀請中」的既有組織擁有者（owner_id = 自己、從未被邀請過）
UPDATE public.user_organizations uo
SET accepted_at = uo.joined_at
FROM public.organizations o
WHERE o.id = uo.organization_id
  AND o.owner_id = uo.user_id
  AND uo.invited_by IS NULL
  AND uo.accepted_at IS NULL;
