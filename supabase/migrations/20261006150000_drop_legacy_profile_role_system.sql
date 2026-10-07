-- ⚠️ 尚未套用到正式環境（apply_migration 的確認提示同樣被拒絕，
-- 跟 20261006130000 一樣需要你自己在 Supabase Studio SQL editor 手動執行）。
--
-- 前置條件：20261006140000_add_org_rls_for_order_and_purchase_order_items.sql
-- 必須已經套用成功，確認 order_products / purchase_order_items 的
-- org_isolation_select / org_isolation_modify policy 已存在，且
-- handle_new_user() / ensure_user_profile() 已經不再寫入 profiles.role，
-- 否則執行這個檔案會讓新使用者註冊失敗、訂單與採購單管理失去寫入權限。
--
-- 做的事：移除所有依賴 get_current_user_role() 的舊版全域角色 policy
-- （order_products / purchase_order_items / shipment_history /
-- shipping_items / warehouses 這 5 個已有組織制 policy 完整覆蓋；
-- profiles 的 "Admins can manage all profiles" 則由 self-access policy +
-- complete_user_invitation() RPC 處理），然後移除 get_current_user_role()
-- 本身、完全沒人用的 has_role()，最後刪除 profiles.role 欄位。

DROP POLICY IF EXISTS "Sales, assistants and admins can manage order products" ON public.order_products;
DROP POLICY IF EXISTS "Sales and admins can manage purchase order items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Warehouse staff and admins can insert shipment history" ON public.shipment_history;
DROP POLICY IF EXISTS "Warehouse staff and admins can manage shipping items" ON public.shipping_items;
DROP POLICY IF EXISTS "Warehouse staff and admins can manage warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;

DROP FUNCTION IF EXISTS public.get_current_user_role();
DROP FUNCTION IF EXISTS public.has_role(uuid, public.user_role);

ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;
