
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useOrganizationContext } from '@/contexts/OrganizationContext';

interface OrganizationGuardProps {
  children: React.ReactNode;
}

export const OrganizationGuard: React.FC<OrganizationGuardProps> = ({ children }) => {
  const { hasNoOrganizations, loading, currentOrganization } = useOrganizationContext();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">載入組織資料中...</p>
        </div>
      </div>
    );
  }

  // 如果使用者沒有組織，導向創建組織頁面
  if (hasNoOrganizations) {
    return <Navigate to="/create-organization" replace />;
  }

  // 如果沒有選擇當前組織，顯示載入中
  if (!currentOrganization) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">設定組織環境中...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
