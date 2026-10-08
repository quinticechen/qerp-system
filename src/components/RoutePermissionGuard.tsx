import React from 'react';
import { useLocation } from 'react-router-dom';
import { PermissionGuard } from '@/components/PermissionGuard';
import { ROUTE_PERMISSIONS } from '@/lib/routePermissions';

// Shows a page only to members holding the permission ROUTE_PERMISSIONS lists for its path
export const RoutePermissionGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  const permission = ROUTE_PERMISSIONS[pathname];

  if (!permission) return <>{children}</>;

  return <PermissionGuard permission={permission}>{children}</PermissionGuard>;
};
