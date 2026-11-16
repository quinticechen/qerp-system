/**
 * POST /billing/checkout and /billing/portal (docs/requirements/PRICING_AND_BILLING.md §4).
 * Called with the user's JWT; only the organization's owner or an admin (canEditSystemSettings) may
 * start a subscription or manage billing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { AccessError } from "../agent/auth-guard.js";
import { isBillingPeriod, isPaidPlan, priceLookupKey } from "./plans.js";
import type { StripeClient } from "./stripe-client.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BillingContext {
  supabase: SupabaseClient;
  stripe: Pick<StripeClient, "findPrice" | "createCheckoutSession" | "createPortalSession">;
  /** Where the browser returns to: the calling app's origin when it's allowed, else production. */
  appOrigin: string;
}

interface OrganizationBilling {
  userEmail: string | undefined;
  subscription: { plan: string; status: string; stripe_customer_id: string | null; stripe_subscription_id: string | null } | null;
}

async function requireBillingAdmin(supabase: SupabaseClient, organizationId: unknown): Promise<OrganizationBilling & { organizationId: string }> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AccessError("Invalid or expired JWT", 401);
  if (typeof organizationId !== "string" || !UUID_RE.test(organizationId)) throw new AccessError("organization_id is required", 400);

  const { data: allowed, error: permissionError } = await supabase.rpc("user_has_organization_permission", {
    _user_id: user.id, _organization_id: organizationId, _permission: "canEditSystemSettings",
  });
  if (permissionError) throw new Error(`Permission check failed: ${permissionError.message}`);
  if (allowed !== true) throw new AccessError("只有擁有者或管理員可以管理方案", 403);

  const { data: subscription } = await supabase.from("organization_subscriptions")
    .select("plan, status, stripe_customer_id, stripe_subscription_id").eq("organization_id", organizationId).maybeSingle();
  return { organizationId, userEmail: user.email, subscription };
}

export async function createCheckout(context: BillingContext, body: { organization_id?: unknown; plan?: unknown; period?: unknown }): Promise<{ url: string }> {
  const { plan, period } = body;
  if (!isPaidPlan(plan) || !isBillingPeriod(period)) throw new AccessError("plan or period is invalid", 400);
  const { organizationId, userEmail, subscription } = await requireBillingAdmin(context.supabase, body.organization_id);
  if (subscription?.stripe_subscription_id) throw new AccessError("這個組織已有付費訂閱，請到「方案與帳單」變更", 409);

  const price = await context.stripe.findPrice(priceLookupKey(plan, period));
  if (!price) throw new Error(`Stripe price ${priceLookupKey(plan, period)} not found`);

  const session = await context.stripe.createCheckoutSession({
    mode: "subscription",
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: organizationId,
    ...(subscription?.stripe_customer_id ? { customer: subscription.stripe_customer_id } : { customer_email: userEmail }),
    metadata: { organization_id: organizationId, plan, period },
    subscription_data: { metadata: { organization_id: organizationId } },
    allow_promotion_codes: true,
    locale: "zh-TW",
    success_url: `${context.appOrigin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${context.appOrigin}/pricing?canceled=1`,
  });
  return { url: session.url };
}

export async function createPortal(context: BillingContext, body: { organization_id?: unknown }): Promise<{ url: string }> {
  const { subscription } = await requireBillingAdmin(context.supabase, body.organization_id);
  if (!subscription?.stripe_customer_id) throw new AccessError("這個組織還沒有付款紀錄", 404);
  return context.stripe.createPortalSession(subscription.stripe_customer_id, `${context.appOrigin}/system`);
}
