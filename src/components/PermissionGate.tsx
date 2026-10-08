import React from 'react';
import { usePermissions, Permission } from '@/hooks/usePermissions';

interface PermissionGateProps {
  permission: keyof Permission;
  children: React.ReactNode;
}

// Renders its children only when the current user holds the permission, and nothing otherwise
// (also while permissions are loading). Use it for buttons; use PermissionGuard for whole pages.
export const PermissionGate: React.FC<PermissionGateProps> = ({ permission, children }) => {
  const { hasPermission, loading } = usePermissions();

  if (loading || !hasPermission(permission)) return null;

  return <>{children}</>;
};
