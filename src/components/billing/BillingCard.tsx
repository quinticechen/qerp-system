import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailField } from '@/components/common/DetailField';
import { useOrganizationEntitlement } from '@/hooks/useOrganizationEntitlement';
import { openBillingPortal } from '@/lib/billingApi';
import { BILLING_PERIOD_LABELS, findPlan } from '@/lib/billingPlans';

const STATUS_LABELS = { pending: '尚未開通', active: '使用中', past_due: '付款失敗' } as const;
const STATUS_CLASSES = {
  pending: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  active: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  past_due: 'bg-red-100 text-red-800 hover:bg-red-100',
} as const;

interface BillingCardProps {
  organizationId: string;
  canEdit: boolean;
}

/** 方案與帳單 in organization settings: plan, usage, and Stripe's billing portal for paid plans. */
export function BillingCard({ organizationId, canEdit }: BillingCardProps) {
  const { data: entitlement, isLoading } = useOrganizationEntitlement(organizationId);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !entitlement) return null;
  const paid = entitlement.plan !== 'free';

  const manage = async () => {
    setOpening(true);
    setError(null);
    try {
      const { url } = await openBillingPortal(organizationId);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法開啟帳單頁面，請稍後再試');
      setOpening(false);
    }
  };

  const renewal = entitlement.current_period_end
    ? `${new Date(entitlement.current_period_end).toLocaleDateString('zh-TW')}${entitlement.cancel_at_period_end ? '（到期後改為免費方案）' : ''}`
    : '-';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" aria-hidden="true" />方案與帳單</CardTitle>
        <CardDescription>成員人數與 Query AI 助理用量依方案而定</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="方案">
            <span className="flex items-center gap-2">
              {findPlan(entitlement.plan).name}方案
              <Badge className={STATUS_CLASSES[entitlement.status]}>{STATUS_LABELS[entitlement.status]}</Badge>
            </span>
          </DetailField>
          <DetailField label="付款週期">{entitlement.billing_period ? BILLING_PERIOD_LABELS[entitlement.billing_period] : '-'}</DetailField>
          <DetailField label="下次續訂">{paid ? renewal : '-'}</DetailField>
          <DetailField label="成員">{entitlement.members} / {entitlement.max_members} 人</DetailField>
          <DetailField label="本月 Query 用量">
            {entitlement.query_messages_used.toLocaleString('en-US')} / {entitlement.query_messages_per_month.toLocaleString('en-US')} 則
          </DetailField>
        </div>
        {entitlement.status === 'past_due' && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">最近一次扣款失敗，請更新付款方式，以免方案中斷。</p>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-3">
            {paid ? (
              <Button onClick={manage} disabled={opening}>
                {opening && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                管理方案與付款
              </Button>
            ) : (
              <Button asChild><Link to="/pricing">升級方案</Link></Button>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
