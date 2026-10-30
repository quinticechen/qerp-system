# Permissions

> Current-state document (2026-10-09). For the design and decision process, see [requirements/MULTI_TENANT_RBAC.md](./requirements/MULTI_TENANT_RBAC.md).

## 1. Organizations and roles

- Each organization's data is isolated from the others; a user can belong to several organizations and switches the current one at the top right of the screen.
- Each member has exactly one role in an organization. There are four fixed roles, which cannot be customized:

| Role | Source | What they can do |
|------|--------|------------------|
| Owner | `organizations.owner_id` (one per organization) | Everything an admin can do, plus transfer ownership and delete the organization |
| Admin `admin` | `user_organizations.role` | All business features, user management, organization settings |
| Editor `editor` | Same as above | View, create and edit business data (including deactivating and cancelling); view users and organization settings |
| Viewer `viewer` | Same as above | View business data only; cannot see user management or organization management |

The permissions page (`/organization-roles`) shows a table of what each role can do, read from `role_permissions`.

## 2. Permission keys

| Area | View | Create | Edit (including deactivate, cancel) |
|------|------|--------|-------------------------------------|
| Products | `canViewProducts` | `canCreateProducts` | `canEditProducts` |
| Orders | `canViewOrders` | `canCreateOrders` | `canEditOrders` |
| Purchasing | `canViewPurchases` | `canCreatePurchases` | `canEditPurchases` |
| Shelves | `canViewShelves` | `canCreateShelves` | `canEditShelves` |
| Inventory (receiving) | `canViewInventory` | `canCreateInventory` | `canEditInventory` |
| Shipping | `canViewShipping` | `canCreateShipping` | `canEditShipping` |
| Factories | `canViewFactories` | `canCreateFactories` | `canEditFactories` |
| Customers | `canViewCustomers` | `canCreateCustomers` | `canEditCustomers` |
| Users | `canViewUsers` | `canCreateUsers` (invite) | `canEditUsers` (change role, deactivate) |
| Organization | `canViewPermissions`, `canViewSystemSettings` | — | `canEditSystemSettings` |

Business data is never actually deleted: master data is deactivated and documents are cancelled, and both count as "edit".

## 3. Where checks happen

The single check function is `user_has_organization_permission(user, organization, permission key)` (implemented in the `private` schema; RLS policies call the implementation directly, and the `public` function of the same name is a wrapper the frontend and AI call over RPC). Every layer below uses it:

| Layer | Approach |
|-------|----------|
| Database RLS (the real boundary) | Business tables: SELECT needs the view key, INSERT the create key, UPDATE the edit key; master data and documents have no DELETE; line items and links follow the parent document's keys and cannot link to another organization's data. Members and roles can only be written through RPCs |
| Business APIs | Each API first checks the permission key for its action and confirms that all referenced data belongs to the same organization ([API.md](./API.md) §2.1) |
| Frontend | Routes and the sidebar show by view key; create, edit, deactivate and cancel buttons show by the matching key; without the edit key, details open read-only. This only keeps the screen consistent; it is not a security boundary |
| AI | Each tool declares the permission key it needs; when the user confirms a write the AI proposed, membership and permission are checked again |

## 4. Preventing privilege escalation

- Admins can assign admin, editor and viewer; they cannot change their own role or the owner's. An owner can only come from a transfer.
- AI query logs (`query_traces`) are visible only to their own user.
- Anonymous requests can neither read nor write any business data.
