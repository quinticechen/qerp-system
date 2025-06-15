
-- 為 inventories 表啟用 Row Level Security 並建立政策
ALTER TABLE public.inventories ENABLE ROW LEVEL SECURITY;

-- 創建政策：所有認證用戶可以查看所有入庫記錄
CREATE POLICY "Authenticated users can view all inventories" 
  ON public.inventories 
  FOR SELECT 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以創建入庫記錄
CREATE POLICY "Authenticated users can create inventories" 
  ON public.inventories 
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- 創建政策：認證用戶可以更新入庫記錄
CREATE POLICY "Authenticated users can update inventories" 
  ON public.inventories 
  FOR UPDATE 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以刪除入庫記錄
CREATE POLICY "Authenticated users can delete inventories" 
  ON public.inventories 
  FOR DELETE 
  TO authenticated
  USING (true);

-- 為 inventory_rolls 表啟用 Row Level Security 並建立政策
ALTER TABLE public.inventory_rolls ENABLE ROW LEVEL SECURITY;

-- 創建政策：所有認證用戶可以查看所有庫存卷料
CREATE POLICY "Authenticated users can view all inventory_rolls" 
  ON public.inventory_rolls 
  FOR SELECT 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以創建庫存卷料
CREATE POLICY "Authenticated users can create inventory_rolls" 
  ON public.inventory_rolls 
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- 創建政策：認證用戶可以更新庫存卷料
CREATE POLICY "Authenticated users can update inventory_rolls" 
  ON public.inventory_rolls 
  FOR UPDATE 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以刪除庫存卷料
CREATE POLICY "Authenticated users can delete inventory_rolls" 
  ON public.inventory_rolls 
  FOR DELETE 
  TO authenticated
  USING (true);

-- 為 warehouses 表啟用 Row Level Security 並建立政策（如果還沒有的話）
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

-- 創建政策：所有認證用戶可以查看所有倉庫
CREATE POLICY "Authenticated users can view all warehouses" 
  ON public.warehouses 
  FOR SELECT 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以創建倉庫
CREATE POLICY "Authenticated users can create warehouses" 
  ON public.warehouses 
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- 創建政策：認證用戶可以更新倉庫
CREATE POLICY "Authenticated users can update warehouses" 
  ON public.warehouses 
  FOR UPDATE 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以刪除倉庫
CREATE POLICY "Authenticated users can delete warehouses" 
  ON public.warehouses 
  FOR DELETE 
  TO authenticated
  USING (true);
