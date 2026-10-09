
// Permission keys grouped by feature, in sidebar order (docs/requirements/MULTI_TENANT_RBAC.md §4.3).
// Which role holds which key is stored in the database table role_permissions.
// `action` is the short name shown in the role overview, e.g. 查看、新增、編輯.
export const PERMISSION_GROUPS = {
  '產品管理': [
    { key: 'canViewProducts', label: '查看產品', action: '查看' },
    { key: 'canCreateProducts', label: '新增產品', action: '新增' },
    { key: 'canEditProducts', label: '編輯產品', action: '編輯' },
  ],
  '訂單管理': [
    { key: 'canViewOrders', label: '查看訂單', action: '查看' },
    { key: 'canCreateOrders', label: '新增訂單', action: '新增' },
    { key: 'canEditOrders', label: '編輯訂單', action: '編輯' },
  ],
  '採購管理': [
    { key: 'canViewPurchases', label: '查看採購', action: '查看' },
    { key: 'canCreatePurchases', label: '新增採購', action: '新增' },
    { key: 'canEditPurchases', label: '編輯採購', action: '編輯' },
  ],
  '貨架管理': [
    { key: 'canViewShelves', label: '查看貨架', action: '查看' },
    { key: 'canCreateShelves', label: '新增貨架', action: '新增' },
    { key: 'canEditShelves', label: '編輯貨架', action: '編輯' },
  ],
  '庫存管理': [
    { key: 'canViewInventory', label: '查看庫存', action: '查看' },
    { key: 'canCreateInventory', label: '入庫', action: '入庫' },
    { key: 'canEditInventory', label: '編輯庫存', action: '編輯' },
  ],
  '出貨管理': [
    { key: 'canViewShipping', label: '查看出貨', action: '查看' },
    { key: 'canCreateShipping', label: '新增出貨', action: '新增' },
    { key: 'canEditShipping', label: '編輯出貨', action: '編輯' },
  ],
  '工廠管理': [
    { key: 'canViewFactories', label: '查看工廠', action: '查看' },
    { key: 'canCreateFactories', label: '新增工廠', action: '新增' },
    { key: 'canEditFactories', label: '編輯工廠', action: '編輯' },
  ],
  '客戶管理': [
    { key: 'canViewCustomers', label: '查看客戶', action: '查看' },
    { key: 'canCreateCustomers', label: '新增客戶', action: '新增' },
    { key: 'canEditCustomers', label: '編輯客戶', action: '編輯' },
  ],
  '用戶管理': [
    { key: 'canViewUsers', label: '查看用戶', action: '查看' },
    { key: 'canCreateUsers', label: '邀請用戶', action: '邀請' },
    { key: 'canEditUsers', label: '編輯用戶', action: '編輯' },
  ],
  '組織管理': [
    { key: 'canViewPermissions', label: '查看角色說明', action: '查看角色' },
    { key: 'canViewSystemSettings', label: '查看組織設定', action: '查看設定' },
    { key: 'canEditSystemSettings', label: '編輯組織設定', action: '編輯設定' },
  ],
} as const;

export type PermissionKey = (typeof PERMISSION_GROUPS)[keyof typeof PERMISSION_GROUPS][number]['key'];

export const PERMISSION_KEYS: PermissionKey[] = Object.values(PERMISSION_GROUPS).flatMap((group) =>
  group.map((permission) => permission.key),
);

// Keys that only appear in edit history from before the fixed roles
const LEGACY_PERMISSION_LABELS: Record<string, string> = {
  canDeleteProducts: '刪除產品',
  canEditPermissions: '編輯權限',
  canManageOrganization: '管理組織',
  canManageUsers: '管理用戶',
  canManageRoles: '管理角色',
};

// Flat key → label lookup, e.g. for showing permission changes in the edit history
export const PERMISSION_LABELS: Record<string, string> = {
  ...LEGACY_PERMISSION_LABELS,
  ...Object.fromEntries(
    Object.values(PERMISSION_GROUPS).flatMap((group) => group.map((permission) => [permission.key, permission.label])),
  ),
};
