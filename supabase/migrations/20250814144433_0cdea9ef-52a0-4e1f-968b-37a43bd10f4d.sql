-- 更新現有的 inventory 記錄，為缺少 organization_id 的記錄設置正確的 organization_id
UPDATE inventories 
SET organization_id = po.organization_id
FROM purchase_orders po
WHERE inventories.purchase_order_id = po.id
AND inventories.organization_id IS NULL;