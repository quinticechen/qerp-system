
-- 新增採購單項目狀態追蹤
ALTER TABLE purchase_order_items 
ADD COLUMN received_quantity NUMERIC DEFAULT 0,
ADD COLUMN status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'partial_received', 'received'));

-- 新增訂單項目狀態追蹤  
ALTER TABLE order_products
ADD COLUMN shipped_quantity NUMERIC DEFAULT 0,
ADD COLUMN status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'partial_shipped', 'shipped'));

-- 建立庫存統計視圖
CREATE OR REPLACE VIEW inventory_summary AS
SELECT 
  p.id as product_id,
  p.name as product_name,
  p.color,
  COALESCE(SUM(ir.current_quantity), 0) as total_stock,
  COUNT(ir.id) as total_rolls,
  COALESCE(SUM(CASE WHEN ir.quality = 'A' THEN ir.current_quantity ELSE 0 END), 0) as a_grade_stock,
  COALESCE(SUM(CASE WHEN ir.quality = 'B' THEN ir.current_quantity ELSE 0 END), 0) as b_grade_stock,
  COALESCE(SUM(CASE WHEN ir.quality = 'C' THEN ir.current_quantity ELSE 0 END), 0) as c_grade_stock,
  COALESCE(SUM(CASE WHEN ir.quality = 'D' THEN ir.current_quantity ELSE 0 END), 0) as d_grade_stock,
  COALESCE(SUM(CASE WHEN ir.quality = 'defective' THEN ir.current_quantity ELSE 0 END), 0) as defective_stock
FROM products_new p
LEFT JOIN inventory_rolls ir ON p.id = ir.product_id AND ir.current_quantity > 0
GROUP BY p.id, p.name, p.color
ORDER BY p.name, p.color;

-- 建立函數來更新採購單項目狀態
CREATE OR REPLACE FUNCTION update_purchase_order_item_status()
RETURNS TRIGGER AS $$
BEGIN
  -- 更新對應的採購單項目已收貨數量
  UPDATE purchase_order_items 
  SET received_quantity = (
    SELECT COALESCE(SUM(ir.quantity), 0)
    FROM inventory_rolls ir
    INNER JOIN inventories i ON ir.inventory_id = i.id
    WHERE i.purchase_order_id = (
      SELECT purchase_order_id FROM inventories WHERE id = NEW.inventory_id
    )
    AND ir.product_id = NEW.product_id
  )
  WHERE purchase_order_id = (
    SELECT purchase_order_id FROM inventories WHERE id = NEW.inventory_id
  )
  AND product_id = NEW.product_id;
  
  -- 更新採購單項目狀態
  UPDATE purchase_order_items 
  SET status = CASE 
    WHEN received_quantity >= ordered_quantity THEN 'received'
    WHEN received_quantity > 0 THEN 'partial_received'
    ELSE 'pending'
  END
  WHERE purchase_order_id = (
    SELECT purchase_order_id FROM inventories WHERE id = NEW.inventory_id
  )
  AND product_id = NEW.product_id;
  
  -- 更新採購單整體狀態
  UPDATE purchase_orders
  SET status = CASE
    WHEN (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = (
      SELECT purchase_order_id FROM inventories WHERE id = NEW.inventory_id
    ) AND status = 'received') = (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = (
      SELECT purchase_order_id FROM inventories WHERE id = NEW.inventory_id
    )) THEN 'completed'
    WHEN (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = (
      SELECT purchase_order_id FROM inventories WHERE id = NEW.inventory_id
    ) AND status IN ('partial_received', 'received')) > 0 THEN 'partial_received'
    ELSE status
  END
  WHERE id = (
    SELECT purchase_order_id FROM inventories WHERE id = NEW.inventory_id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 建立函數來更新訂單項目狀態
CREATE OR REPLACE FUNCTION update_order_product_status()
RETURNS TRIGGER AS $$
BEGIN
  -- 更新對應的訂單項目已出貨數量
  UPDATE order_products 
  SET shipped_quantity = (
    SELECT COALESCE(SUM(si.shipped_quantity), 0)
    FROM shipping_items si
    INNER JOIN shippings s ON si.shipping_id = s.id
    INNER JOIN inventory_rolls ir ON si.inventory_roll_id = ir.id
    WHERE s.order_id = (
      SELECT order_id FROM shippings WHERE id = NEW.shipping_id
    )
    AND ir.product_id = order_products.product_id
  )
  WHERE order_id = (
    SELECT order_id FROM shippings WHERE id = NEW.shipping_id
  );
  
  -- 更新訂單項目狀態
  UPDATE order_products 
  SET status = CASE 
    WHEN shipped_quantity >= quantity THEN 'shipped'
    WHEN shipped_quantity > 0 THEN 'partial_shipped'
    ELSE 'pending'
  END
  WHERE order_id = (
    SELECT order_id FROM shippings WHERE id = NEW.shipping_id
  );
  
  -- 更新訂單整體出貨狀態
  UPDATE orders
  SET shipping_status = CASE
    WHEN (SELECT COUNT(*) FROM order_products WHERE order_id = (
      SELECT order_id FROM shippings WHERE id = NEW.shipping_id
    ) AND status = 'shipped') = (SELECT COUNT(*) FROM order_products WHERE order_id = (
      SELECT order_id FROM shippings WHERE id = NEW.shipping_id
    )) THEN 'shipped'
    WHEN (SELECT COUNT(*) FROM order_products WHERE order_id = (
      SELECT order_id FROM shippings WHERE id = NEW.shipping_id
    ) AND status IN ('partial_shipped', 'shipped')) > 0 THEN 'partial_shipped'
    ELSE shipping_status
  END
  WHERE id = (
    SELECT order_id FROM shippings WHERE id = NEW.shipping_id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 建立觸發器
CREATE TRIGGER trigger_update_purchase_order_status
  AFTER INSERT OR UPDATE ON inventory_rolls
  FOR EACH ROW
  EXECUTE FUNCTION update_purchase_order_item_status();

CREATE TRIGGER trigger_update_order_status
  AFTER INSERT OR UPDATE ON shipping_items
  FOR EACH ROW
  EXECUTE FUNCTION update_order_product_status();

-- 更新採購單狀態枚舉（如果需要）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
    CREATE TYPE purchase_order_status AS ENUM ('pending', 'confirmed', 'partial_received', 'completed', 'cancelled');
  ELSE
    -- 如果類型已存在，添加新值
    ALTER TYPE purchase_order_status ADD VALUE IF NOT EXISTS 'partial_received';
  END IF;
END $$;
