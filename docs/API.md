# API Documentation

> Current-state document (2026-10-09). The frontend and the AI tools both call database functions through Supabase (PostgREST); AI conversations also have their own HTTP server (§6). The development plan and decision record are in [requirements/PHASE1_BUSINESS_API.md](./requirements/PHASE1_BUSINESS_API.md).
>
> The app's UI is in Chinese, so user-facing strings returned by the APIs (`summary` titles and labels, error messages) are Chinese. Where this document quotes them, the Chinese text is the literal value and the English is a gloss.

## 1. Overview

| Category | How it's called | Description |
|----------|-----------------|-------------|
| Business APIs (§3) | `supabase.rpc('<name>', { ... })`, wrapped on the frontend in `src/lib/api/*.ts` | Every write of business data: customers, factories, products, shelves, orders, purchasing, receiving, shipping. Runs as the function owner and checks the permission key first |
| Organizations and members (§4) | `supabase.rpc(...)` | Member and ownership operations other than creating an organization, invitations |
| Read-only data (§5) | `supabase.from('<table or view>').select(...)` | Reads follow RLS and permission keys ([PERMISSIONS.md](./PERMISSIONS.md)) |
| AI server (§6) | HTTP, with a Supabase JWT | AI conversations, confirming writes the AI proposed, MCP |

What each table is for: [DATABASE_TABLES.md](./DATABASE_TABLES.md).

## 2. Shared rules (A0)

### 2.1 Functions

| Item | Rule |
|------|------|
| Name | `<action>_<object>`: `create_customer`, `update_customer`, `set_customer_active`, `create_order`, `cancel_order` |
| Parameters | Always prefixed `p_`; the first parameter is `p_organization_id`; the last is `p_dry_run boolean DEFAULT false` |
| Security | Implemented in the non-public `private` schema: `SECURITY DEFINER`, `SET search_path TO 'public'`; `public` holds only a same-named, same-parameter `SECURITY INVOKER` wrapper for PostgREST to call (`supabase.rpc('<name>')`). Granted only to `authenticated`. It first checks the permission key, then confirms that every referenced record (customer, product, order…) belongs to `p_organization_id`. The §4 organization and member RPCs and the permission functions have the same structure |
| Changing and adding | Change an implementation with `CREATE OR REPLACE FUNCTION private.<name>`, leaving the wrapper alone; **never** `CREATE OR REPLACE` the same-named function in public (it would overwrite the wrapper). A new API needs both, following `supabase/migrations/20261009140512_private_definer_functions.sql` |
| Permissions | Checked with `api_require_permission(p_organization_id, '<key>')`, which uses `user_has_organization_permission()` internally (the contract in [SESSION_COORDINATION.md](./SESSION_COORDINATION.md) §4) |
| Updates | Fields to change are passed in `p_changes jsonb`: fields not present are unchanged, and fields present as an empty string or `null` are cleared. This lets the AI change a single field, and lets the dry-run result list "old value → new value" |
| Deletes | Not offered. Master data is deactivated with `set_<object>_active`; documents are cancelled with `cancel_<object>` (R5) |

### 2.2 Return value

Every write API returns the same `jsonb`:

```json
{
  "dry_run": true,
  "id": null,
  "number": null,
  "summary": {
    "title": "建立客戶",
    "fields": [{ "label": "公司名稱", "value": "永泰布行" }, { "label": "聯絡人", "value": "陳先生" }]
  }
}
```

(`建立客戶` = Create customer; `公司名稱` = Company name; `聯絡人` = Contact person.)

- `id`: the ID after the write; `null` for a dry-run create
- `number`: a displayable number (order number, purchase order number, shipping number); `null` for objects without numbers
- `summary`: the content expressed with names, in the same format as the AI confirmation card; only fields with values are listed; for updates, `value` is "old value → new value" and only changed fields are listed

### 2.3 Errors

Errors are raised with `PERFORM public.api_fail('<class>', '<code>', '<Chinese message for the user>')` (since 2026-10-09; previously `RAISE ... USING ERRCODE, HINT`). Through PostgREST (the frontend's `supabase.rpc`, AI tools) the error arrives as `{ code: class, message: Chinese message, hint: code }`; the frontend and AI show `message` as is and use `hint` to tell cases apart, never showing the raw database error.

| Class (`code`) | HTTP status | Meaning | Example codes |
|----------------|-------------|---------|---------------|
| `42501` | 403 | Not signed in or no permission | `forbidden` |
| `P0002` | 404 | Not found (including belonging to another organization) | `customer_not_found`, `product_not_found` |
| `22023` | 400 | Invalid input | `name_required`, `phone_required`, `invalid_email` |
| `23505` | 409 | Duplicate | `customer_name_taken` |
| `55000` | 409 | Not allowed in the current state (e.g. can't cancel once shipped) | `order_has_shipments` |

`api_fail()` is implemented with PostgREST's custom error (SQLSTATE `PGRST`) so it can set the HTTP status; with a plain SQLSTATE, `P0002` and `55000` would become 500. Caught inside the database (SQL tests, other functions), the SQLSTATE is `PGRST`, with `code`, `message` and `hint` in the error message's JSON (`check_api_error_as` in `supabase/tests/_helpers.sql` unpacks it automatically). Always use `api_fail()` in new APIs.

Data belonging to another organization is always reported as "not found", without revealing that it exists.

### 2.4 Dry-run mode

- Simple writes (master data): after validating and building `summary`, return right away when `p_dry_run` is `true`, without writing
- Documents spanning several tables (orders, purchasing, receiving, shipping): **really write once** inside a subtransaction, take the complete validation result and `summary`, then roll back the subtransaction with an exception. A dry run and the real write therefore run exactly the same code and triggers
- A dry run must not consume sequence numbers: document numbers are computed by the API per organization (§2.5) instead of using a sequence

### 2.5 Data categories and document numbers (Phase 0 F14, B8)

| Category | Data |
|----------|------|
| Master data (Dim) | Customers, products, factories, users, shelves, permissions, system settings |
| Transactions (Fact) | Orders, purchase orders, receipts (receiving), shippings; inventory queries are aggregated from transactions |

Unified transaction document numbers: **category letter + YYYYMMDD + four-digit sequence**, unique within the organization, restarting daily by Taiwan date.

| Document | Letter | Example | Column |
|----------|--------|---------|--------|
| Order | B | `B202610080001` | `orders.order_number` |
| Purchase order | P | `P202610080001` | `purchase_orders.po_number` |
| Receipt | I | `I202610080001` | `inventories.receipt_number` (added in A2; existing receipts were numbered by creation date) |
| Shipping | O | `O202610080001` | `shippings.shipping_number` |

- `api_next_document_number()` takes an advisory lock on "organization + document type + date" within the transaction, then takes that day's highest number + 1; it doesn't use a sequence, so a rolled-back dry run leaves no gaps
- Documents created before 2026-10-08 keep their original numbers (for example `26K1007-097`, `PO-20261007-0027`, `SHIP-261007-001`)
- Writes that don't use the API yet (the frontend or AI tools writing tables directly) are numbered by a trigger; clients can't choose their own numbers

## 3. Business APIs

Every write API returns the §2.2 format, with errors per §2.3. Only what is specific to each API is listed below.

### A1 Customers and factories

Migration: `supabase/migrations/20261008170920_api_a1_customers_factories.sql`; test: `supabase/tests/api_a1_customers_factories.test.sql`; frontend: `src/lib/api/partners.ts`.

Customers and factories have exactly the same parameters and rules; only the names, permission keys and error code prefixes differ (`customer_*` / `factory_*`). Customers are used as the example below.

**`create_customer`** (write, `canCreateCustomers`)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_organization_id` | uuid | ✅ | The currently selected organization |
| `p_name` | text | ✅ | Company name; leading and trailing spaces are trimmed; no duplicate names in the same organization (case-insensitive) |
| `p_contact_person` | text | ✅ | Contact person |
| `p_phone` | text | One of two | Mobile; at least one of mobile and landline |
| `p_landline_phone` | text | One of two | Landline |
| `p_fax`, `p_email`, `p_address`, `p_note` | text | | Email must be `name@domain`; an empty string counts as not filled in |
| `p_dry_run` | boolean | | When `true`, only validates and returns the content |

Returns: `id` is the new customer ID; `summary.title` is 「建立客戶」 (Create customer), and `fields` are, in order, name, contact person, mobile, landline, fax, email, address, note (only fields with values).

**`update_customer`** (write, `canEditCustomers`)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_organization_id` | uuid | ✅ | |
| `p_customer_id` | uuid | ✅ | Must belong to `p_organization_id`, otherwise reported as not found |
| `p_changes` | jsonb | ✅ | Fields to change: `name`, `contact_person`, `phone`, `landline_phone`, `fax`, `email`, `address`, `note`. Fields not present are unchanged; an empty string or `null` clears |
| `p_dry_run` | boolean | | |

The merged customer must still meet the creation rules (for example, clearing the mobile requires a landline). Returns: `summary.title` is 「修改客戶「<original name>」」 (Edit customer), and `fields` lists only changed fields, valued "old → new" (empty values shown as 「（空白）」, blank); with no changes, `fields` is an empty array.

**`set_customer_active`** (write, `canEditCustomers`)

Parameters: `p_organization_id`, `p_customer_id`, `p_is_active` (boolean, required), `p_dry_run`. A deactivated customer stays on existing documents but no longer appears in the customer menu for new orders. Returns: `summary` is 「停用客戶「<name>」」 (Deactivate customer) or 「啟用客戶「<name>」」 (Activate customer), and `fields` is 「狀態：啟用 → 停用」 (Status: active → inactive) (an empty array if the status didn't change).

**Error codes**

| SQLSTATE | Code | Message (meaning) |
|----------|------|-------------------|
| `42501` | `not_signed_in` / `forbidden` | Please sign in / Your role doesn't have permission for this |
| `P0002` | `customer_not_found` / `factory_not_found` | Customer / factory not found (including ones in other organizations) |
| `22023` | `name_required` | Enter the customer name |
| `22023` | `contact_person_required` | Enter the contact person |
| `22023` | `phone_required` | Fill in at least one of mobile or landline |
| `22023` | `invalid_email` | Invalid email format |
| `22023` | `invalid_changes` / `unknown_field` | Invalid change format / Field can't be changed: … |
| `22023` | `is_active_required` | Specify whether to activate or deactivate |
| `23505` | `customer_name_taken` / `factory_name_taken` | A customer named "…" already exists |

**Reads**: customer and factory lists and single lookups keep querying the tables directly. New column `is_active`; new-document menus list only `is_active = true`.

### A2 Orders

Migration: `supabase/migrations/20261008181853_api_a2_orders.sql`; test: `supabase/tests/api_a2_orders.test.sql`; frontend: `src/lib/api/orders.ts`.

**Document numbers (shared by all transaction documents)**: see §2.5; orders look like `B202610080001`. Dry runs don't use up numbers. Writes straight to the table (now only some of the AI's order-creation tools) are always numbered by the trigger with the same rule, and users can't choose numbers (as before the change); only numbers assigned inside the API are kept.

**`create_order`** (write, `canCreateOrders`)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_organization_id` | uuid | ✅ | |
| `p_customer_id` | uuid | ✅ | An active customer in the same organization |
| `p_items` | jsonb | ✅ | At least one: `[{ product_id, quantity, unit_price, total_rolls?, specifications? }]`; products must be in the same organization and not deactivated; quantity > 0, unit price ≥ 0 |
| `p_factory_ids` | uuid[] | | Assigned factories; same organization, active |
| `p_note` | text | | |
| `p_dry_run` | boolean | | |

Returns: `id`, `number` (order number; both `null` in a dry run). `summary.title` is 「建立訂單」 (Create order), and `fields` are, in order, customer, lines 1…n (「產品 - 顏色（色號）× 數量 公斤，單價 X」, product - color (color code) × quantity kg, unit price X), assigned factories, note, order total.

**`update_order`** (write, `canEditOrders`)

`p_changes` may contain:

| Key | Description |
|-----|-------------|
| `items` | The complete line list (same as `save_order_items`): lines with an `id` are updated, lines without one are added, lines not listed are deleted. Shipped or purchased lines can't be deleted or change product; quantity can't drop below what was shipped |
| `factory_ids` | The complete factory list, replacing the current one |
| `note` | Note |
| `status` | `pending`, `confirmed`, `factory_ordered`, `completed`; to cancel, use `cancel_order` |
| `payment_status` | `unpaid`, `partial_paid`, `paid` |
| `shipping_status` | `not_started`, `partial_shipped`, `shipped` (normally computed from shippings; pass it only to override manually) |

Returns: `number` is the order number; `summary.title` is 「修改訂單 <number>」 (Edit order); `fields` lists the changed status, factories and note ("old → new"), plus 「移除品項」「修改品項」「新增品項」 (removed / changed / added lines). Cancelled orders can't be edited.

**`cancel_order`** (write, `canEditOrders`)

Parameters: `p_organization_id`, `p_order_id`, `p_reason` (optional), `p_dry_run`. Can't be cancelled once it has shipping records or any purchase order that isn't cancelled. After cancelling, `cancelled_at` and `cancel_reason` are recorded and the order can no longer be edited.

**Error codes** (besides the shared `forbidden`, `not_signed_in`, `unknown_field`, `invalid_changes`)

| SQLSTATE | Code | Message (meaning) |
|----------|------|-------------------|
| `P0002` | `order_not_found`, `customer_not_found`, `product_not_found`, `factory_not_found`, `item_not_found` | Order / customer / product / factory not found; the order line doesn't belong to this order |
| `22023` | `customer_inactive`, `product_unavailable`, `factory_inactive` | Customer "…" is deactivated, product "…" is deactivated, factory "…" is deactivated |
| `22023` | `items_required`, `invalid_quantity`, `invalid_unit_price` | An order needs at least one product, quantity must be greater than 0, unit price can't be negative |
| `22023` | `use_cancel_order`, `invalid_status`, `invalid_payment_status`, `invalid_shipping_status`, `invalid_factory_ids` | Use cancel order, invalid status… |
| `55000` | `item_shipped`, `item_purchased`, `quantity_below_shipped` | Product "…" has been shipped / purchased and can't be deleted or replaced; quantity can't be below the … kg already shipped |
| `55000` | `order_cancelled`, `order_already_cancelled`, `order_has_shipments`, `order_has_purchase_orders` | Order … is cancelled and can't be edited; it has shipping records / active purchase orders … and can't be cancelled |

### A3 Purchase orders

Migration: `supabase/migrations/20261008193554_api_a3_purchase_orders.sql`; test: `supabase/tests/api_a3_purchase_orders.test.sql`; frontend: `src/lib/api/purchases.ts`.

**`create_purchase_order`** (`canCreatePurchases`)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_factory_id` | uuid | ✅ | A factory in the same organization, not deactivated |
| `p_items` | jsonb | ✅ | At least one: `[{ product_id, ordered_quantity, unit_price, ordered_rolls?, specifications? }]`; the product (color) and its product must both be active; quantity > 0, unit price ≥ 0 |
| `p_order_ids` | uuid[] | | Linked orders (same organization, not cancelled); orders that are "pending" or "confirmed" become "ordered from factory" |
| `p_expected_arrival_date` | date | | Can't be before the order date |
| `p_note` | text | | |
| `p_order_date` | date | | Defaults to today in Taiwan |

Returns: `id`, `number` (purchase order number P + YYYYMMDD + four-digit sequence; both `null` in a dry run). Status is "ordered" (`confirmed`). `summary.title` is 「建立採購單」 (Create purchase order), and `fields` are, in order, factory, linked orders, lines 1…n (「產品 - 顏色（色號）× 數量 公斤，單價 X」), order date, expected arrival date, note, purchase total.

**`update_purchase_order`** (`canEditPurchases`): `p_changes` may contain

| Key | Description |
|-----|-------------|
| `items` | The complete line list (same as `save_purchase_order_items`): lines with an `id` are updated, lines without one are added, lines not listed are deleted. Received lines can't be deleted or change product; quantity can't drop below what was received |
| `order_ids` | The complete list of linked orders; newly linked orders become "ordered from factory", and unlinked orders with no other active purchase order go back to "confirmed" |
| `factory_id` | Can't be changed once anything is received |
| `order_date`, `expected_arrival_date` | `YYYY-MM-DD`; the expected arrival date can be cleared with an empty string |
| `note` | An empty string clears it |
| `status` | `pending`, `confirmed`, `partial_received`, `completed`; recomputed automatically on receiving. To cancel, use `cancel_purchase_order` |

`summary` lists only changed fields, with lines shown as 「移除品項／修改品項（舊 → 新）／新增品項」 (removed / changed (old → new) / added lines).

**`cancel_purchase_order`** (`canEditPurchases`): `p_purchase_order_id`, `p_reason?`. Can't be cancelled once anything is received. After cancelling, `cancelled_at` and `cancel_reason` are recorded and the purchase order can no longer be edited; links are kept as a record, and linked orders with no other active purchase order go from "ordered from factory" back to "confirmed" (only then can that order be cancelled).

| SQLSTATE | Code | Message (meaning) |
|----------|------|-------------------|
| `P0002` | `purchase_order_not_found`, `factory_not_found`, `product_not_found`, `order_not_found`, `item_not_found` | Purchase order / factory / product / order not found; the purchase line doesn't belong to this purchase order |
| `22023` | `factory_inactive`, `product_unavailable` | Factory "…" is deactivated, product "…" is deactivated |
| `22023` | `items_required`, `invalid_quantity`, `invalid_unit_price`, `invalid_date`, `invalid_expected_arrival_date` | A purchase order needs at least one product, quantity must be greater than 0, unit price can't be negative, invalid date format, the expected arrival date can't be before the order date |
| `22023` | `use_cancel_purchase_order`, `invalid_status`, `invalid_order_ids`, `unknown_field` | Use cancel purchase order, invalid purchase order status… |
| `55000` | `item_received`, `quantity_below_received` | Product "…" has been received and can't be deleted or replaced; quantity can't be below the … kg already received |
| `55000` | `order_cancelled`, `purchase_order_cancelled`, `purchase_order_already_cancelled`, `purchase_order_received` | Order … is cancelled; purchase order … is cancelled and can't be edited; it has receiving records and can't be cancelled or change factory |

### A4 Receiving (receipts)

Migration: `supabase/migrations/20261008233705_api_a4_receiving.sql`; test: `supabase/tests/api_a4_receiving.test.sql`; frontend: `src/lib/api/inventory.ts`.

**`receive_inventory`** (`canCreateInventory`)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_purchase_order_id` | uuid | ✅ | A purchase order in the same organization, not cancelled; the factory is taken from it |
| `p_rolls` | jsonb | ✅ | At least one roll: `[{ product_id, quantity, warehouse_id, shelf?, quality?, roll_number?, specifications? }]`; the product must be on the purchase order; weight > 0; quality `A` / `B` / `C` / `D` / `defective`, default `A`; without `roll_number`, the system generates one (R + YYMMDD + nine digits) |
| `p_arrival_date` | date | | Defaults to today in Taiwan |
| `p_note` | text | | |

Returns: `id`, `number` (receipt number I + YYYYMMDD + four-digit sequence; both `null` in a dry run). After receiving, the purchase order's received quantities and status are recomputed automatically. Receiving more than the purchased quantity is still allowed. `summary.title` is 「入庫」 (Receive), and `fields` are, in order, purchase order, factory, arrival date, products 1…n (「產品 - 顏色 × N 卷，共 X 公斤」, product - color × N rolls, X kg in total), note, total, and 「超過採購量」 (exceeds purchase quantity) when over-received.

**`update_inventory`** (`canEditInventory`): `p_changes` may contain `rolls` (the complete roll list: rolls with an `id` are updated, those without are added, those not listed are deleted; shipped rolls can't be deleted or change product, and weight can't drop below what was shipped; new or changed products must be on the purchase order), `arrival_date`, `note`. `summary` lists only changed fields, with rolls shown as 「移除布卷／修改布卷（舊 → 新）／新增布卷」 (removed / changed (old → new) / added rolls), for example 「R261008123456789 棉布 - 白 100 公斤（A 級，倉庫 一號倉 B-03）」.

**`update_inventory_roll`** (`canEditInventory`): `p_roll_id`, `p_changes` may contain `quantity` (received weight; the shipped quantity is unchanged and stock adjusts accordingly), `quality`, `warehouse_id`, `shelf`. The returned `number` is the roll number.

| SQLSTATE | Code | Message (meaning) |
|----------|------|-------------------|
| `P0002` | `purchase_order_not_found`, `inventory_not_found`, `roll_not_found`, `product_not_found`, `warehouse_not_found` | Purchase order / receiving record / roll / product / warehouse not found |
| `22023` | `rolls_required`, `invalid_quantity`, `invalid_quality`, `invalid_date`, `product_not_on_purchase_order`, `unknown_field` | A receiving record needs at least one roll, roll weight must be greater than 0, product "…" isn't on the purchase order… |
| `23505` | `roll_number_taken` | Roll number "…" is already used |
| `55000` | `purchase_order_cancelled`, `roll_shipped`, `quantity_below_shipped` | Purchase order … is cancelled and can't be received against; roll "…" has been shipped and can't be deleted or change product; received weight can't be below the … kg already shipped |

### A5 Shippings

Migration: `supabase/migrations/20261009000604_api_a5_shipping.sql`; test: `supabase/tests/api_a5_shipping.test.sql`; frontend: `src/lib/api/shipping.ts`.

Shippings gained `status` (`shipped` / `cancelled`), `cancelled_at`, `cancel_reason`. An order's shipped quantity and shipping status count only shippings that aren't cancelled.

**`create_shipping`** (`canCreateShipping`)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_order_id` | uuid | ✅ | An order in the same organization, not cancelled; the customer is taken from it |
| `p_items` | jsonb | ✅ | At least one roll: `[{ inventory_roll_id, shipped_quantity }]`; rolls must be in the same organization and their products on the order; weight > 0 and no more than the roll's remaining stock |
| `p_shipping_date` | date | | Defaults to today in Taiwan |
| `p_note` | text | | |

Returns: `id`, `number` (shipping number O + YYYYMMDD + four-digit sequence; both `null` in a dry run). Roll stock is deducted and the order's shipping progress updated in the same transaction. Shipping more than the ordered quantity is still allowed. `summary.title` is 「建立出貨單」 (Create shipping), and `fields` are, in order, order, customer, shipping date, products 1…n (「產品 - 顏色 × N 卷，共 X 公斤」), note, total, and 「超過訂單量」 (exceeds order quantity) when over.

**`update_shipping`** (`canEditShipping`): `p_changes` may contain `items` (the complete roll list: rolls with an `id` are updated, those without are added, those not listed are deleted; only the difference is applied to stock), `shipping_date`, `note`. Cancelled shippings can't be edited. `summary` shows 「移除布卷／修改布卷（舊 → 新）／新增布卷」, for example 「R261008123456789 棉布 - 白 40 公斤」.

**`cancel_shipping`** (`canEditShipping`, decision B3): `p_shipping_id`, `p_reason?`. The shipped weight is added back to each roll and the order's shipping progress is recomputed; the shipping items are kept as a record. Once all of an order's shippings are cancelled, the order can be cancelled (if it has no active purchase orders).

| SQLSTATE | Code | Message (meaning) |
|----------|------|-------------------|
| `P0002` | `order_not_found`, `shipping_not_found`, `roll_not_found`, `item_not_found` | Order / shipping / roll not found; the shipping item doesn't belong to this shipping |
| `22023` | `items_required`, `invalid_quantity`, `roll_not_in_order`, `invalid_date`, `unknown_field` | A shipping needs at least one roll, shipped weight must be greater than 0, the product of roll "…" isn't on this order… |
| `55000` | `order_cancelled`, `shipping_cancelled`, `shipping_already_cancelled`, `insufficient_stock` | Order … is cancelled and can't be shipped; shipping … is cancelled; roll "…" has insufficient stock, at most … kg more can be shipped |

### A6 Products and colors

Migration: `supabase/migrations/20261008185816_api_a6_products.sql`; test: `supabase/tests/api_a6_products.test.sql`; frontend: `src/lib/api/products.ts`, `src/hooks/useProductCatalog.ts`. Data structure: [requirements/PHASE1_BUSINESS_API.md](./requirements/PHASE1_BUSINESS_API.md) §7.

**`create_product`** (`canCreateProducts`)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `p_name` | text | ✅ | Unique within the organization (case-insensitive, leading and trailing spaces trimmed) |
| `p_colors` | jsonb | ✅ | At least one: `[{ color, color_code?, color_hex?, stock_threshold? }]`; "color + color code" can't repeat within a product |
| `p_category` | text | | Defaults to 「布料」 (fabric) |
| `p_unit_of_measure` | text | | Defaults to `KG` |

Returns: `id` (product id). `summary.title` is 「建立產品」 (Create product), and `fields` are, in order, product name, category, unit, colors 1…n (「米白（色號 W01），安全庫存 50 公斤」, off-white (color code W01), safety stock 50 kg).

**`update_product`** (`canEditProducts`): `p_product_id`, `p_changes` may contain `name`, `category`, `unit_of_measure`; synced to all colors. `summary` lists only changed fields ("old value → new value").

**`set_product_active`** (`canEditProducts`): `p_product_id`, `p_is_active`. Once deactivated, none of its colors can be added to orders (existing lines are kept).

**`add_product_color`** (`canCreateProducts`): `p_product_id`, `p_color`, `p_color_code?`, `p_color_hex?`, `p_stock_threshold?`; returns the new color's `id`.

**`update_product_color`** (`canEditProducts`): `p_color_id`, `p_changes` may contain `color`, `color_code`, `color_hex`, `stock_threshold` (an empty string or `null` clears).

**`set_product_color_active`** (`canEditProducts`): `p_color_id`, `p_is_active` (maps to `status` `Available` / `Unavailable`).

**Read-only view `product_catalog`**: one row per color, with `product_id`, `product_name`, `category`, `unit_of_measure`, `product_is_active`, `color_id`, `color`, `color_code`, `color_hex`, `stock_threshold`, `color_is_active`, `stock_quantity`, `stock_rolls`, `is_low_stock`. The `product_id` on orders and other documents refers to `color_id`.

**The old way of writing**: inserting into `products_new` directly with only a name attaches it automatically to the same-named product in the organization (creating it if missing), taking the product's name, category and unit.

| SQLSTATE | Code | Message (meaning) |
|----------|------|-------------------|
| `P0002` | `product_not_found`, `product_color_not_found` | Product / color not found |
| `22023` | `name_required`, `colors_required`, `color_required` | Enter the product name, a product needs at least one color, enter the color |
| `22023` | `invalid_color_hex`, `invalid_stock_threshold`, `is_active_required` | Invalid color value format, use #RRGGBB; safety stock can't be negative |
| `22023` | `unknown_field`, `invalid_changes` | Field can't be changed (for example, changing a color on the product) |
| `23505` | `product_name_taken`, `product_color_taken` | A product named "…" already exists, add the color under that product; this product already has the color "…" |

### A6 Shelves

Migration: `supabase/migrations/20261009003415_api_a6_shelves.sql`; test: `supabase/tests/api_a6_shelves.test.sql`; frontend: `src/lib/api/shelves.ts`. Shelves are stored in `warehouses` (called 「倉庫」, warehouse, on the receiving screen).

| API | Permission key | Parameters | Description |
|-----|----------------|------------|-------------|
| `create_shelf` | `canCreateShelves` | `p_name`, `p_location?` | Name unique within the organization (case-insensitive, leading and trailing spaces trimmed, B6) |
| `update_shelf` | `canEditShelves` | `p_shelf_id`, `p_changes` (`name`, `location`; an empty string clears the location) | `summary` lists only changed fields |
| `set_shelf_active` | `canEditShelves` | `p_shelf_id`, `p_is_active` | Once deactivated, no new rolls can be placed on it or moved to it; rolls already on it are unaffected (B4). When deactivating, `summary` lists 「仍有庫存」 (still has stock) |

`warehouses` gained `is_active`. The roll shelf check is in `save_inventory_rolls`, so it applies to `receive_inventory`, `update_inventory` and `update_inventory_roll`.

| SQLSTATE | Code | Message (meaning) |
|----------|------|-------------------|
| `P0002` | `shelf_not_found` | Shelf not found |
| `22023` | `name_required`, `is_active_required`, `unknown_field`, `warehouse_inactive` | Enter the shelf name; shelf "…" is deactivated |
| `23505` | `shelf_name_taken` | A shelf named "…" already exists |

## 4. Organizations and members

These functions predate the business APIs, and their errors use plain SQLSTATEs (not `api_fail()`).

| Function | Who can use it | Description |
|----------|----------------|-------------|
| `set_member_role(_organization_id, _user_id, _role)` | `canEditUsers` | Role is `admin` / `editor` / `viewer`; can't change yourself or the owner |
| `set_member_active(_organization_id, _user_id, _is_active)` | `canEditUsers` | Deactivate or activate a member; can't deactivate yourself or the owner |
| `add_existing_user_to_organization(_email, _organization_id, _role)` | `canCreateUsers` | Invite a user who has already signed up |
| `complete_user_invitation(_user_id, _organization_id, _role, _full_name, _phone)` | `canCreateUsers` | Complete a new user's invitation |
| `get_my_pending_invitations()` | Signed-in user | Invitations you received and haven't accepted |
| `accept_organization_invitation(_organization_id)` | Invitee | Accept an invitation |
| `get_organization_member_status(_organization_id)` | Organization members | Members' sign-in and invitation status (user management page) |
| `transfer_organization_ownership(_organization_id, _new_owner_id, _fallback_role_name)` | Owner | Transfer ownership; the previous owner becomes an admin |
| `delete_organization(_organization_id, _confirm_name)` | Owner | Requires typing the organization name to confirm |
| `user_has_organization_permission(_user_id, _organization_id, _permission)` | Only answers about yourself or your own organizations | The single source of permission checks; RLS, business APIs and the AI all use it |
| `is_organization_owner`, `user_belongs_to_organization`, `can_inspect_organization` | Same as above | Helper functions for permission checks |

Creating an organization writes `organizations` directly (a trigger adds the creator as an admin).

### 4.1 Internal functions (not called directly)

| Function | Purpose |
|----------|---------|
| `save_order_items`, `save_purchase_order_items`, `save_inventory_rolls`, `save_shipping_items` | Bulk save and locking rules for document lines; called by the business APIs. They run as the caller, so direct calls are limited by RLS and permission keys |
| `recompute_order_shipments`, `recompute_purchase_order_receipts` | Recompute order shipping progress and purchase order receiving progress; called by triggers and business APIs |
| `order_product_is_purchased` | Whether an order line is already on an active purchase order |
| `api_fail`, `api_new_roll_number` | Error reporting, roll numbers |
| `private.api_assign_document_number` | Document numbers for direct table writes, called only by the document number trigger (not in public, so it can't be called from `/rpc`) |

Other functions prefixed `api_` are for internal use by the business APIs only and can't be called.

## 5. Read-only data

| Name | Description |
|------|-------------|
| Business tables | Read by view key ([PERMISSIONS.md](./PERMISSIONS.md) §3) |
| `product_catalog` (view) | One row per color: product, color, color code, color value, safety stock, status, stock weight and rolls, whether low on stock. Used by order-creation menus and the product page |
| `inventory_summary`, `inventory_summary_enhanced` (view) | Stock per product, grade breakdown, quantity awaiting receipt, quantity awaiting shipment. Used by the inventory page and the AI |
| `record_audit_logs` | Edit history; readable by organization members |

## 6. AI server (`mcp-server/`)

Deployed on Google Cloud Run ([SERVICES.md](./SERVICES.md)). Every endpoint requires `Authorization: Bearer <Supabase JWT>` and serves only organizations the user actively belongs to.

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /query` | AI conversation: the body carries `organization_id`, `session_id`, `message_id` and the message; returns the reply and `traceId`. Write tools only create pending actions |
| `POST /query/actions/:id/confirm` | The user confirms a write the AI proposed; membership and permission are re-checked at confirmation before it runs |
| `POST /query/messages/:id/feedback` | Thumbs up or down on one of your own AI replies: body `{ "value": "up" \| "down" \| null }` (null undoes); returns `{ feedback }`. Stored in `query_messages.metadata.feedback` (`set_query_message_feedback()`) and sent to Langfuse ([AGENT.md](./AGENT.md)). 404 for replies that aren't yours |
| `/mcp` | Model Context Protocol endpoint, with `X-Organization-Id` in the header |

AI tools and architecture: [AGENT.md](./AGENT.md) (maintained by the AI Session).
