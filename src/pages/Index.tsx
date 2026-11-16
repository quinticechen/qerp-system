import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { HomePage } from '@/components/home/HomePage';
import { hasStoredSession } from '@/lib/storedSession';

/**
 * `/`: signed-out visitors (and crawlers) see the public Home page; signed-in members go to
 * /dashboard, or /create-organization when they have no organization yet.
 */
const Index = () => {
  const { user, loading: authLoading } = useAuth();
  const { hasNoOrganizations, loading: orgLoading } = useOrganizationContext();
  const navigate = useNavigate();
  const [mayBeSignedIn] = useState(hasStoredSession);

  useEffect(() => {
    if (authLoading || !user || orgLoading) return;
    navigate(hasNoOrganizations ? '/create-organization' : '/dashboard', { replace: true });
  }, [user, hasNoOrganizations, authLoading, orgLoading, navigate]);

  const signedOut = authLoading ? !mayBeSignedIn : !user;
  if (signedOut) return <HomePage />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-600">{orgLoading ? '載入組織資料中...' : '載入中...'}</p>
      </div>
    </div>
  );
};

export default Index;
