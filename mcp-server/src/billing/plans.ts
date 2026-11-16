/**
 * Paid plans and billing periods (docs/requirements/PRICING_AND_BILLING.md). Stripe prices are found
 * by lookup key, so the code never holds Stripe ids: qerp_<plan>_<period>, e.g. qerp_standard_year.
 * Keep in step with src/lib/billingPlans.ts and private.plan_limits().
 */

export const PAID_PLANS = ["standard", "pro"] as const;
export const BILLING_PERIODS = ["month", "year", "two_years"] as const;

export type PaidPlan = (typeof PAID_PLANS)[number];
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const isPaidPlan = (value: unknown): value is PaidPlan => PAID_PLANS.includes(value as PaidPlan);
export const isBillingPeriod = (value: unknown): value is BillingPeriod => BILLING_PERIODS.includes(value as BillingPeriod);

export const priceLookupKey = (plan: PaidPlan, period: BillingPeriod): string => `qerp_${plan}_${period}`;

/** The plan and period a Stripe price's lookup key stands for, or null for an unknown key. */
export function parseLookupKey(key: string | null | undefined): { plan: PaidPlan; period: BillingPeriod } | null {
  const match = /^qerp_(standard|pro)_(month|year|two_years)$/.exec(key ?? "");
  return match ? { plan: match[1] as PaidPlan, period: match[2] as BillingPeriod } : null;
}
