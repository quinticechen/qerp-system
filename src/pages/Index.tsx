
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/contexts/OrganizationContext';

const Index = () => {
  const { user, loading: authLoading } = useAuth();
  const { hasNoOrganizations, loading: orgLoading } = useOrganizationContext();
  const navigate = useNavigate();
  const [hasNavigated, setHasNavigated] = useState(false);

  useEffect(() => {
    // 避免重複導航
    if (hasNavigated) return;

    // 等待認證和組織數據加載完成
    if (authLoading || orgLoading) return;

    // 未登入用戶導向登入頁面
    if (!user) {
      setHasNavigated(true);
      navigate('/login', { replace: true });
      return;
    }

    // 已登入但沒有組織的用戶導向創建組織頁面
    if (hasNoOrganizations) {
      setHasNavigated(true);
      navigate('/create-organization', { replace: true });
      return;
    }

    // 已登入且有組織的用戶導向儀表板
    setHasNavigated(true);
    navigate('/dashboard', { replace: true });
  }, [user, hasNoOrganizations, authLoading, orgLoading, navigate, hasNavigated]);

  // 顯示載入狀態
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-slate-600">載入中...</p>
      </div>
    </div>
  );
};

export default Index;
