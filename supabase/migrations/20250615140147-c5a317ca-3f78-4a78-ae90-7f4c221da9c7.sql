
-- 為 customers 表啟用 Row Level Security
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- 創建政策：所有認證用戶可以查看所有客戶
CREATE POLICY "Authenticated users can view all customers" 
  ON public.customers 
  FOR SELECT 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以創建客戶
CREATE POLICY "Authenticated users can create customers" 
  ON public.customers 
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- 創建政策：認證用戶可以更新客戶
CREATE POLICY "Authenticated users can update customers" 
  ON public.customers 
  FOR UPDATE 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以刪除客戶
CREATE POLICY "Authenticated users can delete customers" 
  ON public.customers 
  FOR DELETE 
  TO authenticated
  USING (true);

-- 為 factories 表啟用 Row Level Security
ALTER TABLE public.factories ENABLE ROW LEVEL SECURITY;

-- 創建政策：所有認證用戶可以查看所有工廠
CREATE POLICY "Authenticated users can view all factories" 
  ON public.factories 
  FOR SELECT 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以創建工廠
CREATE POLICY "Authenticated users can create factories" 
  ON public.factories 
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- 創建政策：認證用戶可以更新工廠
CREATE POLICY "Authenticated users can update factories" 
  ON public.factories 
  FOR UPDATE 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以刪除工廠
CREATE POLICY "Authenticated users can delete factories" 
  ON public.factories 
  FOR DELETE 
  TO authenticated
  USING (true);

-- 更新 products_new 表的政策，允許所有認證用戶查看所有產品
DROP POLICY IF EXISTS "Users can view their own products" ON public.products_new;
CREATE POLICY "Authenticated users can view all products" 
  ON public.products_new 
  FOR SELECT 
  TO authenticated
  USING (true);

-- 更新產品的更新政策，允許所有認證用戶更新產品
DROP POLICY IF EXISTS "Users can update their own products" ON public.products_new;
CREATE POLICY "Authenticated users can update products" 
  ON public.products_new 
  FOR UPDATE 
  TO authenticated
  USING (true);

-- 更新產品的刪除政策，允許所有認證用戶刪除產品
DROP POLICY IF EXISTS "Users can delete their own products" ON public.products_new;
CREATE POLICY "Authenticated users can delete products" 
  ON public.products_new 
  FOR DELETE 
  TO authenticated
  USING (true);

-- 為產品表新增 updated_by 欄位來追蹤修改者
ALTER TABLE public.products_new ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

-- 建立觸發器函數來自動更新 updated_by 欄位
CREATE OR REPLACE FUNCTION update_updated_by()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_by = auth.uid();
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 為產品表建立觸發器
DROP TRIGGER IF EXISTS set_updated_by ON public.products_new;
CREATE TRIGGER set_updated_by
  BEFORE UPDATE ON public.products_new
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_by();
