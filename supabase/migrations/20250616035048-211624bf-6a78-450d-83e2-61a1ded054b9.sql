
-- 創建新的訂單編號序列（按天重置）
CREATE SEQUENCE IF NOT EXISTS order_daily_seq;

-- 創建函數來生成新的訂單編號格式
CREATE OR REPLACE FUNCTION generate_new_order_number()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  current_date_str TEXT;
  seq_num INTEGER;
  formatted_seq TEXT;
BEGIN
  -- 格式：年份K月份日期-流水號
  current_date_str := TO_CHAR(NOW(), 'YYK"MM"DD');
  
  -- 獲取當日序列號
  seq_num := nextval('order_daily_seq');
  
  -- 格式化序列號為3位數
  formatted_seq := LPAD(seq_num::TEXT, 3, '0');
  
  -- 生成最終訂單編號
  NEW.order_number := current_date_str || '-' || formatted_seq;
  
  RETURN NEW;
END;
$function$;

-- 刪除舊的觸發器（如果存在）
DROP TRIGGER IF EXISTS generate_order_number_trigger ON orders;

-- 創建新的觸發器
CREATE TRIGGER generate_new_order_number_trigger
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION generate_new_order_number();

-- 更新訂單狀態枚舉，添加新狀態
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'factory_ordered';

-- 重新排序狀態（PostgreSQL不支持直接重排，需要重建）
-- 先創建新的枚舉類型
DO $$ 
BEGIN
  -- 檢查新類型是否已存在
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'new_order_status') THEN
    CREATE TYPE new_order_status AS ENUM ('pending', 'confirmed', 'factory_ordered', 'completed', 'cancelled');
  END IF;
END $$;

-- 更新orders表使用新的枚舉類型
ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;
ALTER TABLE orders ALTER COLUMN status TYPE new_order_status USING status::text::new_order_status;
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending'::new_order_status;

-- 刪除舊的枚舉類型並重命名新的
DROP TYPE IF EXISTS order_status CASCADE;
ALTER TYPE new_order_status RENAME TO order_status;

-- 添加工廠關聯表（訂單可以對應多個工廠）
CREATE TABLE IF NOT EXISTS order_factories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(order_id, factory_id)
);

-- 添加RLS政策
ALTER TABLE order_factories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view order factories" 
  ON order_factories 
  FOR SELECT 
  USING (true);

CREATE POLICY "Users can create order factories" 
  ON order_factories 
  FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Users can update order factories" 
  ON order_factories 
  FOR UPDATE 
  USING (true);

CREATE POLICY "Users can delete order factories" 
  ON order_factories 
  FOR DELETE 
  USING (true);
