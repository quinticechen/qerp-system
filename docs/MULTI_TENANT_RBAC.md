# Multi-Tenant Roles and Permissions Planning

> Status: Role model confirmed (2026-10-07); R0 applied and passed rollback testing (`20261007164641_rbac_r0_security_hardening.sql`); R1 applied (2026-10-08) and passed all SQL rollback tests; R2 frontend guarding completed (uncommitted) (`20261008132011_rbac_r1_fixed_roles.sql`, `supabase/tests/rbac_r1_roles.test.sql`); R2 committed; R3/R4 applied (2026-10-09): business tables use key-based RLS (SELECT → view, INSERT → create, UPDATE → edit, no DELETE on master tables; child tables follow the parent's keys) (`20261009002334_rbac_r4_business_rls.sql`, `supabase/tests/rbac_r4_business_rls.test.sql`)
> Scope: Roles, permission keys, database RLS/RPC, frontend guarding, and AI tools permissions within organizations (tenants)
> Related Documents: [QUERY_AGENT_PHASE0.md](https://www.google.com/search?q=./QUERY_AGENT_PHASE0.md) (§4.2 Permissions and Organization, D1–D5), [SESSION_COORDINATION.md](https://www.google.com/search?q=./SESSION_COORDINATION.md)

## 1. Background and Objectives

The permission management page allows setting 29 permission keys, but very few are actually enforced:

* **Database**: Only `canViewUsers`, `canCreateUsers`, and `canEditUsers` are used in RLS; database tables for products, orders, purchases, inventory, shipping, customers, and factories only check whether the user is an organization member.
* **Frontend**: Only the product page (view, create), user page, and permissions page have checks; routing and the sidebar menu ignore permissions.
* **AI**: Phase 0 has ensured that every tool is filtered according to database permission keys, making it currently the only fully enforced layer.

Additionally, several **cross-organization security vulnerabilities** (§2.1) were discovered during the audit and must be fixed first.

All business and member data tables have operation logs (`record_audit_logs` tracking who modified what and when), removing the need for granular, checkbox-style permissions. This is replaced by **four fixed roles** (§4.2).

Objectives:

1. Roles are fixed to Owner, Administrator, Editor, and Viewer, with each member holding only one role per organization.
2. Permissions are enforced by the database (RLS/RPC), while the frontend and AI merely align their interfaces and tool lists accordingly.
3. No one can elevate their own permissions beyond their assigned role.
4. Upon completion of each Phase 1 business workflow, the corresponding permissions will be put in place simultaneously without requiring an additional cycle.

## 2. Current Status

### 2.1 Security Vulnerabilities (Based on online `pg_policies`, actual attack testing not yet performed)

| # | Issue | Impact | Location |
| --- | --- | --- | --- |
| S1 | The INSERT policy for `user_organizations` only checks `user_id = auth.uid()` | Any logged-in user knowing an organization ID can add themselves as an **active member** of that organization | Policy "Users can insert own memberships" |
| S2 | The INSERT policy for `user_organization_roles` only checks `user_id = auth.uid() OR granted_by = auth.uid()`, without checking the caller's permissions or whether the role belongs to the organization | Combined with S1, a user can assign themselves any role (e.g., Administrator), **gaining full permissions to any organization**; any member can also assign roles to others | Policy "System can assign roles" |
| S3 | The INSERT policy for `organization_roles` is `true` | Any logged-in user can create a role with arbitrary permissions in any organization. Although Phase 0 has blocked the `create_default_organization_roles` function, this policy remains | Policy "System can create default roles" |
| S4 | SELECT/INSERT/UPDATE/DELETE for `order_factories` and `purchase_order_relations` are all `true` and open to `public` | **Unauthenticated users** with the frontend-embedded anon key can read, modify, and delete orders, factories, and purchase order relations across **all organizations** (confirmed that `anon` has SELECT/DELETE permissions on these two tables) | All policies on both tables |
| S5 | `order_products` and `purchase_order_items` have an extra SELECT `true`; `shipping_items` and `shipment_history` have an extra INSERT `true` | Order and purchase items from all organizations can be read; shipping data of other organizations can be written. Original `org_isolation_*` policies failed due to OR semantics | "Authenticated users can ..." series of policies |
| S6 | `profiles` and `user_operation_logs` still rely on the legacy function `is_admin()` (`profiles.role`) for checks | Currently unexploitable: `is_admin()` consistently returns `false` (migration `neutralize_dangling_is_admin_functions`), and the `profiles.role` column no longer exists. This is a cleanup item to prevent cross-organization access from being reopened if someone reverts `is_admin()` | "Admins can ..." series of policies |
| S7 | When editing a member's role, the frontend deletes and then re-adds the role. DELETEs by non-owners are blocked by RLS without throwing an error, but INSERT succeeds due to S2 | When someone with `canEditUsers` modifies another user's role, the target user **retains both old and new roles** (permissions are combined via union) | `src/components/user/EditUserDialog.tsx` |

### 2.2 Design Issues

| # | Issue | Handling |
| --- | --- | --- |
| P1 | Permission key lists are hardcoded in 4 places: `CreateRoleDialog`, `EditRoleDialog`, `useOrganizationPermissions` (owner list), `mcp-server/src/tools/types.ts` | Once roles are fixed, the mapping table resides solely in the database (§4.3) |
| P2 | The Owner role row stores 6 keys like `canManageOrganization` and `canViewAll` which are never checked anywhere | Removed |
| P3 | The "Edit Permissions" key has no effect: role creation, editing, and disabling only check whether the user is an owner | Roles are no longer editable; this key is removed |
| P4 | `/permission` and `/organization-roles` display the same component but check different keys | Consolidated into a single page showing read-only role descriptions |
| P5 | Shelves (`warehouses`) lack a permission key | Added |
| P6 | When custom roles were allowed, it was possible to grant "Create Shipment" without "View Orders" | Will not occur once roles are fixed |
| P7 | Cross-domain synchronization relies on triggers (e.g., `recompute_purchase_order_receipts` updating purchase items after receiving), which execute with the caller's privileges. Applying permission RLS directly to business tables could cause operations to fail for users lacking table permissions | Business table RLS goes live alongside Phase 1 RPCs (R4) |
| P8 | A member can have multiple roles, combining permissions via union | Changed to one role per member |

### 2.3 Existing Data (2026-10-07)

All 3 organizations have only system roles and no custom roles. Current assignments: Owner role (3 records), Administrator (3 records); Sales, Assistant, Accountant, Warehouse (0 records). No member holds multiple roles simultaneously. Migration will not alter what anyone can actually do.

## 3. Decisions

| Decision | Content | Status |
| --- | --- | --- |
| R1 | Tenant = Organization. Owner is determined by `organizations.owner_id` | ✅ Confirmed |
| R2 | Four fixed roles: Owner, Administrator, Editor, Viewer (§4.2); custom roles are not provided | ✅ Confirmed |
| R3 | Each member has only one role per organization | ✅ Confirmed |
| R4 | Transferring ownership and deleting organizations are restricted to the owner | ✅ Confirmed |
| R5 | Business data is not physically deleted: products, factories, customers, etc., are changed to "disabled", while orders, purchases, and shipments are changed to "cancelled", all falling under the "Edit" permission. Business data tables do not grant DELETE | ✅ Confirmed |
| R6 | Anti-privilege escalation: Administrators can assign Administrator, Editor, and Viewer roles; cannot modify their own role; cannot modify the owner; owners can only be created via transfer | ✅ Confirmed |
| R7 | Viewers cannot see user management and organization management | ✅ Confirmed |
| R8 | AI query logs (`query_traces`) are viewable only by the user themselves and are not exposed to other members via permissions | ✅ Confirmed |
| R9 | **Permission keys are retained** as check units; roles are simply fixed combinations of permission keys. The interface of `user_has_organization_permission()` remains unchanged, so AI tools and RPCs require no modifications | ✅ Confirmed |
| R10 | Roles reside on membership (`user_organizations.role`), and the mapping table between roles and permission keys is a global table `role_permissions`, replacing organization-specific `organization_roles` and `user_organization_roles` | ✅ Confirmed |

Rationale for R9: Permission keys serve as the contract between two sessions (SESSION_COORDINATION.md §4). Retaining them simplifies changes to only occur at the "Role → Permission Key" layer; if finer-grained roles are needed later, one simply adds rows to the mapping table.

## 4. Design

### 4.1 Tenant Model

```
organizations (owner_id)
       │
       └── 1:N ── user_organizations (user_id, role, is_active)
                         │
                         └── role ── role_permissions (role, permission_key)  ← Global, shared across all organizations

```

* Users can belong to multiple organizations; permissions for each request are calculated based on the "currently selected organization" (Phase 0 §4.2).
* `role` is one of `admin`, `editor`, or `viewer`. Owners do not have a `role` column; they are determined by `owner_id` and hold full permissions.
* Once a member is disabled (`is_active = false`), all permission checks return false.
* Permission checking uses **a single function**: `user_has_organization_permission(auth.uid(), organization_id, key)`, which now reads `user_organizations.role` and `role_permissions`. It already incorporates membership and owner checks, so RLS using it simultaneously achieves organization isolation.

### 4.2 Roles

| Functionality | Owner | Administrator | Editor | Viewer |
| --- | --- | --- | --- | --- |
| Products, Orders, Purchases, Shelves, Inventory, Shipping, Factories, Customers | View, Create, Edit | View, Create, Edit | View, Create, Edit | View |
| User Management | View, Invite, Edit | View, Invite, Edit | View | – |
| Organization Management (Role descriptions, Org settings) | View, Edit | View, Edit | View | – |
| Transfer Ownership, Delete Organization | ✅ | – | – | – |

* "Edit" includes disabling and cancellation (R5).
* "Edit" under user management includes modifying data, assigning roles, and disabling members, subject to R6 restrictions.
* Legacy role mapping: Owner role → Owner (`owner_id` unchanged); Administrator → Administrator; Sales, Assistant, Warehouse → Editor; Accountant → Viewer.

### 4.3 Permission Keys

| Module | Permission Key | Owner, Administrator | Editor | Viewer |
| --- | --- | --- | --- | --- |
| Products | `canViewProducts` | ✅ | ✅ | ✅ |
|  | `canCreateProducts`, `canEditProducts` | ✅ | ✅ |  |
| Customers | `canViewCustomers` | ✅ | ✅ | ✅ |
|  | `canCreateCustomers`, `canEditCustomers` | ✅ | ✅ |  |
| Factories | `canViewFactories` | ✅ | ✅ | ✅ |
|  | `canCreateFactories`, `canEditFactories` | ✅ | ✅ |  |
| Shelves (New) | `canViewShelves` | ✅ | ✅ | ✅ |
|  | `canCreateShelves`, `canEditShelves` | ✅ | ✅ |  |
| Orders | `canViewOrders` | ✅ | ✅ | ✅ |
|  | `canCreateOrders`, `canEditOrders` | ✅ | ✅ |  |
| Purchases | `canViewPurchases` | ✅ | ✅ | ✅ |
|  | `canCreatePurchases`, `canEditPurchases` | ✅ | ✅ |  |
| Inventory (Create = Receive) | `canViewInventory` | ✅ | ✅ | ✅ |
|  | `canCreateInventory`, `canEditInventory` | ✅ | ✅ |  |
| Shipping | `canViewShipping` | ✅ | ✅ | ✅ |
|  | `canCreateShipping`, `canEditShipping` | ✅ | ✅ |  |
| Users | `canViewUsers` | ✅ | ✅ |  |
|  | `canCreateUsers` (Invite), `canEditUsers` | ✅ |  |  |
| Organization | `canViewPermissions`, `canViewSystemSettings` | ✅ | ✅ |  |
|  | `canEditSystemSettings` | ✅ |  |  |

Removed keys: `canDeleteProducts` (R5), `canEditPermissions` (roles are not editable), `canManageOrganization`, `canManageUsers`, `canManageRoles`, `canViewAll`, `canEditAll`, `canDeleteAll` (P2).

Create and Edit remain separate keys, even though current roles do not distinguish them. This is the contract already used by AI tools (R9), ensuring that if a role of "can create only, cannot modify" is introduced later, check points do not need to be refactored.

### 4.4 Three-Layer Enforcement

| Layer | Approach | Role |
| --- | --- | --- |
| Database | RLS: SELECT → View key, INSERT → Create key, UPDATE → Edit key, conditions uniformly use `user_has_organization_permission(auth.uid(), organization_id, '<key>')`. Business master tables **have no DELETE policy** (R5). Child tables (items, relations, roll numbers) are evaluated based on the parent's `organization_id`; replacing items during parent order editing requires deleting child table rows, permitted via the parent's edit key | **The only enforcement layer** |
| Database RPC | Cross-domain tasks (receiving, shipping inventory deduction, order cancellation) are built as RPCs, checking the permission key of the **task itself** at the beginning of the function and verifying that referenced data belongs to the same organization. Associated triggers are called by the RPC or marked as definer (P7) | Written by AI Session (SESSION_COORDINATION.md §4) |
| Frontend | A single `ROUTE_PERMISSIONS` (route → view key) is used for both route guarding and the sidebar menu; Create, Edit, Disable, and Cancel buttons are wrapped in `PermissionGuard`; users lacking edit keys see read-only details when opening records | Responsible solely for a consistent UI |
| AI | The `permission` declared by each tool must match the key checked by the RPC it calls. P0-5 confirmation endpoints re-check permissions **at the moment of confirmation** | Implemented, carried over into Phase 1 |

No PERMISSIVE policies ("view role only, ignore organization") are introduced (`CLAUDE.md` Security Rules).

### 4.5 Preventing Privilege Escalation (R6)

Writes to members and roles **must go through RPCs**, removing direct client-side writing policies for `user_organizations`, `user_organization_roles`, and `organization_roles` (while fixing S1–S3, S7).

| RPC | Required Key | Rules |
| --- | --- | --- |
| `set_member_role(organization_id, user_id, role)` | `canEditUsers` | `role` must be one of `admin`, `editor`, `viewer`; cannot modify own role; cannot modify the owner |
| `set_member_active(organization_id, user_id, is_active)` | `canEditUsers` | Cannot disable oneself or the owner |
| Invite, Accept invitation | `canCreateUsers` | Existing RPC, modified to specify a `role` |
| `transfer_organization_ownership`, `delete_organization` | Owner only | Existing. Post-transfer, the original owner becomes an administrator |

### 4.6 AI Scope

* Business tools are added according to Phase 1 workflows; permission keys are listed in §4.3.
* User and organization management: per Phase 0 D3, only read-only tools are provided (e.g., `list_members` requires `canViewUsers`), with no write access.
* AI query logs are viewable only by the individual themselves (R8). The existing policy allowing those with `canViewSystemSettings` to view all traces within the organization must be removed (`query_traces` belongs to the AI Session, as proposed in SESSION_COORDINATION.md §6).
* Eval role fixtures are updated to Administrator, Editor, Viewer; "unauthorized" test cases are tested using the Viewer role.

## 5. Implementation Sequence

| Step | Content | Verification Method |
| --- | --- | --- |
| R0 Security Patch | Fix S1–S7: Remove policies for S1–S3; update `EditUserDialog` to modify roles via RPC; adjust S4–S5 to evaluate based on parent organization; remove `is_admin()` policy in S6 | Recreate S1–S7 sequentially in a rollback transaction using test accounts for two organizations (should succeed before fix, be rejected after); manually verify invite, accept invite, create organization, and edit member; Supabase security advisor |
| R1 Fixed Roles | `user_organizations.role`, `role_permissions`; migrate existing assignments (§4.2 mapping); rewrite implementation of `user_has_organization_permission` (interface unchanged); `set_member_role`, `set_member_active` RPCs; modify invitation workflow to specify roles. Frontend: update permission hooks to read `role`, change user management to a three-choice role dropdown, convert permissions page to read-only role descriptions (merging P4), remove role creation/editing dialogs. `organization_roles` and `user_organization_roles` will be removed once no longer read by frontend or AI | Permission matrix test (see below); frontend tests; login with each role to check user management and permissions pages |
| R2 Frontend Guarding | `ROUTE_PERMISSIONS`, sidebar menu, page buttons, and read-only mode | Login with each role, check menus and buttons page-by-page (live browser testing) |
| R3 Disabling and Cancellation | Remove DELETE from business master tables; products, factories, customers, and shelves get a "disabled" status; orders, purchases, and shipments get a "cancelled" status (missing columns added as corresponding workflows require) | Permission matrix test including "no role can delete business master tables" |
| R4 Business Table RLS | Alongside Phase 1 workflows: tighten corresponding data tables after each workflow's RPC goes live (SESSION_COORDINATION.md §5) | Permission matrix test; eval has no regressions — ✅ applied 2026-10-09 together with R3 (no DELETE on master tables) |

R0 has no dependencies and is recommended for **immediate implementation**. R1 and R2 can run parallel to Phase 1 Workflow 1.

**Permission Matrix Test**: A script that executes every protected operation (query table, write table, call RPC) using test accounts for each role inside a rollback transaction, compares results against §4.3, and verifies that "data from another organization" is strictly denied. Each step adds corresponding rows as automated validation for migrations (currently migrations lack automated tests).

All migration contents will be proposed first and applied only after confirmation.

## 6. Definition of Done

* Everything each role can and cannot do has corresponding checks in the database, covered by matrix testing.
* No policy has a condition of `true` or relies solely on the legacy `profiles.role`.
* General members cannot use the API to grant themselves or others permissions exceeding their own role.
* Frontend menus, buttons, AI tools, and database evaluations are completely aligned: what is visible can be done, and what cannot be done is invisible.

## 7. Out of Scope

* Custom roles, granular checkbox-style permissions.
* Row-level security permissions (e.g., sales reps only viewing customers assigned to them).
* Column-level permissions (e.g., unit prices visible only to administrators).
* Cross-organization platform administrators.