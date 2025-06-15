
-- 為 products_new 表啟用 Row Level Security
ALTER TABLE public.products_new ENABLE ROW LEVEL SECURITY;

-- 創建政策：用戶可以查看自己創建的產品
CREATE POLICY "Users can view their own products" 
  ON public.products_new 
  FOR SELECT 
  USING (auth.uid() = user_id);

-- 創建政策：用戶可以創建自己的產品
CREATE POLICY "Users can create their own products" 
  ON public.products_new 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- 創建政策：用戶可以更新自己的產品
CREATE POLICY "Users can update their own products" 
  ON public.products_new 
  FOR UPDATE 
  USING (auth.uid() = user_id);

-- 創建政策：用戶可以刪除自己的產品
CREATE POLICY "Users can delete their own products" 
  ON public.products_new 
  FOR DELETE 
  USING (auth.uid() = user_id);
