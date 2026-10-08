// Display labels for record_audit_logs entries

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  INSERT: '新增',
  UPDATE: '修改',
  DELETE: '刪除',
};

export const AUDIT_TABLE_LABELS: Record<string, string> = {
  orders: '訂單',
  order_products: '訂單產品',
  order_factories: '訂單工廠',
  purchase_orders: '採購單',
  purchase_order_items: '採購項目',
  purchase_order_relations: '採購單關聯訂單',
  inventories: '入庫批次',
  inventory_rolls: '布卷',
  shippings: '出貨單',
  shipping_items: '出貨布卷',
  product_groups: '產品',
  products_new: '產品顏色',
  customers: '客戶',
  factories: '工廠',
  warehouses: '貨架',
  organizations: '組織設定',
  organization_roles: '角色',
  user_organizations: '組織成員',
  user_organization_roles: '成員角色',
  profiles: '用戶資料',
};

export const AUDIT_FIELD_LABELS: Record<string, string> = {
  quantity: '數量',
  unit_price: '單價',
  specifications: '規格',
  total_rolls: '總卷數',
  shipped_quantity: '出貨重量',
  ordered_quantity: '採購數量',
  ordered_rolls: '採購卷數',
  received_quantity: '已入庫數量',
  current_quantity: '當前重量',
  quality: '品質',
  shelf: '貨架',
  warehouse_id: '倉庫',
  product_id: '產品',
  factory_id: '工廠',
  customer_id: '客戶',
  inventory_roll_id: '布卷',
  roll_number: '布卷編號',
  is_allocated: '已分配',
  status: '狀態',
  payment_status: '付款狀態',
  shipping_status: '出貨狀態',
  note: '備註',
  arrival_date: '到貨日期',
  expected_arrival_date: '預計到貨日期',
  order_date: '下單日期',
  shipping_date: '出貨日期',
  total_shipped_quantity: '總出貨重量',
  total_shipped_rolls: '總出貨卷數',
  name: '名稱',
  description: '描述',
  is_active: '啟用',
  settings: '設定',
  // Products, customers, factories, shelves
  category: '類別',
  color: '顏色',
  color_code: '色號',
  color_hex: '色值',
  group_id: '所屬產品',
  stock_thresholds: '安全庫存',
  unit_of_measure: '單位',
  contact_person: '聯絡人',
  phone: '電話',
  landline_phone: '市話',
  fax: '傳真',
  email: '電子郵件',
  address: '地址',
  location: '位置',
  // People, roles and permissions
  full_name: '姓名',
  display_name: '顯示名稱',
  permissions: '權限',
  role: '角色',
  role_id: '角色',
  invited_role_id: '邀請角色',
  user_id: '用戶',
  created_by: '建立者',
  owner_id: '擁有者',
  invited_by: '邀請者',
  granted_by: '授權者',
};

export const formatAuditValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '（空白）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

// Bookkeeping columns left out when showing the contents of an added or removed row
export const AUDIT_SNAPSHOT_HIDDEN_FIELDS = new Set([
  'status',
  'shipped_quantity',
  'received_quantity',
  'current_quantity',
  'is_allocated',
]);
