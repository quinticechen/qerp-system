import type { PermissionKey } from '@/lib/permissionLabels';

// The permission needed to open each page; used by both the route guard and the sidebar.
// Pages not listed here (e.g. the dashboard) are open to every member.
export const ROUTE_PERMISSIONS: Record<string, PermissionKey> = {
  '/product': 'canViewProducts',
  '/order': 'canViewOrders',
  '/purchase': 'canViewPurchases',
  '/shelf': 'canViewShelves',
  '/inventory': 'canViewInventory',
  '/shipping': 'canViewShipping',
  '/factory': 'canViewFactories',
  '/customer': 'canViewCustomers',
  '/user': 'canViewUsers',
  '/permission': 'canViewPermissions',
  '/system': 'canViewSystemSettings',
};
