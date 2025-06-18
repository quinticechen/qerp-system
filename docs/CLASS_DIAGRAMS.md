
# 紡織業 ERP 系統類別圖文檔

## 概述

本文檔包含紡織業 ERP 系統的完整類別圖設計，基於 PRD 和序列圖建立。每個類別都詳細描述了其屬性、方法和與其他類別的關係，確保架構設計與業務需求完全對應。

## 1. 核心實體類別 (Entity Classes)

### 1.1 使用者管理

#### User
```typescript
class User {
  // 屬性
  private id: string
  private email: string
  private password: string
  private role: UserRole
  private isActive: boolean
  private createdAt: Date
  private updatedAt: Date

  // 方法
  public constructor(email: string, password: string, role: UserRole)
  public authenticate(password: string): boolean
  public updateProfile(data: UserUpdateData): void
  public changePassword(oldPassword: string, newPassword: string): boolean
  public deactivate(): void
  public hasPermission(permission: Permission): boolean
}
```

#### UserRole
```typescript
enum UserRole {
  SALES = "業務",
  ASSISTANT = "助理",
  ACCOUNTANT = "會計",
  WAREHOUSE_MANAGER = "倉庫管理員",
  EXECUTIVE = "高層"
}
```

#### Permission
```typescript
enum Permission {
  CREATE_PRODUCT = "CREATE_PRODUCT",
  VIEW_ORDERS = "VIEW_ORDERS",
  CREATE_ORDER = "CREATE_ORDER",
  UPDATE_ORDER_STATUS = "UPDATE_ORDER_STATUS",
  UPDATE_PAYMENT_STATUS = "UPDATE_PAYMENT_STATUS",
  CREATE_PURCHASE_ORDER = "CREATE_PURCHASE_ORDER",
  MANAGE_INVENTORY = "MANAGE_INVENTORY",
  CREATE_SHIPMENT = "CREATE_SHIPMENT",
  VIEW_REPORTS = "VIEW_REPORTS",
  MANAGE_USERS = "MANAGE_USERS"
}
```

### 1.2 產品管理

#### Product
```typescript
class Product {
  // 屬性
  private id: string
  private name: string
  private category: string = "布料"
  private color: string
  private colorCode: string
  private unit: string = "KG"
  private stockThreshold: number
  private createdBy: string
  private createdAt: Date
  private updatedAt: Date

  // 方法
  public constructor(name: string, color: string, colorCode: string)
  public updateInfo(data: ProductUpdateData): void
  public setStockThreshold(threshold: number): void
  public isLowStock(currentStock: number): boolean
  public getDisplayName(): string
}
```

### 1.3 客戶與供應商管理

#### Customer
```typescript
class Customer {
  // 屬性
  private id: string
  private name: string
  private contactPerson: string
  private phone: string
  private email: string
  private address: string
  private isActive: boolean
  private createdAt: Date
  private updatedAt: Date

  // 方法
  public constructor(name: string, contactPerson: string, phone: string)
  public updateContactInfo(data: CustomerUpdateData): void
  public deactivate(): void
  public getFullInfo(): CustomerInfo
}
```

#### Supplier
```typescript
class Supplier {
  // 屬性
  private id: string
  private name: string
  private contactPerson: string
  private phone: string
  private email: string
  private address: string
  private isActive: boolean
  private createdAt: Date
  private updatedAt: Date

  // 方法
  public constructor(name: string, contactPerson: string, phone: string)
  public updateContactInfo(data: SupplierUpdateData): void
  public deactivate(): void
  public getFullInfo(): SupplierInfo
}
```

### 1.4 訂單管理

#### Order
```typescript
class Order {
  // 屬性
  private id: string
  private orderNumber: string
  private customerId: string
  private status: OrderStatus
  private paymentStatus: PaymentStatus
  private shippingStatus: ShippingStatus
  private totalAmount: number
  private totalWeight: number
  private notes: string
  private createdBy: string
  private createdAt: Date
  private updatedAt: Date
  private orderItems: OrderItem[]

  // 方法
  public constructor(customerId: string, createdBy: string)
  public addItem(item: OrderItem): void
  public removeItem(itemId: string): void
  public updateStatus(status: OrderStatus): void
  public updatePaymentStatus(status: PaymentStatus): void
  public updateShippingStatus(status: ShippingStatus): void
  public calculateTotals(): void
  public canBeModified(): boolean
  public canBeCancelled(): boolean
}
```

#### OrderItem
```typescript
class OrderItem {
  // 屬性
  private id: string
  private orderId: string
  private productId: string
  private specifications: string
  private quantity: number
  private estimatedRolls: number
  private unitPrice: number
  private totalPrice: number

  // 方法
  public constructor(productId: string, quantity: number, unitPrice: number)
  public updateQuantity(quantity: number): void
  public updatePrice(unitPrice: number): void
  public updateSpecifications(specs: string): void
  public calculateTotalPrice(): void
}
```

#### OrderStatus
```typescript
enum OrderStatus {
  PENDING = "待處理",
  CONFIRMED = "已確認",
  PARTIAL_SHIPPED = "部分出貨",
  COMPLETED = "已完成",
  CANCELLED = "已取消"
}
```

#### PaymentStatus
```typescript
enum PaymentStatus {
  UNPAID = "未付款",
  PARTIAL_PAID = "部分付款",
  PAID = "已付款"
}
```

#### ShippingStatus
```typescript
enum ShippingStatus {
  NOT_STARTED = "未開始",
  PARTIAL_SHIPPED = "部分出貨",
  SHIPPED = "已出貨"
}
```

### 1.5 採購管理

#### PurchaseOrder
```typescript
class PurchaseOrder {
  // 屬性
  private id: string
  private purchaseNumber: string
  private supplierId: string
  private linkedOrderId?: string
  private status: PurchaseStatus
  private orderDate: Date
  private expectedDeliveryDate: Date
  private actualDeliveryDate?: Date
  private totalAmount: number
  private totalWeight: number
  private createdBy: string
  private createdAt: Date
  private updatedAt: Date
  private purchaseItems: PurchaseItem[]

  // 方法
  public constructor(supplierId: string, expectedDeliveryDate: Date, createdBy: string)
  public addItem(item: PurchaseItem): void
  public removeItem(itemId: string): void
  public updateStatus(status: PurchaseStatus): void
  public confirmOrder(): void
  public markAsDelivered(deliveryDate: Date): void
  public calculateTotals(): void
  public canBeModified(): boolean
}
```

#### PurchaseItem
```typescript
class PurchaseItem {
  // 屬性
  private id: string
  private purchaseOrderId: string
  private productId: string
  private specifications: string
  private quantity: number
  private estimatedRolls: number
  private unitPrice: number
  private totalPrice: number

  // 方法
  public constructor(productId: string, quantity: number, unitPrice: number)
  public updateQuantity(quantity: number): void
  public updatePrice(unitPrice: number): void
  public updateSpecifications(specs: string): void
  public calculateTotalPrice(): void
}
```

#### PurchaseStatus
```typescript
enum PurchaseStatus {
  PENDING = "待確認",
  CONFIRMED = "已下單",
  PARTIAL_DELIVERED = "部分到貨",
  COMPLETED = "已完成",
  CANCELLED = "已取消"
}
```

### 1.6 庫存管理

#### InventoryBatch
```typescript
class InventoryBatch {
  // 屬性
  private id: string
  private purchaseOrderId: string
  private receivedDate: Date
  private totalQuantity: number
  private totalRolls: number
  private createdBy: string
  private createdAt: Date
  private rolls: FabricRoll[]

  // 方法
  public constructor(purchaseOrderId: string, receivedDate: Date, createdBy: string)
  public addRoll(roll: FabricRoll): void
  public calculateTotals(): void
  public getRollsByProduct(productId: string): FabricRoll[]
  public getAvailableRolls(): FabricRoll[]
}
```

#### FabricRoll
```typescript
class FabricRoll {
  // 屬性
  private id: string
  private rollNumber: string
  private productId: string
  private warehouseId: string
  private shelfLocation: string
  private originalWeight: number
  private currentWeight: number
  private qualityGrade: QualityGrade
  private isAvailable: boolean
  private inventoryBatchId: string
  private createdAt: Date
  private updatedAt: Date

  // 方法
  public constructor(rollNumber: string, productId: string, weight: number, qualityGrade: QualityGrade)
  public updateLocation(warehouseId: string, shelfLocation: string): void
  public reduceWeight(usedWeight: number): void
  public markAsUnavailable(): void
  public getUsagePercentage(): number
  public canBeUsed(): boolean
}
```

#### Warehouse
```typescript
class Warehouse {
  // 屬性
  private id: string
  private name: string
  private location: string
  private capacity: number
  private isActive: boolean

  // 方法
  public constructor(name: string, location: string, capacity: number)
  public updateInfo(data: WarehouseUpdateData): void
  public getCurrentUsage(): number
  public getAvailableSpace(): number
}
```

#### QualityGrade
```typescript
enum QualityGrade {
  A_GRADE = "A級",
  B_GRADE = "B級",
  DEFECTIVE = "瑕疵品"
}
```

### 1.7 出貨管理

#### Shipment
```typescript
class Shipment {
  // 屬性
  private id: string
  private shipmentNumber: string
  private orderId: string
  private shipmentDate: Date
  private totalWeight: number
  private totalRolls: number
  private createdBy: string
  private createdAt: Date
  private shipmentItems: ShipmentItem[]

  // 方法
  public constructor(orderId: string, shipmentDate: Date, createdBy: string)
  public addItem(item: ShipmentItem): void
  public removeItem(itemId: string): void
  public calculateTotals(): void
  public updateOrderStatus(): void
  public getShipmentSummary(): ShipmentSummary
}
```

#### ShipmentItem
```typescript
class ShipmentItem {
  // 屬性
  private id: string
  private shipmentId: string
  private fabricRollId: string
  private shippedWeight: number
  private isWholeRoll: boolean

  // 方法
  public constructor(fabricRollId: string, shippedWeight: number, isWholeRoll: boolean)
  public updateShippedWeight(weight: number): void
  public updateInventory(): void
  public getFabricRollInfo(): FabricRoll
}
```

## 2. 服務類別 (Service Classes)

### 2.1 認證與授權服務

#### AuthService
```typescript
class AuthService {
  // 方法
  public login(email: string, password: string): Promise<AuthResult>
  public logout(): Promise<void>
  public verifyToken(token: string): Promise<User>
  public refreshToken(refreshToken: string): Promise<string>
  public checkPermission(userId: string, permission: Permission): Promise<boolean>
  public resetPassword(email: string): Promise<void>
  public changePassword(userId: string, oldPassword: string, newPassword: string): Promise<boolean>
}
```

### 2.2 產品服務

#### ProductService
```typescript
class ProductService {
  // 方法
  public createProduct(data: CreateProductData): Promise<Product>
  public getProductById(id: string): Promise<Product>
  public updateProduct(id: string, data: UpdateProductData): Promise<Product>
  public deleteProduct(id: string): Promise<void>
  public searchProducts(criteria: ProductSearchCriteria): Promise<Product[]>
  public setStockThreshold(productId: string, threshold: number): Promise<void>
  public getProductsWithLowStock(): Promise<Product[]>
}
```

### 2.3 客戶服務

#### CustomerService
```typescript
class CustomerService {
  // 方法
  public createCustomer(data: CreateCustomerData): Promise<Customer>
  public getCustomerById(id: string): Promise<Customer>
  public updateCustomer(id: string, data: UpdateCustomerData): Promise<Customer>
  public deleteCustomer(id: string): Promise<void>
  public searchCustomers(criteria: CustomerSearchCriteria): Promise<Customer[]>
  public getCustomerOrders(customerId: string): Promise<Order[]>
}
```

### 2.4 供應商服務

#### SupplierService
```typescript
class SupplierService {
  // 方法
  public createSupplier(data: CreateSupplierData): Promise<Supplier>
  public getSupplierById(id: string): Promise<Supplier>
  public updateSupplier(id: string, data: UpdateSupplierData): Promise<Supplier>
  public deleteSupplier(id: string): Promise<void>
  public searchSuppliers(criteria: SupplierSearchCriteria): Promise<Supplier[]>
  public getSupplierPurchaseOrders(supplierId: string): Promise<PurchaseOrder[]>
}
```

### 2.5 訂單服務

#### OrderService
```typescript
class OrderService {
  // 方法
  public createOrder(data: CreateOrderData): Promise<Order>
  public getOrderById(id: string): Promise<Order>
  public updateOrder(id: string, data: UpdateOrderData): Promise<Order>
  public updateOrderStatus(id: string, status: OrderStatus): Promise<Order>
  public updatePaymentStatus(id: string, status: PaymentStatus): Promise<Order>
  public cancelOrder(id: string): Promise<Order>
  public searchOrders(criteria: OrderSearchCriteria): Promise<Order[]>
  public getOrdersByCustomer(customerId: string): Promise<Order[]>
  public getOrdersByDateRange(startDate: Date, endDate: Date): Promise<Order[]>
  public addOrderItem(orderId: string, item: CreateOrderItemData): Promise<OrderItem>
  public removeOrderItem(orderId: string, itemId: string): Promise<void>
}
```

### 2.6 採購服務

#### PurchaseService
```typescript
class PurchaseService {
  // 方法
  public createPurchaseOrder(data: CreatePurchaseOrderData): Promise<PurchaseOrder>
  public getPurchaseOrderById(id: string): Promise<PurchaseOrder>
  public updatePurchaseOrder(id: string, data: UpdatePurchaseOrderData): Promise<PurchaseOrder>
  public updatePurchaseStatus(id: string, status: PurchaseStatus): Promise<PurchaseOrder>
  public confirmPurchaseOrder(id: string): Promise<PurchaseOrder>
  public cancelPurchaseOrder(id: string): Promise<PurchaseOrder>
  public searchPurchaseOrders(criteria: PurchaseSearchCriteria): Promise<PurchaseOrder[]>
  public getPurchaseOrdersBySupplier(supplierId: string): Promise<PurchaseOrder[]>
  public addPurchaseItem(poId: string, item: CreatePurchaseItemData): Promise<PurchaseItem>
  public removePurchaseItem(poId: string, itemId: string): Promise<void>
}
```

### 2.7 庫存服務

#### InventoryService
```typescript
class InventoryService {
  // 方法
  public createInventoryBatch(data: CreateInventoryBatchData): Promise<InventoryBatch>
  public addFabricRoll(batchId: string, rollData: CreateFabricRollData): Promise<FabricRoll>
  public updateFabricRollLocation(rollId: string, warehouseId: string, shelfLocation: string): Promise<FabricRoll>
  public getFabricRollById(id: string): Promise<FabricRoll>
  public searchInventory(criteria: InventorySearchCriteria): Promise<FabricRoll[]>
  public getAvailableRollsForProduct(productId: string): Promise<FabricRoll[]>
  public getCurrentStock(productId: string): Promise<number>
  public getTotalStockByWarehouse(warehouseId: string): Promise<InventoryStockSummary>
  public getStockHistory(rollId: string): Promise<StockHistoryEntry[]>
  public checkLowStockProducts(): Promise<Product[]>
}
```

### 2.8 出貨服務

#### ShipmentService
```typescript
class ShipmentService {
  // 方法
  public createShipment(data: CreateShipmentData): Promise<Shipment>
  public getShipmentById(id: string): Promise<Shipment>
  public addShipmentItem(shipmentId: string, item: CreateShipmentItemData): Promise<ShipmentItem>
  public removeShipmentItem(shipmentId: string, itemId: string): Promise<void>
  public processShipment(shipmentId: string): Promise<void>
  public getShipmentsByOrder(orderId: string): Promise<Shipment[]>
  public getShipmentHistory(criteria: ShipmentSearchCriteria): Promise<Shipment[]>
  public getShipmentsByDateRange(startDate: Date, endDate: Date): Promise<Shipment[]>
}
```

### 2.9 報表服務

#### ReportService
```typescript
class ReportService {
  // 方法
  public generateSalesReport(criteria: SalesReportCriteria): Promise<SalesReport>
  public generateInventoryReport(criteria: InventoryReportCriteria): Promise<InventoryReport>
  public generateMonthlySalesReport(year: number, month: number): Promise<MonthlySalesReport>
  public generateCustomerReport(customerId: string, criteria: CustomerReportCriteria): Promise<CustomerReport>
  public generateSupplierReport(supplierId: string, criteria: SupplierReportCriteria): Promise<SupplierReport>
  public getDashboardMetrics(): Promise<DashboardMetrics>
  public getBusinessPerformanceReport(salesPersonId: string, criteria: PerformanceReportCriteria): Promise<BusinessPerformanceReport>
}
```

### 2.10 預警服務

#### AlertService
```typescript
class AlertService {
  // 方法
  public checkLowStockAlerts(): Promise<void>
  public sendLowStockAlert(productId: string, currentStock: number, threshold: number): Promise<void>
  public createCustomAlert(criteria: AlertCriteria): Promise<Alert>
  public getActiveAlerts(userId: string): Promise<Alert[]>
  public markAlertAsRead(alertId: string): Promise<void>
  public deleteAlert(alertId: string): Promise<void>
  public scheduleRecurringCheck(): Promise<void>
}
```

## 3. 控制器類別 (Controller Classes)

### 3.1 API 控制器

#### AuthController
```typescript
class AuthController {
  private authService: AuthService

  public login(request: LoginRequest): Promise<LoginResponse>
  public logout(request: LogoutRequest): Promise<void>
  public refreshToken(request: RefreshTokenRequest): Promise<RefreshTokenResponse>
  public resetPassword(request: ResetPasswordRequest): Promise<void>
  public changePassword(request: ChangePasswordRequest): Promise<void>
}
```

#### ProductController
```typescript
class ProductController {
  private productService: ProductService

  public create(request: CreateProductRequest): Promise<ProductResponse>
  public getById(id: string): Promise<ProductResponse>
  public update(id: string, request: UpdateProductRequest): Promise<ProductResponse>
  public delete(id: string): Promise<void>
  public search(request: SearchProductRequest): Promise<ProductListResponse>
  public setStockThreshold(id: string, request: SetThresholdRequest): Promise<void>
}
```

#### OrderController
```typescript
class OrderController {
  private orderService: OrderService

  public create(request: CreateOrderRequest): Promise<OrderResponse>
  public getById(id: string): Promise<OrderResponse>
  public update(id: string, request: UpdateOrderRequest): Promise<OrderResponse>
  public updateStatus(id: string, request: UpdateStatusRequest): Promise<OrderResponse>
  public updatePaymentStatus(id: string, request: UpdatePaymentStatusRequest): Promise<OrderResponse>
  public cancel(id: string): Promise<OrderResponse>
  public search(request: SearchOrderRequest): Promise<OrderListResponse>
  public addItem(id: string, request: AddOrderItemRequest): Promise<OrderItemResponse>
  public removeItem(id: string, itemId: string): Promise<void>
}
```

#### InventoryController
```typescript
class InventoryController {
  private inventoryService: InventoryService

  public createBatch(request: CreateInventoryBatchRequest): Promise<InventoryBatchResponse>
  public addRoll(batchId: string, request: AddFabricRollRequest): Promise<FabricRollResponse>
  public updateRollLocation(rollId: string, request: UpdateLocationRequest): Promise<FabricRollResponse>
  public searchInventory(request: SearchInventoryRequest): Promise<InventoryListResponse>
  public getCurrentStock(productId: string): Promise<StockResponse>
  public getStockHistory(rollId: string): Promise<StockHistoryResponse>
}
```

#### ShipmentController
```typescript
class ShipmentController {
  private shipmentService: ShipmentService

  public create(request: CreateShipmentRequest): Promise<ShipmentResponse>
  public getById(id: string): Promise<ShipmentResponse>
  public addItem(id: string, request: AddShipmentItemRequest): Promise<ShipmentItemResponse>
  public removeItem(id: string, itemId: string): Promise<void>
  public process(id: string): Promise<void>
  public getHistory(request: SearchShipmentRequest): Promise<ShipmentListResponse>
}
```

#### ReportController
```typescript
class ReportController {
  private reportService: ReportService

  public generateSalesReport(request: SalesReportRequest): Promise<SalesReportResponse>
  public generateInventoryReport(request: InventoryReportRequest): Promise<InventoryReportResponse>
  public getMonthlySalesReport(year: number, month: number): Promise<MonthlySalesReportResponse>
  public getDashboardMetrics(): Promise<DashboardMetricsResponse>
  public getBusinessPerformanceReport(salesPersonId: string, request: PerformanceReportRequest): Promise<BusinessPerformanceReportResponse>
}
```

## 4. 資料傳輸物件 (DTO Classes)

### 4.1 請求 DTO

#### CreateProductRequest
```typescript
interface CreateProductRequest {
  name: string
  color: string
  colorCode: string
  stockThreshold?: number
}
```

#### CreateOrderRequest
```typescript
interface CreateOrderRequest {
  customerId: string
  notes?: string
  items: CreateOrderItemRequest[]
}
```

#### CreateOrderItemRequest
```typescript
interface CreateOrderItemRequest {
  productId: string
  specifications: string
  quantity: number
  estimatedRolls: number
  unitPrice: number
}
```

#### CreateShipmentRequest
```typescript
interface CreateShipmentRequest {
  orderId: string
  shipmentDate: Date
  items: CreateShipmentItemRequest[]
}
```

#### CreateShipmentItemRequest
```typescript
interface CreateShipmentItemRequest {
  fabricRollId: string
  shippedWeight: number
  isWholeRoll: boolean
}
```

### 4.2 回應 DTO

#### ProductResponse
```typescript
interface ProductResponse {
  id: string
  name: string
  color: string
  colorCode: string
  unit: string
  stockThreshold: number
  createdAt: Date
  updatedAt: Date
}
```

#### OrderResponse
```typescript
interface OrderResponse {
  id: string
  orderNumber: string
  customer: CustomerBasicInfo
  status: OrderStatus
  paymentStatus: PaymentStatus
  shippingStatus: ShippingStatus
  totalAmount: number
  totalWeight: number
  notes: string
  createdAt: Date
  updatedAt: Date
  items: OrderItemResponse[]
}
```

#### OrderItemResponse
```typescript
interface OrderItemResponse {
  id: string
  product: ProductBasicInfo
  specifications: string
  quantity: number
  estimatedRolls: number
  unitPrice: number
  totalPrice: number
}
```

## 5. 工具類別 (Utility Classes)

### 5.1 驗證工具

#### Validator
```typescript
class Validator {
  public static validateEmail(email: string): boolean
  public static validatePhone(phone: string): boolean
  public static validatePassword(password: string): ValidationResult
  public static validateColorCode(colorCode: string): boolean
  public static validateWeight(weight: number): boolean
  public static validateQuantity(quantity: number): boolean
}
```

### 5.2 格式化工具

#### Formatter
```typescript
class Formatter {
  public static formatCurrency(amount: number): string
  public static formatWeight(weight: number): string
  public static formatDate(date: Date): string
  public static formatDateTime(date: Date): string
  public static formatOrderNumber(orderNumber: string): string
  public static formatRollNumber(rollNumber: string): string
}
```

### 5.3 計算工具

#### Calculator
```typescript
class Calculator {
  public static calculateOrderTotal(items: OrderItem[]): number
  public static calculateWeightTotal(items: OrderItem[]): number
  public static calculateShipmentTotal(items: ShipmentItem[]): number
  public static calculateStockUsagePercentage(originalWeight: number, currentWeight: number): number
  public static calculateTax(amount: number, taxRate: number): number
}
```

## 6. 類別關係圖

### 6.1 繼承關係
- BaseEntity ← User, Product, Customer, Supplier, Order, PurchaseOrder
- BaseService ← ProductService, OrderService, InventoryService, etc.
- BaseController ← ProductController, OrderController, etc.

### 6.2 組合關係
- Order → OrderItem (1:N)
- PurchaseOrder → PurchaseItem (1:N)
- InventoryBatch → FabricRoll (1:N)
- Shipment → ShipmentItem (1:N)

### 6.3 聚合關係
- Customer → Order (1:N)
- Supplier → PurchaseOrder (1:N)
- Product → OrderItem (1:N)
- Product → PurchaseItem (1:N)
- Product → FabricRoll (1:N)

### 6.4 依賴關係
- Controller → Service
- Service → Entity
- Service → Repository
- Entity → DTO

## 7. 設計模式應用

### 7.1 Factory Pattern
- OrderFactory: 用於建立不同類型的訂單
- ReportFactory: 用於建立不同類型的報表

### 7.2 Strategy Pattern
- AlertStrategy: 不同的預警策略
- ReportStrategy: 不同的報表生成策略

### 7.3 Observer Pattern
- OrderStatusObserver: 監聽訂單狀態變更
- InventoryObserver: 監聽庫存變更

### 7.4 Command Pattern
- OrderCommand: 處理訂單相關操作
- InventoryCommand: 處理庫存相關操作

## 總結

這個類別圖設計涵蓋了紡織業 ERP 系統的所有核心功能：

1. **完整的實體模型**：包含使用者、產品、訂單、採購、庫存、出貨等核心業務實體
2. **清晰的服務架構**：每個業務領域都有對應的服務類別
3. **標準的 API 介面**：控制器類別提供標準的 REST API 介面
4. **完善的資料傳輸**：DTO 類別確保資料的正確傳輸
5. **實用的工具支援**：驗證、格式化、計算等工具類別
6. **良好的設計模式**：應用工廠、策略、觀察者等設計模式

這個設計與 PRD 和序列圖完全對應，為後續的單元測試撰寫和程式實作提供了清晰的藍圖。
