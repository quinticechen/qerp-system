
-- 創建採購單與訂單的關聯表，支援一個採購單關聯多個訂單
CREATE TABLE IF NOT EXISTS public.purchase_order_relations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(purchase_order_id, order_id)
);

-- 啟用 RLS
ALTER TABLE public.purchase_order_relations ENABLE ROW LEVEL SECURITY;

-- 創建 RLS 政策
CREATE POLICY "Users can view purchase order relations" 
  ON public.purchase_order_relations 
  FOR SELECT 
  USING (true);

CREATE POLICY "Users can create purchase order relations" 
  ON public.purchase_order_relations 
  FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Users can update purchase order relations" 
  ON public.purchase_order_relations 
  FOR UPDATE 
  USING (true);

CREATE POLICY "Users can delete purchase order relations" 
  ON public.purchase_order_relations 
  FOR DELETE 
  USING (true);
