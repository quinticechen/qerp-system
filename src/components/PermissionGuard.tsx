
import React from 'react';
import { usePermissions, Permission } from '@/hooks/usePermissions';

interface PermissionGuardProps {
  permission: keyof Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const PermissionGuard: React.FC<PermissionGuardProps> = ({
  permission,
  children,
  fallback = null,
}) => {
  const { hasPermission, loading } = usePermissions();

  if (loading) {
    return <div className="text-center py-4 text-gray-500">載入中...</div>;
  }

  if (!hasPermission(permission)) {
    return fallback ? (
      <>{fallback}</>
    ) : (
      <div className="text-center py-8">
        <h3 className="text-lg font-semibold text-gray-700 mb-2">權限不足</h3>
        <p className="text-gray-500">您沒有權限存取此功能</p>
      </div>
    );
  }

  return <>{children}</>;
};
