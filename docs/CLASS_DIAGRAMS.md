
# 類別圖設計文檔

## 1. 概述

本文檔基於 DTDD (Document-driven Test-driven Development) 方法論，詳細描述紡織業多租戶組織 ERP 系統的類別設計。系統採用多租戶架構，支援組織層級的權限管理和數據隔離。

## 2. 組織管理核心類別

### 2.1 組織管理類別

```typescript
// 組織實體類別
class Organization {
  id: string;
  name: string;
  description?: string;
  settings: Record<string, any>;
  owner_id: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;

  // 關聯關係
  owner: User;
  members: UserOrganization[];
  roles: OrganizationRole[];
  
  // 業務方法
  addMember(userId: string, invitedBy: string): Promise<UserOrganization>;
  removeMember(userId: string): Promise<void>;
  updateSettings(settings: Record<string, any>): Promise<void>;
  isOwner(userId: string): boolean;
}

// 使用者組織關聯類別
class UserOrganization {
  id: string;
  user_id: string;
  organization_id: string;
  is_active: boolean;
  joined_at: Date;
  invited_by?: string;
  created_at: Date;
  updated_at: Date;

  // 關聯關係
  user: User;
  organization: Organization;
  inviter?: User;
  roles: UserOrganizationRole[];

  // 業務方法
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  getRoles(): Promise<OrganizationRole[]>;
}

// 組織角色類別
class OrganizationRole {
  id: string;
  organization_id: string;
  name: string;
  display_name: string;
  description?: string;
  permissions: Record<string, boolean>;
  is_system_role: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  created_by?: string;

  // 關聯關係
  organization: Organization;
  creator?: User;
  userRoles: UserOrganizationRole[];

  // 業務方法
  hasPermission(permission: string): boolean;
  updatePermissions(permissions: Record<string, boolean>): Promise<void>;
  assignToUser(userId: string, grantedBy: string): Promise<UserOrganizationRole>;
  getPermissionCount(): number;
}

// 使用者角色分配類別
class UserOrganizationRole {
  id: string;
  user_id: string;
  organization_id: string;
  role_id: string;
  granted_by?: string;
  granted_at: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;

  // 關聯關係
  user: User;
  organization: Organization;
  role: OrganizationRole;
  grantor?: User;

  // 業務方法
  revoke(): Promise<void>;
  renew(): Promise<void>;
}
```

### 2.2 使用者管理類別

```typescript
// 擴展的使用者類別
class User {
  id: string;
  email: string;
  full_name?: string;
  phone?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;

  // 關聯關係
  ownedOrganizations: Organization[];
  organizationMemberships: UserOrganization[];
  roles: UserOrganizationRole[];

  // 業務方法
  getOrganizations(): Promise<Organization[]>;
  getCurrentOrganization(): Organization | null;
  setCurrentOrganization(organizationId: string): void;
  hasPermissionInOrganization(organizationId: string, permission: string): Promise<boolean>;
  isOwnerOfOrganization(organizationId: string): boolean;
  getRolesInOrganization(organizationId: string): Promise<OrganizationRole[]>;
}

// 使用者檔案類別
class UserProfile {
  id: string;
  email: string;
  role: UserRole;
  phone?: string;
  full_name?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;

  // 關聯關係
  user: User;
  organizationRoles: UserOrganizationRole[];

  // 業務方法
  updateProfile(data: Partial<UserProfile>): Promise<void>;
  getSystemRole(): UserRole;
}
```

## 3. 業務實體類別

### 3.1 產品管理類別

```typescript
// 產品類別 (多租戶支援)
class Product {
  id: string;
  organization_id: string; // 新增：組織隔離
  name: string;
  category: string;
  color?: string;
  color_code?: string;
  unit_of_measure: string;
  status: ProductStatus;
  stock_thresholds?: number;
  user_id: string;
  updated_by?: string;
  created_at: Date;
  updated_at: Date;

  // 關聯關係
  organization: Organization; // 新增：組織關聯
  creator: User;
  updater?: User;
  inventoryRolls: InventoryRoll[];
  orderProducts: OrderProduct[];
  purchaseItems: PurchaseOrderItem[];

  // 業務方法
  updateStatus(status: ProductStatus): Promise<void>;
  setStockThreshold(threshold: number): Promise<void>;
  getCurrentStock(): Promise<number>;
  getStockByQuality(): Promise<Record<FabricQuality, number>>;
  isLowStock(): Promise<boolean>;
  belongsToOrganization(organizationId: string): boolean;
}
```

### 3.2 客戶管理類別

```typescript
// 客戶類別 (多租戶支援)
class Customer {
  id: string;
  organization_id: string; // 新增：組織隔離
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  contact_person?: string;
  created_at: Date;
  updated_at: Date;

  // 關聯關係
  organization: Organization; // 新增：組織關聯
  orders: Order[];
  shippings: Shipping[];

  // 業務方法
  addOrder(orderData: CreateOrderData): Promise<Order>;
  getOrderHistory(): Promise<Order[]>;
  getTotalOrderValue(): Promise<number>;
  belongsToOrganization(organizationId: string): boolean;
}
```

### 3.3 訂單管理類別

```typescript
// 訂單類別 (多租戶支援)
class Order {
  id: string;
  organization_id: string; // 新增：組織隔離
  order_number: string;
  customer_id: string;
  status: OrderStatus;
  shipping_status: ShippingStatus;
  payment_status: PaymentStatus;
  note?: string;
  user_id: string;
  created_at: Date;
  updated_at: Date;

  // 關聯關係
  organization: Organization; // 新增：組織關聯
  customer: Customer;
  creator: User;
  products: OrderProduct[];
  factories: OrderFactory[];
  shippings: Shipping[];
  purchaseOrders: PurchaseOrder[];

  // 業務方法
  addProduct(productData: AddOrderProductData): Promise<OrderProduct>;
  updateStatus(status: OrderStatus): Promise<void>;
  calculateTotalValue(): Promise<number>;
  getShippingProgress(): Promise<ShippingProgress>;
  canShip(): Promise<boolean>;
  belongsToOrganization(organizationId: string): boolean;
}
```

## 4. 權限管理類別

### 4.1 權限檢查類別

```typescript
// 組織權限管理服務
class OrganizationPermissionService {
  // 檢查使用者是否屬於組織
  static async userBelongsToOrganization(userId: string, organizationId: string): Promise<boolean>;
  
  // 檢查使用者是否為組織擁有者
  static async isOrganizationOwner(userId: string, organizationId: string): Promise<boolean>;
  
  // 檢查使用者在組織中是否有特定權限
  static async userHasPermission(userId: string, organizationId: string, permission: string): Promise<boolean>;
  
  // 獲取使用者在組織中的所有權限
  static async getUserPermissions(userId: string, organizationId: string): Promise<Record<string, boolean>>;
  
  // 獲取使用者在組織中的角色
  static async getUserRoles(userId: string, organizationId: string): Promise<OrganizationRole[]>;
}

// 權限守衛類別
class PermissionGuard {
  private userId: string;
  private organizationId: string;

  constructor(userId: string, organizationId: string) {
    this.userId = userId;
    this.organizationId = organizationId;
  }

  // 檢查功能權限
  async hasPermission(permission: string): Promise<boolean>;
  
  // 檢查多個權限中的任一個
  async hasAnyPermission(permissions: string[]): Promise<boolean>;
  
  // 檢查所有權限
  async hasAllPermissions(permissions: string[]): Promise<boolean>;
  
  // 檢查組織存取權限
  async canAccessOrganization(): Promise<boolean>;
  
  // 檢查資源擁有權
  async ownsResource(resourceId: string, resourceType: string): Promise<boolean>;
}
```

### 4.2 權限常量類別

```typescript
// 權限定義常量
class Permissions {
  // 產品管理權限
  static readonly CAN_VIEW_PRODUCTS = 'canViewProducts';
  static readonly CAN_CREATE_PRODUCTS = 'canCreateProducts';
  static readonly CAN_EDIT_PRODUCTS = 'canEditProducts';
  static readonly CAN_DELETE_PRODUCTS = 'canDeleteProducts';

  // 庫存管理權限
  static readonly CAN_VIEW_INVENTORY = 'canViewInventory';
  static readonly CAN_CREATE_INVENTORY = 'canCreateInventory';
  static readonly CAN_EDIT_INVENTORY = 'canEditInventory';

  // 訂單管理權限
  static readonly CAN_VIEW_ORDERS = 'canViewOrders';
  static readonly CAN_CREATE_ORDERS = 'canCreateOrders';
  static readonly CAN_EDIT_ORDERS = 'canEditOrders';

  // 組織管理權限
  static readonly CAN_MANAGE_ORGANIZATION = 'canManageOrganization';
  static readonly CAN_MANAGE_USERS = 'canManageUsers';
  static readonly CAN_MANAGE_ROLES = 'canManageRoles';

  // 獲取所有權限列表
  static getAllPermissions(): string[];
  
  // 獲取權限分組
  static getPermissionGroups(): Record<string, string[]>;
}

// 角色模板類別
class RoleTemplates {
  // 預設系統角色
  static readonly SYSTEM_ROLES = {
    OWNER: {
      name: 'owner',
      display_name: '組織擁有者',
      permissions: { /* 所有權限 */ }
    },
    ADMIN: {
      name: 'admin',
      display_name: '管理員',
      permissions: { /* 管理員權限 */ }
    },
    SALES: {
      name: 'sales',
      display_name: '業務',
      permissions: { /* 業務權限 */ }
    }
    // ... 其他角色
  };

  // 創建系統角色
  static async createSystemRoles(organizationId: string): Promise<OrganizationRole[]>;
  
  // 獲取角色模板
  static getRoleTemplate(roleName: string): RoleTemplate | null;
}
```

## 5. 服務類別

### 5.1 組織服務類別

```typescript
// 組織管理服務
class OrganizationService {
  // 創建新組織
  static async createOrganization(data: CreateOrganizationData, ownerId: string): Promise<Organization>;
  
  // 獲取使用者的組織列表
  static async getUserOrganizations(userId: string): Promise<UserOrganization[]>;
  
  // 切換當前組織
  static async switchOrganization(userId: string, organizationId: string): Promise<void>;
  
  // 邀請使用者加入組織
  static async inviteUser(organizationId: string, email: string, roleIds: string[], inviterId: string): Promise<UserOrganization>;
  
  // 移除組織成員
  static async removeMember(organizationId: string, userId: string, removedBy: string): Promise<void>;
  
  // 更新組織設定
  static async updateOrganization(organizationId: string, data: UpdateOrganizationData): Promise<Organization>;
}

// 角色管理服務
class OrganizationRoleService {
  // 創建自定義角色
  static async createRole(organizationId: string, data: CreateRoleData, createdBy: string): Promise<OrganizationRole>;
  
  // 更新角色權限
  static async updateRole(roleId: string, data: UpdateRoleData): Promise<OrganizationRole>;
  
  // 分配角色給使用者
  static async assignRole(userId: string, organizationId: string, roleId: string, grantedBy: string): Promise<UserOrganizationRole>;
  
  // 撤銷使用者角色
  static async revokeRole(userId: string, organizationId: string, roleId: string): Promise<void>;
  
  // 獲取組織角色列表
  static async getOrganizationRoles(organizationId: string): Promise<OrganizationRole[]>;
}
```

### 5.2 數據存取服務類別

```typescript
// 多租戶數據存取基礎類別
abstract class MultiTenantDataService<T> {
  protected tableName: string;
  protected organizationId: string;

  constructor(tableName: string, organizationId: string) {
    this.tableName = tableName;
    this.organizationId = organizationId;
  }

  // 基礎 CRUD 操作（自動加入組織過濾）
  async findById(id: string): Promise<T | null>;
  async findAll(filters?: Record<string, any>): Promise<T[]>;
  async create(data: Partial<T>): Promise<T>;
  async update(id: string, data: Partial<T>): Promise<T>;
  async delete(id: string): Promise<void>;
  
  // 組織數據隔離檢查
  protected async ensureOrganizationAccess(resourceId: string): Promise<void>;
  
  // 自動添加組織 ID 到查詢條件
  protected addOrganizationFilter(query: any): any;
}

// 具體的數據服務實現
class ProductDataService extends MultiTenantDataService<Product> {
  constructor(organizationId: string) {
    super('products_new', organizationId);
  }

  // 產品特定查詢方法
  async findByCategory(category: string): Promise<Product[]>;
  async findLowStockProducts(): Promise<Product[]>;
  async updateStockThreshold(productId: string, threshold: number): Promise<Product>;
}

class OrderDataService extends MultiTenantDataService<Order> {
  constructor(organizationId: string) {
    super('orders', organizationId);
  }

  // 訂單特定查詢方法
  async findByCustomer(customerId: string): Promise<Order[]>;
  async findByStatus(status: OrderStatus): Promise<Order[]>;
  async findPendingOrders(): Promise<Order[]>;
}
```

## 6. Hook 類別設計

### 6.1 組織管理 Hooks

```typescript
// 組織管理 Hook
interface UseOrganizationReturn {
  organizations: UserOrganization[];
  currentOrganization: Organization | null;
  loading: boolean;
  hasNoOrganizations: boolean;
  switchOrganization: (organizationId: string) => void;
  createOrganization: (name: string, description?: string) => Promise<Organization>;
  refreshOrganizations: () => Promise<void>;
}

class UseOrganization {
  static hook(): UseOrganizationReturn;
}

// 組織權限 Hook
interface UseOrganizationPermissionsReturn {
  userRoles: UserOrganizationRole[];
  permissions: Record<string, boolean>;
  isOwner: boolean;
  loading: boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  refreshPermissions: () => Promise<void>;
}

class UseOrganizationPermissions {
  static hook(): UseOrganizationPermissionsReturn;
}
```

### 6.2 數據查詢 Hooks

```typescript
// 多租戶數據查詢 Hook 基礎類別
abstract class UseMultiTenantData<T> {
  protected queryKey: string[];
  protected organizationId: string;

  constructor(queryKey: string[], organizationId: string) {
    this.queryKey = queryKey;
    this.organizationId = organizationId;
  }

  // 基礎查詢方法
  abstract fetchData(): Promise<T[]>;
  
  // Hook 實現
  useQuery(): {
    data: T[];
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
  };
}

// 具體實現
class UseOrganizationProducts extends UseMultiTenantData<Product> {
  async fetchData(): Promise<Product[]> {
    // 實現產品查詢邏輯
  }
}

class UseOrganizationOrders extends UseMultiTenantData<Order> {
  async fetchData(): Promise<Order[]> {
    // 實現訂單查詢邏輯
  }
}
```

## 7. 組件類別設計

### 7.1 組織管理組件

```typescript
// 組織切換器組件
interface OrganizationSwitcherProps {
  className?: string;
}

class OrganizationSwitcher {
  props: OrganizationSwitcherProps;
  
  // 組織列表顯示
  renderOrganizationList(): JSX.Element;
  
  // 切換處理
  handleSwitchOrganization(organizationId: string): void;
  
  // 組件渲染
  render(): JSX.Element;
}

// 創建組織對話框
interface CreateOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

class CreateOrganizationDialog {
  props: CreateOrganizationDialogProps;
  
  // 表單提交處理
  handleSubmit(data: CreateOrganizationForm): Promise<void>;
  
  // 組件渲染
  render(): JSX.Element;
}

// 組織角色管理組件
interface OrganizationRoleManagementProps {
  organizationId: string;
}

class OrganizationRoleManagement {
  props: OrganizationRoleManagementProps;
  
  // 角色列表顯示
  renderRoleList(): JSX.Element;
  
  // 創建角色
  handleCreateRole(data: CreateRoleData): Promise<void>;
  
  // 編輯角色
  handleEditRole(roleId: string, data: UpdateRoleData): Promise<void>;
  
  // 刪除角色
  handleDeleteRole(roleId: string): Promise<void>;
  
  // 組件渲染
  render(): JSX.Element;
}
```

### 7.2 權限控制組件

```typescript
// 權限守衛組件
interface PermissionGuardProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

class PermissionGuard {
  props: PermissionGuardProps;
  
  // 權限檢查
  checkPermission(): boolean;
  
  // 條件渲染
  render(): JSX.Element;
}

// 組織守衛組件
interface OrganizationGuardProps {
  children: React.ReactNode;
}

class OrganizationGuard {
  props: OrganizationGuardProps;
  
  // 組織檢查
  checkOrganizationAccess(): boolean;
  
  // 載入狀態處理
  renderLoading(): JSX.Element;
  
  // 無組織狀態處理
  renderNoOrganization(): JSX.Element;
  
  // 組件渲染
  render(): JSX.Element;
}
```

## 8. 工具類別

### 8.1 權限工具類別

```typescript
// 權限檢查工具
class PermissionUtils {
  // 檢查權限
  static hasPermission(userPermissions: Record<string, boolean>, permission: string): boolean;
  
  // 檢查多個權限
  static hasAnyPermission(userPermissions: Record<string, boolean>, permissions: string[]): boolean;
  
  // 檢查所有權限
  static hasAllPermissions(userPermissions: Record<string, boolean>, permissions: string[]): boolean;
  
  // 合併權限
  static mergePermissions(...permissionSets: Record<string, boolean>[]): Record<string, boolean>;
  
  // 權限差異比較
  static comparePermissions(oldPermissions: Record<string, boolean>, newPermissions: Record<string, boolean>): {
    added: string[];
    removed: string[];
    unchanged: string[];
  };
}

// 組織工具類別
class OrganizationUtils {
  // 驗證組織存取權限
  static async validateOrganizationAccess(userId: string, organizationId: string): Promise<boolean>;
  
  // 獲取使用者當前組織
  static getCurrentOrganization(): Organization | null;
  
  // 設定當前組織
  static setCurrentOrganization(organizationId: string): void;
  
  // 清除組織快取
  static clearOrganizationCache(): void;
}
```

### 8.2 數據驗證類別

```typescript
// 組織數據驗證
class OrganizationValidation {
  // 驗證組織名稱
  static validateOrganizationName(name: string): ValidationResult;
  
  // 驗證角色名稱
  static validateRoleName(name: string): ValidationResult;
  
  // 驗證權限配置
  static validatePermissions(permissions: Record<string, boolean>): ValidationResult;
  
  // 驗證使用者邀請
  static validateUserInvitation(email: string, roleIds: string[]): ValidationResult;
}

// 多租戶數據驗證
class MultiTenantValidation {
  // 驗證資源歸屬
  static async validateResourceOwnership(resourceId: string, resourceType: string, organizationId: string): Promise<boolean>;
  
  // 驗證組織隔離
  static validateOrganizationIsolation(data: any): ValidationResult;
  
  // 驗證跨組織操作
  static validateCrossOrganizationOperation(sourceOrgId: string, targetOrgId: string, userId: string): Promise<boolean>;
}
```

## 9. 類別關係圖

### 9.1 組織管理關係圖

```
Organization (1) ←──→ (n) UserOrganization ←──→ (1) User
     ↓                        ↓
     (1)                      (1)
     ↓                        ↓
OrganizationRole (n) ←──→ (n) UserOrganizationRole
```

### 9.2 業務實體關係圖

```
Organization (1) ───→ (n) Product
     ↓                    ↓
     (1)                  (1)
     ↓                    ↓
Customer (n) ←──→ (n) Order ←──→ (n) OrderProduct
     ↓                    ↓
     (1)                  (1)
     ↓                    ↓
Shipping (n) ←──────────→ (1) InventoryRoll
```

### 9.3 權限管理關係圖

```
User (1) ───→ (n) UserOrganizationRole ←──→ (1) OrganizationRole
     ↓                                              ↓
     (1)                                            (1)
     ↓                                              ↓
UserOrganization ←──────→ (1) Organization ←──→ (n) OrganizationRole
```

## 10. 設計模式應用

### 10.1 工廠模式

```typescript
// 角色工廠
class RoleFactory {
  static createSystemRole(organizationId: string, roleType: SystemRoleType): OrganizationRole;
  static createCustomRole(organizationId: string, data: CreateRoleData): OrganizationRole;
}

// 權限檢查器工廠
class PermissionCheckerFactory {
  static createChecker(userId: string, organizationId: string): PermissionGuard;
  static createOrganizationChecker(userId: string): OrganizationAccessChecker;
}
```

### 10.2 觀察者模式

```typescript
// 組織變更觀察者
interface OrganizationChangeObserver {
  onOrganizationSwitch(newOrganizationId: string): void;
  onOrganizationUpdate(organization: Organization): void;
  onMembershipChange(membership: UserOrganization): void;
}

class OrganizationChangeNotifier {
  private observers: OrganizationChangeObserver[] = [];
  
  addObserver(observer: OrganizationChangeObserver): void;
  removeObserver(observer: OrganizationChangeObserver): void;
  notifyOrganizationSwitch(organizationId: string): void;
  notifyOrganizationUpdate(organization: Organization): void;
}
```

### 10.3 策略模式

```typescript
// 權限檢查策略
interface PermissionStrategy {
  check(userId: string, organizationId: string, permission: string): Promise<boolean>;
}

class OwnerPermissionStrategy implements PermissionStrategy {
  async check(userId: string, organizationId: string): Promise<boolean> {
    // 組織擁有者檢查邏輯
  }
}

class RoleBasedPermissionStrategy implements PermissionStrategy {
  async check(userId: string, organizationId: string, permission: string): Promise<boolean> {
    // 角色權限檢查邏輯
  }
}

class PermissionChecker {
  private strategies: PermissionStrategy[];
  
  constructor(strategies: PermissionStrategy[]) {
    this.strategies = strategies;
  }
  
  async hasPermission(userId: string, organizationId: string, permission: string): Promise<boolean> {
    for (const strategy of this.strategies) {
      if (await strategy.check(userId, organizationId, permission)) {
        return true;
      }
    }
    return false;
  }
}
```

## 11. 測試類別設計

### 11.1 單元測試類別

```typescript
// 組織管理測試
class OrganizationServiceTest {
  testCreateOrganization(): void;
  testInviteUser(): void;
  testSwitchOrganization(): void;
  testOrganizationPermissions(): void;
}

// 權限檢查測試
class PermissionGuardTest {
  testOwnerPermissions(): void;
  testRolePermissions(): void;
  testPermissionInheritance(): void;
  testCrossOrganizationAccess(): void;
}
```

### 11.2 整合測試類別

```typescript
// 多租戶整合測試
class MultiTenantIntegrationTest {
  testDataIsolation(): void;
  testOrganizationSwitching(): void;
  testPermissionInheritance(): void;
  testCrossOrganizationSecurity(): void;
}
```

---

**文檔版本**: 2.0  
**最後更新**: 2025-06-17  
**負責人**: 架構團隊  
**審查週期**: 每週一次
