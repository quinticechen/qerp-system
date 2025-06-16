
-- 修正訂單編號生成函數的格式問題
CREATE OR REPLACE FUNCTION generate_new_order_number()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  current_date_str TEXT;
  seq_num INTEGER;
  formatted_seq TEXT;
BEGIN
  -- 格式：年份K月份日期-流水號 (例如: 25K0616-001)
  current_date_str := TO_CHAR(NOW(), 'YY') || 'K' || TO_CHAR(NOW(), 'MMDD');
  
  -- 獲取當日序列號
  seq_num := nextval('order_daily_seq');
  
  -- 格式化序列號為3位數
  formatted_seq := LPAD(seq_num::TEXT, 3, '0');
  
  -- 生成最終訂單編號
  NEW.order_number := current_date_str || '-' || formatted_seq;
  
  RETURN NEW;
END;
$function$;
