
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SEO } from '@/components/SEO';
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

    console.log('Index navigation check:', { 
      user: !!user, 
      hasNoOrganizations, 
      authLoading, 
      orgLoading,
      hasNavigated 
    });

    // 如果還在載入認證或組織資料，等待
    if (authLoading) {
      console.log('Still loading auth, waiting...');
      return;
    }

    // 未登入用戶導向登入頁面
    if (!user) {
      console.log('Redirecting to login - no user');
      setHasNavigated(true);
      navigate('/login', { replace: true });
      return;
    }

    // 用戶已登入，但組織資料還在載入中
    if (orgLoading) {
      console.log('User logged in, but organizations still loading...');
      return;
    }

    // 已登入但沒有組織的用戶導向創建組織頁面
    if (hasNoOrganizations) {
      console.log('Redirecting to create organization - no organizations');
      setHasNavigated(true);
      navigate('/create-organization', { replace: true });
      return;
    }

    // 已登入且有組織的用戶導向儀表板
    console.log('Redirecting to dashboard - user has organizations');
    setHasNavigated(true);
    navigate('/dashboard', { replace: true });
  }, [user, hasNoOrganizations, authLoading, orgLoading, navigate, hasNavigated]);

  // 顯示載入狀態
  return (
    <>
      <SEO
        title="首頁"
        description="專業的紡織業企業資源管理系統，提供完整的訂單、庫存、採購、出貨管理解決方案。提升紡織業營運效率的最佳選擇。"
        keywords="紡織業ERP, 企業資源管理, 訂單管理系統, 庫存管理, 採購管理, 出貨管理"
      />
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-slate-800 mb-4">紡織業 ERP 系統</h1>
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">
            {authLoading ? '載入用戶資料中...' : orgLoading ? '載入組織資料中...' : '載入中...'}
          </p>
        </div>
      </div>
    </>
  );
};

export default Index;
