import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BILLING_PERIOD_UNITS,
  PLAN_INCLUDES,
  formatTwd,
  monthlyEquivalent,
  savingsAmount,
  savingsPercent,
  type BillingPeriod,
  type PlanDefinition,
} from '@/lib/billingPlans';

interface PricingPlanCardProps {
  plan: PlanDefinition;
  period: BillingPeriod;
  onSelect: () => void;
}

export function PricingPlanCard({ plan, period, onSelect }: PricingPlanCardProps) {
  const price = plan.prices?.[period];
  const highlighted = plan.highlighted === true;

  return (
    <article
      aria-label={`${plan.name}方案`}
      className={`relative flex flex-col rounded-2xl bg-white p-7 text-left shadow-sm ${highlighted ? 'ring-2 ring-indigo-600 shadow-xl shadow-indigo-500/10' : 'ring-1 ring-slate-200'}`}
    >
      {highlighted && (
        <Badge className="absolute -top-3 left-7 bg-indigo-600 text-white hover:bg-indigo-600">最多人選擇</Badge>
      )}
      <h2 className="text-xl font-semibold text-slate-900">{plan.name}</h2>
      <p className="mt-1 text-sm text-slate-500">{plan.tagline}</p>

      <div className="mt-6 min-h-[88px]">
        {price === undefined ? (
          <>
            <p className="text-4xl font-bold text-slate-900">NT$0</p>
            <p className="mt-2 text-sm text-slate-500">專人聯繫，為您開通</p>
          </>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-2 text-4xl font-bold text-slate-900">
              <span>
                {formatTwd(price)}
                <span className="ml-1 text-base font-normal text-slate-500">{BILLING_PERIOD_UNITS[period]}</span>
              </span>
              {period !== 'month' && plan.prices && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-semibold text-emerald-700">
                  省 {savingsPercent(plan.prices, period)}%
                </span>
              )}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {period === 'month' || !plan.prices
                ? '每月自動續訂，可隨時取消'
                : `約 ${formatTwd(monthlyEquivalent(price, period))} / 月，比月繳省 ${formatTwd(savingsAmount(plan.prices, period))}`}
            </p>
          </>
        )}
      </div>

      <Button
        onClick={onSelect}
        variant={highlighted ? 'default' : 'outline'}
        className={`mt-6 h-11 w-full text-base ${highlighted ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700' : ''}`}
      >
        {price === undefined ? '申請免費試用' : `選擇${plan.name}方案`}
      </Button>

      <ul className="mt-7 space-y-3 text-sm text-slate-700">
        <li className="flex gap-2"><Check className="h-5 w-5 shrink-0 text-indigo-600" aria-hidden="true" />最多 {plan.maxMembers} 位成員</li>
        <li className="flex gap-2"><Check className="h-5 w-5 shrink-0 text-indigo-600" aria-hidden="true" />Query AI 助理每月 {plan.queryMessagesPerMonth.toLocaleString('en-US')} 則</li>
        {PLAN_INCLUDES.map((item) => (
          <li key={item} className="flex gap-2"><Check className="h-5 w-5 shrink-0 text-indigo-600" aria-hidden="true" />{item}</li>
        ))}
        <li className="flex gap-2">
          <Check className="h-5 w-5 shrink-0 text-indigo-600" aria-hidden="true" />
          {price === undefined ? '我們致電確認後手動開通' : '付款完成後立即開通'}
        </li>
      </ul>
    </article>
  );
}
