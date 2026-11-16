/**
 * Stripe webhook events → organization_subscriptions (docs/requirements/PRICING_AND_BILLING.md §4).
 * A paid checkout activates the organization; renewals, failed payments and plan changes follow
 * the subscription; a subscription that ends drops the organization to the free plan (data kept).
 */

import { parseLookupKey, type BillingPeriod } from "./plans.js";
import type { StripeClient, StripeSubscription } from "./stripe-client.js";

export interface SubscriptionRow {
  organization_id: string;
  plan: "free" | "standard" | "pro";
  status: "pending" | "active" | "past_due";
  billing_period: BillingPeriod | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  activated_by: "manual" | "stripe" | null;
  activated_at: string | null;
}

export type SubscriptionPatch = Partial<Omit<SubscriptionRow, "organization_id">>;

/** Where subscription rows live; the Supabase implementation uses the service role. */
export interface SubscriptionStore {
  get(organizationId: string): Promise<SubscriptionRow | null>;
  update(organizationId: string, patch: SubscriptionPatch): Promise<void>;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export type WebhookOutcome = "activated" | "updated" | "downgraded" | "ignored";

const FREE_PLAN: SubscriptionPatch = {
  plan: "free",
  status: "active",
  billing_period: null,
  stripe_subscription_id: null,
  current_period_end: null,
  cancel_at_period_end: false,
};

const toIso = (seconds: number | undefined): string | null => (seconds ? new Date(seconds * 1000).toISOString() : null);

/** The row fields a live Stripe subscription implies, or null when its price isn't one of ours. */
export function subscriptionPatch(subscription: StripeSubscription): SubscriptionPatch | null {
  const item = subscription.items.data[0];
  const price = parseLookupKey(item?.price.lookup_key);
  if (!price) return null;
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") return FREE_PLAN;
  // incomplete: the first payment hasn't gone through yet; nothing changes until it does.
  if (subscription.status === "incomplete") return {};
  return {
    plan: price.plan,
    billing_period: price.period,
    status: subscription.status === "past_due" || subscription.status === "unpaid" ? "past_due" : "active",
    stripe_subscription_id: subscription.id,
    stripe_customer_id: subscription.customer,
    current_period_end: toIso(subscription.current_period_end ?? item.current_period_end),
    cancel_at_period_end: subscription.cancel_at_period_end,
  };
}

export async function handleStripeEvent(event: StripeEvent, store: SubscriptionStore, stripe: Pick<StripeClient, "retrieveSubscription">): Promise<WebhookOutcome> {
  const object = event.data.object;

  if (event.type === "checkout.session.completed") {
    const organizationId = (object.client_reference_id as string | null) ?? (object.metadata as Record<string, string> | undefined)?.organization_id;
    if (object.mode !== "subscription" || !organizationId || typeof object.subscription !== "string") return "ignored";
    if (object.payment_status !== "paid" && object.payment_status !== "no_payment_required") return "ignored";
    if (!(await store.get(organizationId))) return "ignored";

    const patch = subscriptionPatch(await stripe.retrieveSubscription(object.subscription));
    if (!patch || !patch.plan) return "ignored";
    await store.update(organizationId, { ...patch, activated_by: "stripe", activated_at: new Date().toISOString() });
    return "activated";
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = object as unknown as StripeSubscription;
    const organizationId = subscription.metadata?.organization_id;
    if (!organizationId) return "ignored";
    const row = await store.get(organizationId);
    // Only the organization's current subscription may change it (events can arrive late or out of order).
    if (!row || row.stripe_subscription_id !== subscription.id) return "ignored";

    if (event.type === "customer.subscription.deleted") {
      await store.update(organizationId, FREE_PLAN);
      return "downgraded";
    }
    const patch = subscriptionPatch(subscription);
    if (!patch || Object.keys(patch).length === 0) return "ignored";
    await store.update(organizationId, patch);
    return patch.plan === "free" ? "downgraded" : "updated";
  }

  return "ignored";
}
