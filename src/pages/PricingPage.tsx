import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SEO } from '@/components/SEO';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { HomeHeader } from '@/components/home/HomeHeader';
import { HomeFooter } from '@/components/home/HomeFooter';
import { TrialRequestDialog } from '@/components/home/TrialRequestDialog';
import { PricingPlanCard } from '@/components/pricing/PricingPlanCard';
import { BILLING_PERIODS, BILLING_PERIOD_LABELS, BILLING_PERIOD_SAVINGS, PLANS, type BillingPeriod } from '@/lib/billingPlans';
import { SITE_NAME, SITE_URL } from '@/lib/siteMeta';

const PRICING_JSON_LD: Record<string, unknown>[] = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: `${SITE_URL}/pricing`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: PLANS.flatMap((plan) =>
      plan.prices
        ? BILLING_PERIODS.map((period) => ({
            '@type': 'Offer',
            name: `${SITE_NAME} ${plan.name}方案（${BILLING_PERIOD_LABELS[period]}）`,
            price: String(plan.prices![period]),
            priceCurrency: 'TWD',
          }))
        : [{ '@type': 'Offer', name: `${SITE_NAME} 免費方案`, price: '0', priceCurrency: 'TWD' }],
    ),
  },
];

const NOTES = [
  '價格皆為新台幣，含稅。',
  '付費方案以信用卡付款，付款完成後組織立即開通；可隨時在「組織設定」變更方案或取消，取消後於期滿時改為免費方案，資料完整保留。',
  '免費方案由專人與您聯繫後開通。',
];

/** /pricing: free (contact us) and two paid plans, each monthly, yearly or every two years. */
const PricingPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [period, setPeriod] = useState<BillingPeriod>('year');
  const [trialOpen, setTrialOpen] = useState(false);
  const canceled = searchParams.get('canceled') === '1';

  return (
    <div className="min-h-screen bg-slate-50 text-left text-slate-900">
      <SEO
        title="方案與價格"
        description="QERP 紡織業 ERP 方案與價格：免費方案專人開通；標準、專業方案可月繳、年繳或兩年繳，付款後立即開通。"
        keywords="紡織業 ERP 價格, ERP 訂閱, 布行管理系統 價格, QERP 方案"
        jsonLd={PRICING_JSON_LD}
      />
      <HomeHeader />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold text-slate-900 sm:text-5xl">選擇適合的方案</h1>
          <p className="mt-4 text-lg text-slate-600">所有方案都包含完整的 ERP 功能，依成員人數與 AI 助理用量分級。</p>
        </div>

        {canceled && (
          <p role="status" className="mx-auto mt-8 max-w-xl rounded-lg bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
            付款未完成，沒有收取任何費用。可以重新選擇方案。
          </p>
        )}

        <div className="mt-10 flex justify-center">
          <ToggleGroup
            type="single"
            value={period}
            onValueChange={(value) => value && setPeriod(value as BillingPeriod)}
            aria-label="付款週期"
            className="rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200"
          >
            {BILLING_PERIODS.map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="whitespace-nowrap rounded-full px-4 data-[state=on]:bg-indigo-600 data-[state=on]:text-white sm:px-5"
              >
                {BILLING_PERIOD_LABELS[value]}
                {BILLING_PERIOD_SAVINGS[value] && <span className="ml-1.5 hidden text-xs opacity-80 sm:inline">{BILLING_PERIOD_SAVINGS[value]}</span>}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <PricingPlanCard
              key={plan.code}
              plan={plan}
              period={period}
              onSelect={() => (plan.prices ? navigate(`/checkout?plan=${plan.code}&period=${period}`) : setTrialOpen(true))}
            />
          ))}
        </div>

        <ul className="mx-auto mt-12 max-w-3xl space-y-2 text-sm text-slate-500">
          {NOTES.map((note) => <li key={note}>・{note}</li>)}
        </ul>
      </main>
      <HomeFooter />
      <TrialRequestDialog open={trialOpen} onOpenChange={setTrialOpen} />
    </div>
  );
};

export default PricingPage;
