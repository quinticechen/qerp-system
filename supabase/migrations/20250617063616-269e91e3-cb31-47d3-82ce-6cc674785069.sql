
-- 修正產品管理相關的數據庫結構，使用正確的枚舉值

-- 1. 確保 products_new 表的 stock_thresholds 欄位存在且可為空
ALTER TABLE public.products_new 
ALTER COLUMN stock_thresholds DROP NOT NULL,
ALTER COLUMN stock_thresholds DROP DEFAULT;

-- 2. 確保產品狀態欄位存在且有正確的預設值
DO $$
BEGIN
    -- 檢查 product_status 類型是否存在
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_status') THEN
        CREATE TYPE product_status AS ENUM ('Available', 'Unavailable');
    END IF;
END $$;

-- 確保 status 欄位存在且有正確設定
ALTER TABLE public.products_new 
ALTER COLUMN status SET DEFAULT 'Available'::product_status;

-- 3. 為了支持分頁和搜尋功能，創建必要的索引
CREATE INDEX IF NOT EXISTS idx_products_new_name ON public.products_new(name);
CREATE INDEX IF NOT EXISTS idx_products_new_category ON public.products_new(category);
CREATE INDEX IF NOT EXISTS idx_products_new_color ON public.products_new(color);
CREATE INDEX IF NOT EXISTS idx_products_new_status ON public.products_new(status);
CREATE INDEX IF NOT EXISTS idx_products_new_created_at ON public.products_new(created_at);

-- 4. 為庫存統計視圖添加待入庫和待出貨資訊的索引
CREATE INDEX IF NOT EXISTS idx_inventory_rolls_product_id ON public.inventory_rolls(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_rolls_quality ON public.inventory_rolls(quality);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product_id ON public.purchase_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_products_product_id ON public.order_products(product_id);

-- 5. 創建或更新庫存統計視圖以包含待入庫和待出貨資訊（使用正確的枚舉值）
DROP VIEW IF EXISTS public.inventory_summary_enhanced;

CREATE VIEW public.inventory_summary_enhanced AS
WITH inventory_stats AS (
  SELECT 
    ir.product_id,
    p.name as product_name,
    p.color,
    p.color_code,
    p.stock_thresholds,
    p.status as product_status,
    SUM(ir.current_quantity) as total_stock,
    COUNT(ir.id) as total_rolls,
    SUM(CASE WHEN ir.quality = 'A' THEN ir.current_quantity ELSE 0 END) as a_grade_stock,
    SUM(CASE WHEN ir.quality = 'B' THEN ir.current_quantity ELSE 0 END) as b_grade_stock,
    SUM(CASE WHEN ir.quality = 'C' THEN ir.current_quantity ELSE 0 END) as c_grade_stock,
    SUM(CASE WHEN ir.quality = 'D' THEN ir.current_quantity ELSE 0 END) as d_grade_stock,
    SUM(CASE WHEN ir.quality = 'defective' THEN ir.current_quantity ELSE 0 END) as defective_stock,
    COUNT(CASE WHEN ir.quality = 'A' THEN 1 END) as a_grade_rolls,
    COUNT(CASE WHEN ir.quality = 'B' THEN 1 END) as b_grade_rolls,
    COUNT(CASE WHEN ir.quality = 'C' THEN 1 END) as c_grade_rolls,
    COUNT(CASE WHEN ir.quality = 'D' THEN 1 END) as d_grade_rolls,
    COUNT(CASE WHEN ir.quality = 'defective' THEN 1 END) as defective_rolls,
    -- 詳細的卷布資訊用於 hover 顯示
    array_agg(
      CASE WHEN ir.quality = 'A' THEN ir.current_quantity::text END
      ORDER BY ir.current_quantity
    ) FILTER (WHERE ir.quality = 'A') as a_grade_details,
    array_agg(
      CASE WHEN ir.quality = 'B' THEN ir.current_quantity::text END
      ORDER BY ir.current_quantity
    ) FILTER (WHERE ir.quality = 'B') as b_grade_details,
    array_agg(
      CASE WHEN ir.quality = 'C' THEN ir.current_quantity::text END
      ORDER BY ir.current_quantity
    ) FILTER (WHERE ir.quality = 'C') as c_grade_details,
    array_agg(
      CASE WHEN ir.quality = 'D' THEN ir.current_quantity::text END
      ORDER BY ir.current_quantity
    ) FILTER (WHERE ir.quality = 'D') as d_grade_details,
    array_agg(
      CASE WHEN ir.quality = 'defective' THEN ir.current_quantity::text END
      ORDER BY ir.current_quantity
    ) FILTER (WHERE ir.quality = 'defective') as defective_details
  FROM inventory_rolls ir
  JOIN products_new p ON ir.product_id = p.id
  WHERE ir.current_quantity > 0
  GROUP BY ir.product_id, p.name, p.color, p.color_code, p.stock_thresholds, p.status
),
pending_inventory AS (
  SELECT 
    poi.product_id,
    SUM(poi.ordered_quantity - COALESCE(poi.received_quantity, 0)) as pending_in_quantity
  FROM purchase_order_items poi
  JOIN purchase_orders po ON poi.purchase_order_id = po.id
  WHERE po.status IN ('pending', 'partial_received')
  GROUP BY poi.product_id
),
pending_shipping AS (
  SELECT 
    op.product_id,
    SUM(op.quantity - COALESCE(op.shipped_quantity, 0)) as pending_out_quantity
  FROM order_products op
  JOIN orders o ON op.order_id = o.id
  WHERE o.shipping_status IN ('not_started', 'partial_shipped')
  GROUP BY op.product_id
)
SELECT 
  COALESCE(inv.product_id, pi.product_id, ps.product_id) as product_id,
  COALESCE(inv.product_name, p2.name) as product_name,
  COALESCE(inv.color, p2.color) as color,
  COALESCE(inv.color_code, p2.color_code) as color_code,
  COALESCE(inv.stock_thresholds, p2.stock_thresholds) as stock_thresholds,
  COALESCE(inv.product_status, p2.status) as product_status,
  COALESCE(inv.total_stock, 0) as total_stock,
  COALESCE(inv.total_rolls, 0) as total_rolls,
  COALESCE(inv.a_grade_stock, 0) as a_grade_stock,
  COALESCE(inv.b_grade_stock, 0) as b_grade_stock,
  COALESCE(inv.c_grade_stock, 0) as c_grade_stock,
  COALESCE(inv.d_grade_stock, 0) as d_grade_stock,
  COALESCE(inv.defective_stock, 0) as defective_stock,
  COALESCE(inv.a_grade_rolls, 0) as a_grade_rolls,
  COALESCE(inv.b_grade_rolls, 0) as b_grade_rolls,
  COALESCE(inv.c_grade_rolls, 0) as c_grade_rolls,
  COALESCE(inv.d_grade_rolls, 0) as d_grade_rolls,
  COALESCE(inv.defective_rolls, 0) as defective_rolls,
  inv.a_grade_details,
  inv.b_grade_details,
  inv.c_grade_details,
  inv.d_grade_details,
  inv.defective_details,
  COALESCE(pi.pending_in_quantity, 0) as pending_in_quantity,
  COALESCE(ps.pending_out_quantity, 0) as pending_out_quantity
FROM inventory_stats inv
FULL OUTER JOIN pending_inventory pi ON inv.product_id = pi.product_id
FULL OUTER JOIN pending_shipping ps ON COALESCE(inv.product_id, pi.product_id) = ps.product_id
LEFT JOIN products_new p2 ON COALESCE(inv.product_id, pi.product_id, ps.product_id) = p2.id;
