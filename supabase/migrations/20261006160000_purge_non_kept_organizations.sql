-- ⚠️ 一次性資料清除腳本，不是一般 schema migration（不含任何 DDL），
-- 需要你自己在 Supabase Studio SQL editor 手動執行（這個 session 裡
-- 所有破壞性 SQL 透過 MCP 執行都會被權限分類器擋下來）。
--
-- 目的：只保留 lo1 (1dde948a-b4bb-45ad-9edc-1b33a3238afa) 和
-- 吉富 (07635e52-f170-47c2-bb4c-acee8d86fd09) 這兩個組織的資料，
-- 刪除 qq / qq2 org / GF 三個組織的所有資料，以及沒有 organization_id
-- 的孤兒資料列（orders/products_new/query_sessions/inventories）。
--
-- 保留 QA Sandbox Org (6ba881fd-a57d-43c0-8f9b-5aaff9c60b53)，它的
-- owner 是 lovejoker369+testing@gmail.com（撰寫時以為是驗證腳本的帳號）。
-- 更正：scripts/verify-query-ui.py 實際使用的是 .env 的 VERIFY_EMAIL =
-- lovejoker369+test@gmail.com（lo1 / lo2 的成員），不依賴 QA Sandbox Org。
--
-- 已確認：刪除 qq/qq2 org/GF 後不會有任何使用者帳號變成零組織歸屬
-- （qq/qq2 org 的 owner quinticechen@gmail.com 仍是 lo1 的成員），
-- 所以不需要額外刪除 auth.users / profiles。
--
-- v2：第一版漏掉兩條 FK（shipping_items.inventory_roll_id → inventory_rolls、
-- shipment_history.shipping_item_id → shipping_items，都是 NO ACTION），
-- 實際執行時在刪 inventory_rolls 時被 shipping_items 擋下來報錯。
-- 這版用 pg_constraint 重新撈過 public schema 「全部」FK（不是只挑幾張表查），
-- 排出完整的拓樸順序：
--   shipment_history → shipping_items → inventory_rolls → inventories
--   → purchase_orders → shippings → orders → customers / factories
--   / products_new / warehouses → query_sessions → organizations
-- BEGIN/COMMIT 確保全部成功才算數，任何一步失敗就整個 rollback。

BEGIN;

-- 1. shipment_history：依賴 customers / products_new，且必須先於 shipping_items 刪除
DELETE FROM public.shipment_history sh
WHERE sh.customer_id IN (
  SELECT id FROM public.customers
  WHERE organization_id IN (
    '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc', -- qq
    '30ad6168-7cb8-4014-997a-68dae1936fa9', -- qq2 org
    '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'  -- GF
  )
)
OR sh.product_id IN (
  SELECT id FROM public.products_new
  WHERE organization_id IN (
    '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
    '30ad6168-7cb8-4014-997a-68dae1936fa9',
    '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
  ) OR organization_id IS NULL
)
OR sh.shipping_item_id IN (
  SELECT si.id FROM public.shipping_items si
  JOIN public.shippings s ON s.id = si.shipping_id
  WHERE s.organization_id IN (
    '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
    '30ad6168-7cb8-4014-997a-68dae1936fa9',
    '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
  )
);

-- 2. shipping_items：依賴 shippings（CASCADE）/ inventory_rolls（NO ACTION），
--    必須先於 inventory_rolls 刪除；shipment_history 已在步驟 1 清掉
DELETE FROM public.shipping_items si
WHERE si.shipping_id IN (
  SELECT id FROM public.shippings
  WHERE organization_id IN (
    '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
    '30ad6168-7cb8-4014-997a-68dae1936fa9',
    '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
  )
)
OR si.inventory_roll_id IN (
  SELECT ir.id FROM public.inventory_rolls ir
  WHERE ir.inventory_id IN (
    SELECT id FROM public.inventories
    WHERE organization_id IN (
      '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
      '30ad6168-7cb8-4014-997a-68dae1936fa9',
      '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
    ) OR organization_id IS NULL
  )
  OR ir.product_id IN (
    SELECT id FROM public.products_new
    WHERE organization_id IN (
      '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
      '30ad6168-7cb8-4014-997a-68dae1936fa9',
      '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
    ) OR organization_id IS NULL
  )
  OR ir.warehouse_id IN (
    SELECT id FROM public.warehouses
    WHERE organization_id IN (
      '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
      '30ad6168-7cb8-4014-997a-68dae1936fa9',
      '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
    )
  )
);

-- 3. inventory_rolls：依賴 inventories / products_new / warehouses，
--    shipping_items 已在步驟 2 清掉
DELETE FROM public.inventory_rolls ir
WHERE ir.inventory_id IN (
  SELECT id FROM public.inventories
  WHERE organization_id IN (
    '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
    '30ad6168-7cb8-4014-997a-68dae1936fa9',
    '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
  ) OR organization_id IS NULL
)
OR ir.product_id IN (
  SELECT id FROM public.products_new
  WHERE organization_id IN (
    '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
    '30ad6168-7cb8-4014-997a-68dae1936fa9',
    '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
  ) OR organization_id IS NULL
)
OR ir.warehouse_id IN (
  SELECT id FROM public.warehouses
  WHERE organization_id IN (
    '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
    '30ad6168-7cb8-4014-997a-68dae1936fa9',
    '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
  )
);

-- 4. inventories：inventory_rolls 已清掉，且必須先於 factories / purchase_orders 刪除
DELETE FROM public.inventories
WHERE organization_id IN (
  '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
  '30ad6168-7cb8-4014-997a-68dae1936fa9',
  '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
) OR organization_id IS NULL;

-- 5. purchase_orders（purchase_order_items / purchase_order_relations 會 CASCADE 自動清掉），
--    必須先於 factories / orders 刪除；inventories 已清掉
DELETE FROM public.purchase_orders
WHERE organization_id IN (
  '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
  '30ad6168-7cb8-4014-997a-68dae1936fa9',
  '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
);

-- 6. shippings：shipping_items 已在步驟 2 清掉（這裡的 CASCADE 只會清掉 0 筆殘留），
--    必須先於 customers / orders 刪除
DELETE FROM public.shippings
WHERE organization_id IN (
  '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
  '30ad6168-7cb8-4014-997a-68dae1936fa9',
  '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
);

-- 7. orders（order_products / order_factories / purchase_order_relations 會 CASCADE 自動清掉），
--    purchase_orders / shippings 已清掉
DELETE FROM public.orders
WHERE organization_id IN (
  '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
  '30ad6168-7cb8-4014-997a-68dae1936fa9',
  '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
) OR organization_id IS NULL;

-- 8. customers / factories / products_new / warehouses（此時已無任何 NO ACTION 依賴擋著）
DELETE FROM public.customers
WHERE organization_id IN (
  '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
  '30ad6168-7cb8-4014-997a-68dae1936fa9',
  '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
);

DELETE FROM public.factories
WHERE organization_id IN (
  '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
  '30ad6168-7cb8-4014-997a-68dae1936fa9',
  '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
);

DELETE FROM public.products_new
WHERE organization_id IN (
  '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
  '30ad6168-7cb8-4014-997a-68dae1936fa9',
  '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
) OR organization_id IS NULL;

DELETE FROM public.warehouses
WHERE organization_id IN (
  '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
  '30ad6168-7cb8-4014-997a-68dae1936fa9',
  '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
);

-- 9. query_sessions（query_messages 會 CASCADE 自動清掉；沒有 NO ACTION 依賴問題，
--    null-org 的一併清掉；org 符合的其實靠 organizations CASCADE 也會清，這裡先清是為了保險）
DELETE FROM public.query_sessions
WHERE organization_id IN (
  '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
  '30ad6168-7cb8-4014-997a-68dae1936fa9',
  '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
) OR organization_id IS NULL;

-- 10. 最後刪除 organizations 本身
--     （organization_roles / user_organization_roles / user_organizations
--     都是 ON DELETE CASCADE，刪除組織時會自動清掉，不用手動處理）
DELETE FROM public.organizations
WHERE id IN (
  '23b8cf9d-ea33-4f21-8ac3-7c9cd49937bc',
  '30ad6168-7cb8-4014-997a-68dae1936fa9',
  '0c8f93ee-553f-4e94-9c45-b1bf2c6112da'
);

COMMIT;
