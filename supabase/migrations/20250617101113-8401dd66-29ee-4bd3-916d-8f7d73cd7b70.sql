
-- 修復組織表的 RLS 政策
-- 當前的政策阻止了用戶創建組織，需要修正

-- 刪除舊的創建政策
DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;

-- 創建新的插入政策，允許認證用戶創建組織（設置 owner_id 為自己）
CREATE POLICY "Users can create organizations as owner"
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- 確保觸發器正常工作，檢查是否存在
-- 如果觸發器不存在，重新創建
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'trigger_organization_creation'
  ) THEN
    CREATE TRIGGER trigger_organization_creation
      AFTER INSERT ON public.organizations
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_organization_creation();
  END IF;
END $$;
