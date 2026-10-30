# Phase 1 Business APIs: Plan and Decisions

> Requirement document (RBAC Session). The plan, progress and decisions from the former `docs/BUSINESS_API.md`; the current specification of each API moved to [../API.md](../API.md) (§2 shared rules, §3 business APIs). All Phase 1 business APIs are done (2026-10-09).

## 1. Goals

Package the writes of 12 features as database APIs (RPCs), so the frontend and AI tools call the same logic:

1. Permissions, organization scope and data validation all happen inside the API, so the frontend and AI no longer each write their own
2. Every write API has a dry-run mode, so the AI's confirmation card and the real write go through the same validation
3. Once the frontend uses the APIs, the business tables' RLS is tightened by permission key (MULTI_TENANT_RBAC.md R4)

Reads: single-table reads keep querying the table directly + RLS (Phase 0 D1); cross-table reads (such as an order with its lines and shipping progress) get an RPC or a `security_invoker` view as the AI needs them.

## 3. API catalog

Status: ⏳ planned, 🔧 in progress, ✅ done (API and frontend switch both done, and marked in SESSION_COORDINATION.md §5).

### Flow 1: main order flow

| Group | API | Permission key | Description | Status |
|-------|-----|----------------|-------------|--------|
| A1 Customers | `create_customer` | `canCreateCustomers` | Name and contact person required; at least one of mobile or landline; no duplicate names in the same organization | ✅ |
| | `update_customer` | `canEditCustomers` | `p_changes` | ✅ |
| | `set_customer_active` | `canEditCustomers` | Once deactivated, not shown in the customer menu when creating documents; existing documents are unaffected | ✅ |
| A2 Orders | `create_order` | `canCreateOrders` | Customer, lines (product, quantity, unit price, rolls, specification), assigned factories, note; returns the order number | ✅ |
| | `update_order` | `canEditOrders` | Lines (keeping the locking rules of `save_order_items`), factories, note, payment status | ✅ |
| | `cancel_order` | `canEditOrders` | Can't be cancelled once it has shippings or active purchase orders | ✅ |
| A3 Purchasing | `create_purchase_order` | `canCreatePurchases` | Factory, linked orders, lines, order date, expected arrival date; linked orders become 「已向工廠下單」 (ordered from factory) | ✅ |
| | `update_purchase_order` | `canEditPurchases` | Keeps the locking rules of `save_purchase_order_items` | ✅ |
| | `cancel_purchase_order` | `canEditPurchases` | Can't be cancelled once received; linked orders with no other active purchase order go back to 「已確認」 (confirmed) | ✅ |
| A4 Receiving | `receive_inventory` | `canCreateInventory` | Purchase order, arrival date, rolls (product, shelf, quality, weight, roll number); updates the purchase order's receiving progress | ✅ |
| | `update_inventory` | `canEditInventory` | Arrival date, note, rolls (keeping the locking rules of `save_inventory_rolls`) | ✅ |
| | `update_inventory_roll` | `canEditInventory` | A single roll's weight, quality, warehouse, shelf | ✅ |
| A5 Shipping | `create_shipping` | `canCreateShipping` | Order, shipping date, rolls and weights; deducts stock, updates the order's shipping progress | ✅ |
| | `update_shipping` | `canEditShipping` | Reuses `save_shipping_items` | ✅ |
| | `cancel_shipping` | `canEditShipping` | Returns roll stock, recomputes the order's shipping progress (decision B3) | ✅ |

### Flow 2: master data maintenance

| Group | API | Permission key | Status |
|-------|-----|----------------|--------|
| A1 Factories (same group as customers) | `create_factory`, `update_factory`, `set_factory_active` | `canCreateFactories` / `canEditFactories` | ✅ |
| A6 Products | `create_product`, `update_product`, `set_product_active`, `add_product_color`, `update_product_color`, `set_product_color_active` (two levels, see §7) | `canCreateProducts` / `canEditProducts` | ✅ |
| A6 Shelves | `create_shelf`, `update_shelf` (name, location), `set_shelf_active` | `canCreateShelves` / `canEditShelves` | ✅ |

Customers and factories have the same fields and rules, so they were done together in A1.

### Flow 3: admin features (read-only for the AI, Phase 0 D3)

| API | Permission key | Status |
|-----|----------------|--------|
| `set_member_role`, `set_member_active`, invitations | `canEditUsers` / `canCreateUsers` | ✅ (RBAC R1) |
| `update_organization_settings` | `canEditSystemSettings` | ⏳ (most of the organization settings page isn't wired to features yet; first confirm which settings to keep) |

## 4. Delivery checklist for each API group

1. Migration: the API, any needed columns (such as `is_active`), permission and organization checks
2. SQL rollback test `supabase/tests/api_<group>.test.sql`:
   - Permission matrix: viewer rejected, editor allowed, someone from another organization rejected
   - Referencing another organization's data is always "not found"
   - Dry-run mode writes no data, and returns the same `summary` as the real write
   - At least one case per error code
3. Frontend switched to the API (`src/lib/api/*.ts`), removing code that writes tables directly; `types.ts` updated locally
4. Add the API description to [API.md](../API.md) §3 (parameters, return value, error codes)
5. Mark "API done" in SESSION_COORDINATION.md §5 and notify the AI Session
6. The RBAC Session then tightens the RLS of that group's tables (R4)

## 6. Decisions

| # | Question | Recommendation |
|---|----------|----------------|
| B1 | Error format: SQLSTATE for the category, a fixed code in `HINT`, the message in Chinese ([API.md](../API.md) §2.3) | Adopted |
| B2 | Document dry runs really write in a subtransaction and then roll back ([API.md](../API.md) §2.4), and the API generates numbers per organization instead ([API.md](../API.md) §2.5) | ✅ Confirmed (2026-10-08) |
| B3 | Shippings currently have no status column. Should "cancel shipping" be offered? If so: add a status column, and on cancel return roll stock and recompute the order's shipping progress | ✅ Confirmed, offered (2026-10-08) |
| B4 | Add `is_active` to customers, factories and shelves; deactivated records don't appear in new-document menus, but existing documents show them as usual | Adopted |
| B5 | The products' `UNIQUE (name, color, color_code)` is global, so two organizations can't have a product with the same name and color | ✅ Confirmed: changed to unique within the organization (A6; product structure also see B7) |
| B6 | No duplicate customer or factory names within one organization | Adopted (checked only on create and rename; existing data unaffected) |
| B7 | Products become two levels: product (parent) + color (child), see §7 | ✅ Confirmed (2026-10-08) |
| B8 | Unified transaction document numbers "letter + YYYYMMDD + four-digit sequence" (B orders, P purchase orders, I receipts, O shippings), see [API.md](../API.md) §2.5; existing documents keep their numbers | ✅ Confirmed (2026-10-08) |

## 7. Product structure (B7)

### 7.1 Data

Add a parent table `product_groups`; each existing row of `products_new` becomes a color, with a `group_id` added. Order lines, purchase lines, received rolls and shipping records already point to the color row, so **the links from documents and stock are unchanged**.

| Level | Table | Columns | Uniqueness |
|-------|-------|---------|------------|
| Product (parent) | `product_groups` | Name, category, unit, `is_active` | Name unique within the organization (case-insensitive) |
| Color (child) | `products_new` | `group_id`, color name, color code, color value (optional, e.g. `#C0392B`, for the swatch), safety stock, status | "Color + color code" unique within a product (replacing the global `UNIQUE (name, color, color_code)`, B5) |

- During the transition, color rows keep `name`, `category`, `unit_of_measure`, synced with the parent table by the API, so existing reads (lists, views, AI tools) don't all have to change at once; they move to the parent table gradually, and then the columns are removed
- Deactivation has two levels: deactivating a product = none of its colors appear in new-document menus; a single color can also be deactivated
- Migration: build the parent table by "organization + name" (checked 2026-10-08: products with the same name all had the same category and unit)
- Read-only view `product_catalog` (`security_invoker`): product, color, each color's stock weight and rolls, whether it's below safety stock; shared by the frontend and the AI

### 7.2 Screens

- The product page is an expandable two-level table: product rows show the number of colors, total stock and number of low-stock colors; expanding lists each color's color code, stock (weight / rolls), safety stock and status
- Search matches product name, color and color code together, and matching products expand automatically
- Several colors can be entered at once when adding a product; after expanding, "Add color" is available
- **Editing by level**: clicking a product row expands or collapses it; the product row's edit button edits the product (name, category, unit, status), with edit history recorded on the product; clicking a color row edits the color (color, color code, color value, safety stock, status), with edit history recorded on that color. When a product name change syncs to the color rows' names, it's recorded only on the product, not repeated on every color
- Product menus in orders, purchasing and shipping are grouped by product (「1601鳥眼布 › 17大紅」) and searchable with 「鳥眼 大紅」 (not implemented yet; to be done with A3 purchasing; A6 first makes the order-creation menu exclude deactivated products)

### 7.3 APIs

| API | Permission key | Description |
|-----|----------------|-------------|
| `create_product` | `canCreateProducts` | Product data + one or more colors |
| `update_product`, `set_product_active` | `canEditProducts` | Changes the parent level only; name, category and unit sync to the color rows |
| `add_product_color` | `canCreateProducts` | Adds a color under an existing product |
| `update_product_color`, `set_product_color_active` | `canEditProducts` | Changes a single color only |

### 7.4 Timing

Scheduled right after A2 orders (A6 moved up), so the order-creation dialog rewritten in A2 uses the grouped product menu directly, and A3 purchasing and A5 shipping reuse it.
