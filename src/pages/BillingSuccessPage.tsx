import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SEO } from '@/components/SEO';
import { HomeLogo } from '@/components/home/HomeLogo';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { useOrganizationEntitlement } from '@/hooks/useOrganizationEntitlement';
import { findPlan } from '@/lib/billingPlans';

/** How long to wait for Stripe's webhook before suggesting a refresh. */
const WAIT_MS = 60_000;

/** /billing/success: Stripe returns here; the organization is activated once the webhook lands. */
const BillingSuccessPage = () => {
  const { currentOrganization } = useOrganizationContext();
  const [timedOut, setTimedOut] = useState(false);
  const { data: entitlement } = useOrganizationEntitlement(currentOrganization?.id, { refetchInterval: timedOut ? false : 2000 });
  const activated = !!entitlement && entitlement.plan !== 'free' && entitlement.status === 'active';

  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-left">
      <SEO title="付款完成" description="QERP 訂閱付款完成" noindex />
      <div className="mx-auto max-w-lg">
        <HomeLogo />
        <div className="mt-8 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200" role="status">
          {activated ? (
            <>
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" aria-hidden="true" />
              <h1 className="mt-4 text-2xl font-bold text-slate-900">開通完成</h1>
              <p className="mt-3 text-slate-600">
                {currentOrganization?.name} 已升級為{findPlan(entitlement.plan).name}方案，最多 {entitlement.max_members} 位成員。
              </p>
              <Button asChild className="mt-6 h-11 bg-gradient-to-r from-blue-600 to-indigo-600 px-8 text-white hover:from-blue-700 hover:to-indigo-700">
                <Link to="/dashboard">開始使用</Link>
              </Button>
            </>
          ) : timedOut ? (
            <>
              <h1 className="text-2xl font-bold text-slate-900">付款已完成</h1>
              <p className="mt-3 text-slate-600">開通比平常久一點，請稍後重新整理。若幾分鐘後仍未開通，請與我們聯繫。</p>
              <Button variant="outline" className="mt-6" onClick={() => window.location.reload()}>重新整理</Button>
            </>
          ) : (
            <>
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-indigo-600" aria-hidden="true" />
              <h1 className="mt-4 text-2xl font-bold text-slate-900">付款完成，正在開通…</h1>
              <p className="mt-3 text-slate-600">通常幾秒鐘內就會完成，請不要關閉這個頁面。</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BillingSuccessPage;
