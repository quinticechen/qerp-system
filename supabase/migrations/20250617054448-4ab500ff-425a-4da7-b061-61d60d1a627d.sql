
-- 為產品添加庫存閾值支持，修復觸發器重複問題

-- 首先檢查 stock_thresholds 表是否已存在，如果不存在則創建
CREATE TABLE IF NOT EXISTS public.stock_thresholds (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES public.products_new(id) ON DELETE CASCADE,
    threshold_quantity numeric NOT NULL CHECK (threshold_quantity >= 0),
    user_id uuid NOT NULL REFERENCES public.profiles(id),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- 創建唯一約束，確保每個產品只能有一個閾值
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_thresholds_product_unique 
ON public.stock_thresholds(product_id);

-- 檢查觸發器是否存在，如果不存在才創建
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.triggers 
        WHERE trigger_name = 'update_stock_thresholds_updated_at' 
        AND event_object_table = 'stock_thresholds'
    ) THEN
        CREATE TRIGGER update_stock_thresholds_updated_at 
            BEFORE UPDATE ON public.stock_thresholds 
            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
    END IF;
END
$$;

-- 檢查並創建 RLS 策略
ALTER TABLE public.stock_thresholds ENABLE ROW LEVEL SECURITY;

-- 刪除現有的策略（如果存在）然後重新創建
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.stock_thresholds;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.stock_thresholds;
DROP POLICY IF EXISTS "Enable update access for authenticated users" ON public.stock_thresholds;
DROP POLICY IF EXISTS "Enable delete access for authenticated users" ON public.stock_thresholds;

-- 創建新的 RLS 策略
CREATE POLICY "Enable read access for authenticated users" ON public.stock_thresholds
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Enable insert access for authenticated users" ON public.stock_thresholds
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update access for authenticated users" ON public.stock_thresholds
    FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Enable delete access for authenticated users" ON public.stock_thresholds
    FOR DELETE USING (auth.role() = 'authenticated');
