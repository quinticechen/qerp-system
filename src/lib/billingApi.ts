import { postQueryApi } from '@/lib/queryApi';
import type { BillingPeriod, PaidPlanCode } from '@/lib/billingPlans';

/** Starts Stripe Checkout for the organization; resolves to the Stripe page to open. */
export const startCheckout = (organizationId: string, plan: PaidPlanCode, period: BillingPeriod) =>
  postQueryApi<{ url: string }>('/billing/checkout', { organization_id: organizationId, plan, period });

/** Opens Stripe's billing portal (change plan, card, invoices, cancel). */
export const openBillingPortal = (organizationId: string) =>
  postQueryApi<{ url: string }>('/billing/portal', { organization_id: organizationId });
