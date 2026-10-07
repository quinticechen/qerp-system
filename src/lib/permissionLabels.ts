// Role permission switches, grouped as shown in the role dialogs
export const PERMISSION_GROUPS = {
  '產品管理': [
    { key: 'canViewProducts', label: '查看產品' },
    { key: 'canCreateProducts', label: '新增產品' },
    { key: 'canEditProducts', label: '編輯產品' },
    { key: 'canDeleteProducts', label: '刪除產品' },
  ],
  '庫存管理': [
    { key: 'canViewInventory', label: '查看庫存' },
    { key: 'canCreateInventory', label: '新增庫存' },
    { key: 'canEditInventory', label: '編輯庫存' },
  ],
  '訂單管理': [
    { key: 'canViewOrders', label: '查看訂單' },
    { key: 'canCreateOrders', label: '新增訂單' },
    { key: 'canEditOrders', label: '編輯訂單' },
  ],
  '採購管理': [
    { key: 'canViewPurchases', label: '查看採購' },
    { key: 'canCreatePurchases', label: '新增採購' },
    { key: 'canEditPurchases', label: '編輯採購' },
  ],
  '出貨管理': [
    { key: 'canViewShipping', label: '查看出貨' },
    { key: 'canCreateShipping', label: '新增出貨' },
    { key: 'canEditShipping', label: '編輯出貨' },
  ],
  '客戶管理': [
    { key: 'canViewCustomers', label: '查看客戶' },
    { key: 'canCreateCustomers', label: '新增客戶' },
    { key: 'canEditCustomers', label: '編輯客戶' },
  ],
  '工廠管理': [
    { key: 'canViewFactories', label: '查看工廠' },
    { key: 'canCreateFactories', label: '新增工廠' },
    { key: 'canEditFactories', label: '編輯工廠' },
  ],
  '系統管理': [
    { key: 'canViewUsers', label: '查看使用者' },
    { key: 'canCreateUsers', label: '新增使用者' },
    { key: 'canEditUsers', label: '編輯使用者' },
    { key: 'canViewPermissions', label: '查看權限' },
    { key: 'canEditPermissions', label: '編輯權限' },
    { key: 'canViewSystemSettings', label: '查看組織設定' },
    { key: 'canEditSystemSettings', label: '編輯組織設定' },
  ],
};

// Flat key → label lookup, e.g. for showing permission changes in the edit history
export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(PERMISSION_GROUPS).flatMap((group) => group.map((permission) => [permission.key, permission.label])),
);
