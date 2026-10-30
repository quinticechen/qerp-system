# Database Table Inventory

> Inventory taken 2026-10-09 (RBAC Session). Based on: the tables, row counts, policies, triggers and function references in the production Supabase database, and the code references in the frontend `src/` and the AI server `mcp-server/src/`. Row counts are as of the inventory.

## 1. Summary

| Status | Tables |
|--------|--------|
| In use (business) | `customers`, `factories`, `product_groups`, `products_new`, `warehouses`, `orders`, `order_products`, `order_factories`, `purchase_orders`, `purchase_order_items`, `purchase_order_relations`, `inventories`, `inventory_rolls`, `shippings`, `shipping_items` |
| In use (organizations and permissions) | `organizations`, `user_organizations`, `role_permissions`, `profiles`, `user_operation_logs` |
| In use (records) | `record_audit_logs` |
| In use (AI query, owned by the AI Session) | `query_sessions`, `query_messages`, `query_pending_actions`, `query_traces` |

Read-only views: `product_catalog`, `inventory_summary`, `inventory_summary_enhanced` (all `security_invoker`, reading with the caller's permissions).

## 2. Business flow

```
Master data: customers, factories, products product_groups ─┬─ colors products_new, shelves warehouses
                                                          │
Orders orders (B) ── lines order_products ── assigned factories order_factories
   │  ▲ shipping progress recomputed from shippings
   │  └──────────────────────────────────────────────┐
   ▼ purchase_order_relations (many-to-many)          │
Purchase orders purchase_orders (P) ── lines purchase_order_items
   │  ▲ received quantity recomputed from receiving   │
   ▼                                                  │
Receipts inventories (I) ── rolls inventory_rolls (stock) ─┤
                                    │ deduct stock       │
                                    ▼                    │
Shippings shippings (O) ── shipped rolls shipping_items ─┘
```

- All business writes go through the business APIs ([API.md](./API.md)), running as the function owner; the tables' own RLS is controlled by permission key ([PERMISSIONS.md](./PERMISSIONS.md)). The frontend no longer writes business tables directly; a few AI tools still write tables directly (SESSION_COORDINATION.md §6).
- Business data is never actually deleted: master data is deactivated (`is_active`, color `status`), documents are cancelled (`status = cancelled` plus `cancelled_at`, `cancel_reason`).
- Document numbers are "letter + YYYYMMDD + four-digit sequence", unique within the organization, by Taiwan date ([API.md](./API.md) §2.5).

## 3. Tables in use

### 3.1 Master data

| Table | Rows | Purpose and rules | Written by |
|-------|------|-------------------|------------|
| `customers` customers | 10 | Name unique within the organization; contact person required, at least one of mobile or landline; once `is_active` is off, they don't appear in new orders | A1 API |
| `factories` factories | 9 | Same rules as customers; once deactivated, can't be assigned to new orders or purchase orders | A1 API |
| `product_groups` products | 7 | Product name, category, unit, `is_active`; name unique within the organization | A6 API (clients read only) |
| `products_new` colors | 34 | A product's colors: color, color code, color value, safety stock, `status` (Available / Unavailable); "color + color code" unique within a product. Orders, purchasing, rolls and shippings all point to this table | A6 API |
| `warehouses` shelves | 4 | Shelf name (unique within the organization), location, `is_active`; once deactivated, no new rolls can be placed | A6 shelf API |

### 3.2 Documents

| Table | Rows | Purpose and rules | Written by |
|-------|------|-------------------|------------|
| `orders` orders | 6 | Customer, status (pending → confirmed → ordered from factory → completed / cancelled), payment status, shipping status (recomputed from shippings); can't be cancelled with shippings or active purchase orders | A2 API |
| `order_products` order lines | 9 | Product (color), quantity, unit price, rolls, specification; `shipped_quantity` and `status` recomputed from shippings; shipped or purchased lines are locked | A2 API (`save_order_items`) |
| `order_factories` assigned factories | 8 | Many-to-many between orders and factories | A2 API |
| `purchase_orders` purchase orders | 3 | Factory, order date, expected arrival date, status (pending / ordered / partly received / completed, recomputed from receiving / cancelled); can't be cancelled or change factory once received | A3 API |
| `purchase_order_items` purchase lines | 5 | Product, quantity, unit price; `received_quantity` and `status` recomputed from receiving | A3 API (`save_purchase_order_items`) |
| `purchase_order_relations` purchase-order links to orders | 3 | Many-to-many between purchase orders and orders; linking sets the order to "ordered from factory", and cancelling the last active purchase order sets it back to "confirmed" | A3 API |
| `inventories` receipts | 2 | A batch of goods received against a purchase order; factory taken from the purchase order; number `receipt_number` | A4 API |
| `inventory_rolls` rolls (stock) | 4 | Each roll: product, shelf and position, grade, received weight `quantity`, remaining weight `current_quantity`; receiving or editing triggers a recompute of purchase progress | A4 API (`save_inventory_rolls`); deducted by shipping |
| `shippings` shippings | 2 | Order, customer (taken from the order), shipping date, total weight and rolls, `status` (shipped / cancelled) | A5 API |
| `shipping_items` shipped rolls | 3 | How much of each roll was shipped; writing deducts roll stock and triggers a recompute of the order's shipping progress; kept as a record when a shipping is cancelled | A5 API (`save_shipping_items`) |

### 3.3 Organizations, members and permissions

| Table | Rows | Purpose and rules | Written by |
|-------|------|-------------------|------------|
| `organizations` organizations | 4 | Name, `description` (filled in when creating the organization), owner `owner_id`, `is_active`; on creation, a trigger adds the owner as a member | Create organization, transfer ownership, delete organization (RPC) |
| `user_organizations` members | 7 | A user's membership and `role` in an organization (admin / editor / viewer, one per person), invitation and acceptance times; the `protect_membership_columns` trigger prevents self-modification | Invite, accept, `set_member_role`, `set_member_active` (RPC) |
| `role_permissions` role permissions | 65 | Which permission keys each of the three fixed roles has (global, not per organization); the owner gets the admin's permissions. `user_has_organization_permission()` reads this table, and RLS, APIs and the AI all decide through it | migration |
| `profiles` user profiles | 6 | Name, phone, `is_active`; created by a trigger at sign-up | Personal settings, user management |
| `user_operation_logs` user activity log | 16 | Records of member actions such as inviting, joining an organization and transferring ownership (distinct from the data-change records in `record_audit_logs`) | Member RPCs |

### 3.4 Records

| Table | Rows | Purpose |
|-------|------|---------|
| `record_audit_logs` edit history | 251 | Before/after content and editor for every insert, update and delete of business and member data, written by the `log_record_change()` trigger; the "Edit history" on screen reads this table |

### 3.5 AI query (owned by the AI Session)

| Table | Rows | Purpose |
|-------|------|---------|
| `query_sessions` | 35 | Conversations between users and the AI |
| `query_messages` | 74 | Each message in a conversation; `metadata` holds `trace_id`, `entities`, the confirmation card's `action_id`, and the user's thumbs up/down `feedback`. There is no UPDATE policy; `feedback` can only be changed through `set_query_message_feedback()` (`private` implementation, own AI replies only; migration `20261016060000_query_message_feedback.sql`) |
| `query_pending_actions` | 3 | Write actions proposed by the AI, awaiting the user's confirmation |
| `query_traces` | 16 | Each AI reply's models, tool calls and latency (for debugging, visible only to their own user) |

## 4. Deprecated and unused

### 4.1 Columns

| Column | Status |
|--------|--------|
| `products_new.name`, `category`, `unit_of_measure` | Since two-level products, these are copies synced from `product_groups`; `product_groups` is authoritative. AI tools and views still read these columns; remove them once those read `product_groups` |

## 5. Cleanup log

**2026-10-09** (user decision, `supabase/migrations/20261009102350_cleanup_deprecated.sql`, test `supabase/tests/cleanup_deprecated.test.sql`): deprecated tables were removed together with their old edit history, so pre-R1 role edit history is no longer shown.

- Removed tables: `organization_roles`, `user_organization_roles` (no longer read or written after R1 switched to fixed roles), `shipment_history` (never had data; shipping records are in `shipping_items`), and their records in `record_audit_logs`.
- Removed columns: `purchase_orders.order_id` (old one-to-one column, all null, replaced by `purchase_order_relations`), `user_organizations.invited_role_id` (invitations write `role` directly), `organizations.settings` (no feature read or wrote it).
- Removed the function `create_default_organization_roles`; `order_product_is_purchased`, `api_release_orders`, `cancel_order` and `cancel_purchase_order` now look only at `purchase_order_relations`.

**2026-10-09** (`supabase/migrations/20261009133702_function_hardening.sql`, test `supabase/tests/function_hardening.test.sql`): deleted the functions nothing called, `is_admin`, `get_user_organizations`, `ensure_user_profile`, `generate_order_number`; pinned the `search_path` of `handle_new_user`, `set_current_quantity`, `update_updated_at`, `update_updated_by`; trigger functions can no longer be called by clients.

**2026-10-09** (`supabase/migrations/20261009140512_private_definer_functions.sql`, test `supabase/tests/private_definer_functions.test.sql`): business APIs, organization and member RPCs, and permission functions that run as the function owner moved to the non-public `private` schema, with same-named wrappers left in `public` ([API.md](./API.md) §2.1); `api_assign_document_number` moved to `private` and can no longer be called from `/rpc`.
