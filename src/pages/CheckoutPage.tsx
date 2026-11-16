import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SEO } from '@/components/SEO';
import { HomeLogo } from '@/components/home/HomeLogo';
import { useOrganizationContext } from '@/contexts/OrganizationContext';
import { useOrganizationPermissions } from '@/hooks/useOrganizationPermissions';
import { startCheckout } from '@/lib/billingApi';
import { BILLING_PERIOD_LABELS, BILLING_PERIOD_UNITS, findPlan, formatTwd, isBillingPeriod, isPaidPlanCode } from '@/lib/billingPlans';

/**
 * /checkout?plan=&period=: confirms which organization is subscribing, then hands over to Stripe.
 * Signed-out visitors arrive here after signing in; people without an organization create one first.
 */
const CheckoutPage = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentOrganization, hasNoOrganizations, loading } = useOrganizationContext();
  const { hasPermission, loading: permissionsLoading } = useOrganizationPermissions();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const planCode = searchParams.get('plan');
  const period = searchParams.get('period');
  const here = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!loading && hasNoOrganizations) navigate(`/create-organization?next=${encodeURIComponent(here)}`, { replace: true });
  }, [loading, hasNoOrganizations, navigate, here]);

  if (!isPaidPlanCode(planCode) || !isBillingPeriod(period)) return <Navigate to="/pricing" replace />;

  const plan = findPlan(planCode);
  const price = plan.prices![period];
  const canPay = hasPermission('canEditSystemSettings');

  const pay = async () => {
    if (!currentOrganization) return;
    setSubmitting(true);
    setError(null);
    try {
      const { url } = await startCheckout(currentOrganization.id, planCode, period);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法前往付款，請稍後再試');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-left">
      <SEO title="確認訂閱" description="確認 QERP 訂閱方案" noindex />
      <div className="mx-auto max-w-lg">
        <HomeLogo />
        <div className="mt-8 rounded-2xl bg-white p-7 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-2xl font-bold text-slate-900">確認訂閱</h1>
          {loading || permissionsLoading || !currentOrganization ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-600" aria-label="載入中" /></div>
          ) : (
            <>
              <dl className="mt-6 space-y-3 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">組織</dt><dd className="font-medium text-slate-900">{currentOrganization.name}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">方案</dt><dd className="font-medium text-slate-900">{plan.name}（{plan.maxMembers} 位成員・Query 每月 {plan.queryMessagesPerMonth.toLocaleString('en-US')} 則）</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">付款週期</dt><dd className="font-medium text-slate-900">{BILLING_PERIOD_LABELS[period]}</dd></div>
                <div className="flex justify-between border-t border-slate-100 pt-3 text-base"><dt className="text-slate-700">金額（含稅）</dt><dd className="font-bold text-slate-900">{formatTwd(price)} {BILLING_PERIOD_UNITS[period]}</dd></div>
              </dl>
              <p className="mt-4 text-xs text-slate-500">要為其他組織訂閱，請先在 ERP 右上角切換組織。訂閱會自動續訂，可隨時在「組織設定」取消。</p>

              {canPay ? (
                <Button onClick={pay} disabled={submitting} className="mt-6 h-11 w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-base text-white hover:from-blue-700 hover:to-indigo-700">
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  前往付款
                </Button>
              ) : (
                <p role="alert" className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">只有組織的擁有者或管理員可以訂閱方案。</p>
              )}
              {error && <p role="alert" className="mt-3 text-sm font-medium text-destructive">{error}</p>}
              <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                由 Stripe 安全處理付款，QERP 不會取得您的卡號
              </p>
            </>
          )}
        </div>
        <Link to="/pricing" className="mt-6 block text-center text-sm text-slate-500 hover:text-indigo-600">返回方案與價格</Link>
      </div>
    </div>
  );
};

export default CheckoutPage;
