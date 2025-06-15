
-- 為 shippings 表啟用 Row Level Security 並建立政策
ALTER TABLE public.shippings ENABLE ROW LEVEL SECURITY;

-- 創建政策：所有認證用戶可以查看所有出貨記錄
CREATE POLICY "Authenticated users can view all shippings" 
  ON public.shippings 
  FOR SELECT 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以創建出貨記錄
CREATE POLICY "Authenticated users can create shippings" 
  ON public.shippings 
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- 創建政策：認證用戶可以更新出貨記錄
CREATE POLICY "Authenticated users can update shippings" 
  ON public.shippings 
  FOR UPDATE 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以刪除出貨記錄
CREATE POLICY "Authenticated users can delete shippings" 
  ON public.shippings 
  FOR DELETE 
  TO authenticated
  USING (true);

-- 為 shipping_items 表啟用 Row Level Security 並建立政策
ALTER TABLE public.shipping_items ENABLE ROW LEVEL SECURITY;

-- 創建政策：所有認證用戶可以查看所有出貨項目
CREATE POLICY "Authenticated users can view all shipping_items" 
  ON public.shipping_items 
  FOR SELECT 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以創建出貨項目
CREATE POLICY "Authenticated users can create shipping_items" 
  ON public.shipping_items 
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- 創建政策：認證用戶可以更新出貨項目
CREATE POLICY "Authenticated users can update shipping_items" 
  ON public.shipping_items 
  FOR UPDATE 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以刪除出貨項目
CREATE POLICY "Authenticated users can delete shipping_items" 
  ON public.shipping_items 
  FOR DELETE 
  TO authenticated
  USING (true);

-- 為 shipment_history 表啟用 Row Level Security 並建立政策
ALTER TABLE public.shipment_history ENABLE ROW LEVEL SECURITY;

-- 創建政策：所有認證用戶可以查看所有出貨歷史
CREATE POLICY "Authenticated users can view all shipment_history" 
  ON public.shipment_history 
  FOR SELECT 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以創建出貨歷史
CREATE POLICY "Authenticated users can create shipment_history" 
  ON public.shipment_history 
  FOR INSERT 
  TO authenticated
  WITH CHECK (true);

-- 創建政策：認證用戶可以更新出貨歷史
CREATE POLICY "Authenticated users can update shipment_history" 
  ON public.shipment_history 
  FOR UPDATE 
  TO authenticated
  USING (true);

-- 創建政策：認證用戶可以刪除出貨歷史
CREATE POLICY "Authenticated users can delete shipment_history" 
  ON public.shipment_history 
  FOR DELETE 
  TO authenticated
  USING (true);
