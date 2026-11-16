/**
 * Plans shown on the pricing page (docs/requirements/PRICING_AND_BILLING.md §2).
 * Prices must match the Stripe prices (lookup key qerp_<plan>_<period>, amounts in TWD incl. tax);
 * limits must match private.plan_limits() in the database.
 */

export type PlanCode = 'free' | 'standard' | 'pro';
export type PaidPlanCode = Exclude<PlanCode, 'free'>;
export type BillingPeriod = 'month' | 'year' | 'two_years';

export const BILLING_PERIODS: BillingPeriod[] = ['month', 'year', 'two_years'];

export const BILLING_PERIOD_LABELS: Record<BillingPeriod, string> = {
  month: '月繳',
  year: '年繳',
  two_years: '兩年繳',
};

/** Shown under the price, e.g. "/ 月". */
export const BILLING_PERIOD_UNITS: Record<BillingPeriod, string> = {
  month: '/ 月',
  year: '/ 年',
  two_years: '/ 2 年',
};

export const BILLING_PERIOD_MONTHS: Record<BillingPeriod, number> = { month: 1, year: 12, two_years: 24 };

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  tagline: string;
  maxMembers: number;
  queryMessagesPerMonth: number;
  /** TWD per billing period; null for the free plan. */
  prices: Record<BillingPeriod, number> | null;
  highlighted?: boolean;
}

export const PLANS: PlanDefinition[] = [
  {
    code: 'free',
    name: '免費',
    tagline: '先試用、小型布行',
    maxMembers: 3,
    queryMessagesPerMonth: 100,
    prices: null,
  },
  {
    code: 'standard',
    name: '標準',
    tagline: '一般紡織貿易商',
    maxMembers: 10,
    queryMessagesPerMonth: 1000,
    prices: { month: 1490, year: 14900, two_years: 26800 },
    highlighted: true,
  },
  {
    code: 'pro',
    name: '專業',
    tagline: '多人分工、量大',
    maxMembers: 30,
    queryMessagesPerMonth: 5000,
    prices: { month: 3990, year: 39900, two_years: 71800 },
  },
];

/** Every plan includes the whole ERP; plans differ only in seats and Query messages. */
export const PLAN_INCLUDES = ['訂單、採購、入庫、庫存、出貨全部功能', '產品、客戶、工廠、貨架主檔', '四種角色權限與編輯紀錄'];

export const isPaidPlanCode = (value: string | null): value is PaidPlanCode => value === 'standard' || value === 'pro';
export const isBillingPeriod = (value: string | null): value is BillingPeriod => BILLING_PERIODS.includes(value as BillingPeriod);

export const findPlan = (code: PlanCode): PlanDefinition => PLANS.find((plan) => plan.code === code)!;

export const formatTwd = (amount: number): string => `NT$${amount.toLocaleString('en-US')}`;

/** What a period would cost at the monthly price (e.g. 12 × monthly for a year). */
export const monthlyListPrice = (prices: Record<BillingPeriod, number>, period: BillingPeriod): number =>
  prices.month * BILLING_PERIOD_MONTHS[period];

/** TWD saved against paying monthly for the same length of time; 0 for monthly. */
export const savingsAmount = (prices: Record<BillingPeriod, number>, period: BillingPeriod): number =>
  monthlyListPrice(prices, period) - prices[period];

/** Percent saved against paying monthly, rounded to a whole percent (yearly 17%, two-year 25%). */
export const savingsPercent = (prices: Record<BillingPeriod, number>, period: BillingPeriod): number =>
  Math.round((savingsAmount(prices, period) / monthlyListPrice(prices, period)) * 100);

/** The saving every paid plan reaches for a period, for the period switch (the smallest, so it is never overstated). */
export const periodSavingsPercent = (period: BillingPeriod): number =>
  Math.min(...PLANS.flatMap((plan) => (plan.prices ? [savingsPercent(plan.prices, period)] : [])));

/** Average monthly cost of a period's price, rounded to the dollar. */
export const monthlyEquivalent = (amount: number, period: BillingPeriod): number => Math.round(amount / BILLING_PERIOD_MONTHS[period]);
