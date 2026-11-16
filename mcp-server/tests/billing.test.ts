/**
 * Billing (docs/requirements/PRICING_AND_BILLING.md): Stripe signatures, webhook events → subscription
 * rows, checkout parameters and permissions, and Query's monthly allowance. No network.
 * Run: bun run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyStripeSignature } from "../src/billing/signature.js";
import { encodeParams, type StripeSubscription } from "../src/billing/stripe-client.js";
import { parseLookupKey, priceLookupKey } from "../src/billing/plans.js";
import { handleStripeEvent, subscriptionPatch, type SubscriptionRow, type SubscriptionStore } from "../src/billing/webhook.js";
import { createCheckout, createPortal } from "../src/billing/checkout.js";
import { NOT_ACTIVATED_REPLY, QUOTA_REACHED_REPLY, quotaReply } from "../src/billing/quota.js";

const ORG = "0e000000-0000-4000-8000-000000000001";
const SECRET = "whsec_test";

const sign = (body: string, t: number, secret = SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

test("a Stripe signature is accepted only for the exact body, the right secret and a fresh timestamp", () => {
  const body = '{"id":"evt_1"}';
  const now = 1_800_000_000;
  assert.equal(verifyStripeSignature(body, sign(body, now), SECRET, now), true);
  assert.equal(verifyStripeSignature(body + " ", sign(body, now), SECRET, now), false, "tampered body");
  assert.equal(verifyStripeSignature(body, sign(body, now, "whsec_other"), SECRET, now), false, "other secret");
  assert.equal(verifyStripeSignature(body, sign(body, now - 301), SECRET, now), false, "replayed");
  assert.equal(verifyStripeSignature(body, undefined, SECRET, now), false, "missing header");
  assert.equal(verifyStripeSignature(body, `t=${now},v1=deadbeef,${sign(body, now).split(",")[1]}`, SECRET, now), true, "any v1 may match");
});

test("prices are found by lookup key, and Stripe params are form-encoded with nesting", () => {
  assert.equal(priceLookupKey("standard", "two_years"), "qerp_standard_two_years");
  assert.deepEqual(parseLookupKey("qerp_pro_year"), { plan: "pro", period: "year" });
  assert.equal(parseLookupKey("qerp_enterprise_month"), null);
  assert.deepEqual(
    encodeParams({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }], metadata: { organization_id: ORG }, lookup_keys: ["k"], skip: undefined }),
    ["mode=subscription", "line_items%5B0%5D%5Bprice%5D=price_1", "line_items%5B0%5D%5Bquantity%5D=1", `metadata%5Borganization_id%5D=${ORG}`, "lookup_keys%5B0%5D=k"],
  );
});

const subscription = (overrides: Partial<StripeSubscription> = {}): StripeSubscription => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  cancel_at_period_end: false,
  metadata: { organization_id: ORG },
  items: { data: [{ price: { id: "price_1", lookup_key: "qerp_standard_year" }, current_period_end: 1_900_000_000 }] },
  ...overrides,
});

function memoryStore(row: Partial<SubscriptionRow> | null) {
  let current: SubscriptionRow | null = row ? {
    organization_id: ORG, plan: "free", status: "pending", billing_period: null, stripe_customer_id: null,
    stripe_subscription_id: null, current_period_end: null, cancel_at_period_end: false, activated_by: null, activated_at: null, ...row,
  } : null;
  const store: SubscriptionStore = {
    get: async () => current,
    update: async (_id, patch) => { current = { ...current!, ...patch }; },
  };
  return { store, row: () => current };
}

test("a paid checkout activates the organization on the plan and period it bought", async () => {
  const { store, row } = memoryStore({});
  const outcome = await handleStripeEvent(
    { id: "evt_1", type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "paid", client_reference_id: ORG, subscription: "sub_1" } } },
    store,
    { retrieveSubscription: async () => subscription() },
  );
  assert.equal(outcome, "activated");
  assert.equal(row()?.status, "active");
  assert.equal(row()?.plan, "standard");
  assert.equal(row()?.billing_period, "year");
  assert.equal(row()?.stripe_subscription_id, "sub_1");
  assert.equal(row()?.stripe_customer_id, "cus_1");
  assert.equal(row()?.activated_by, "stripe");
  assert.equal(row()?.current_period_end, new Date(1_900_000_000 * 1000).toISOString());
});

test("an unpaid checkout, or one for an unknown organization, changes nothing", async () => {
  const unpaid = memoryStore({});
  const event = (payment_status: string) => ({ id: "e", type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status, client_reference_id: ORG, subscription: "sub_1" } } });
  assert.equal(await handleStripeEvent(event("unpaid"), unpaid.store, { retrieveSubscription: async () => subscription() }), "ignored");
  assert.equal(unpaid.row()?.status, "pending");
  const missing = memoryStore(null);
  assert.equal(await handleStripeEvent(event("paid"), missing.store, { retrieveSubscription: async () => subscription() }), "ignored");
});

test("subscription updates follow the current subscription only; ending one drops to the free plan", async () => {
  const { store, row } = memoryStore({ plan: "standard", status: "active", billing_period: "year", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" });
  const noStripe = { retrieveSubscription: async () => { throw new Error("not called"); } };
  const updated = (sub: StripeSubscription) => ({ id: "e", type: "customer.subscription.updated", data: { object: sub as unknown as Record<string, unknown> } });

  assert.equal(await handleStripeEvent(updated(subscription({ status: "past_due" })), store, noStripe), "updated");
  assert.equal(row()?.status, "past_due");

  await handleStripeEvent(updated(subscription({ items: { data: [{ price: { id: "p", lookup_key: "qerp_pro_month" }, current_period_end: 1 }] } })), store, noStripe);
  assert.equal(row()?.plan, "pro");
  assert.equal(row()?.billing_period, "month");
  assert.equal(row()?.status, "active");

  assert.equal(await handleStripeEvent(updated(subscription({ id: "sub_old", status: "canceled" })), store, noStripe), "ignored", "an old subscription");
  assert.equal(row()?.plan, "pro");

  assert.equal(await handleStripeEvent({ id: "e", type: "customer.subscription.deleted", data: { object: subscription() as unknown as Record<string, unknown> } }, store, noStripe), "downgraded");
  assert.equal(row()?.plan, "free");
  assert.equal(row()?.status, "active", "data stays usable on the free plan");
  assert.equal(row()?.billing_period, null);
  assert.equal(row()?.stripe_subscription_id, null);
  assert.equal(row()?.stripe_customer_id, "cus_1", "the customer is kept for a later checkout");
});

test("a subscription with a price that isn't ours is ignored", () => {
  assert.equal(subscriptionPatch(subscription({ items: { data: [{ price: { id: "p", lookup_key: "other" } }] } })), null);
  assert.deepEqual(subscriptionPatch(subscription({ status: "incomplete" })), {});
});

function fakeUserClient(options: { allowed: boolean; subscription?: Record<string, unknown> | null; entitlement?: unknown; entitlementError?: { code: string; message: string } }) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "owner@example.com" } }, error: null }) },
    rpc: async (fn: string) => fn === "get_organization_entitlement"
      ? { data: options.entitlement ?? null, error: options.entitlementError ?? null }
      : { data: options.allowed, error: null },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.subscription ?? null, error: null }) }) }) }),
  } as unknown as SupabaseClient;
}

test("checkout starts a Stripe subscription for the organization and returns to the calling app", async () => {
  let params: Record<string, unknown> = {};
  const stripe = {
    findPrice: async (key: string) => (key === "qerp_pro_two_years" ? { id: "price_pro_2y", lookup_key: key } : null),
    createCheckoutSession: async (p: Record<string, unknown>) => { params = p; return { id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }; },
    createPortalSession: async () => ({ url: "" }),
  };
  const result = await createCheckout(
    { supabase: fakeUserClient({ allowed: true, subscription: { plan: "free", status: "pending", stripe_customer_id: null, stripe_subscription_id: null } }), stripe, appOrigin: "http://localhost:8080" },
    { organization_id: ORG, plan: "pro", period: "two_years" },
  );
  assert.equal(result.url, "https://checkout.stripe.com/c/cs_1");
  assert.equal(params.mode, "subscription");
  assert.deepEqual(params.line_items, [{ price: "price_pro_2y", quantity: 1 }]);
  assert.equal(params.client_reference_id, ORG);
  assert.equal(params.customer_email, "owner@example.com");
  assert.deepEqual(params.subscription_data, { metadata: { organization_id: ORG } });
  assert.equal(params.success_url, "http://localhost:8080/billing/success?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(params.cancel_url, "http://localhost:8080/pricing?canceled=1");
});

test("only owners and admins can pay, a paid organization can't check out twice, and plans are validated", async () => {
  const stripe = { findPrice: async () => ({ id: "p", lookup_key: "k" }), createCheckoutSession: async () => ({ id: "", url: "" }), createPortalSession: async () => ({ url: "" }) };
  const base = { stripe, appOrigin: "https://qerp.qwizai.com" };
  await assert.rejects(createCheckout({ ...base, supabase: fakeUserClient({ allowed: false }) }, { organization_id: ORG, plan: "standard", period: "month" }), { status: 403 });
  await assert.rejects(
    createCheckout({ ...base, supabase: fakeUserClient({ allowed: true, subscription: { plan: "standard", status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" } }) }, { organization_id: ORG, plan: "pro", period: "month" }),
    { status: 409 },
  );
  await assert.rejects(createCheckout({ ...base, supabase: fakeUserClient({ allowed: true }) }, { organization_id: ORG, plan: "free", period: "month" }), { status: 400 });
  await assert.rejects(createPortal({ ...base, supabase: fakeUserClient({ allowed: true, subscription: { plan: "free", status: "active", stripe_customer_id: null, stripe_subscription_id: null } }) }, { organization_id: ORG }), { status: 404 });
});

test("Query's monthly allowance: pending and used-up organizations get a fixed reply; lookup failures don't block", async () => {
  const entitlement = (status: string, used: number) => ({ status, query_messages_per_month: 100, query_messages_used: used });
  assert.equal(await quotaReply(fakeUserClient({ allowed: true, entitlement: entitlement("pending", 0) }), ORG), NOT_ACTIVATED_REPLY);
  assert.equal(await quotaReply(fakeUserClient({ allowed: true, entitlement: entitlement("active", 100) }), ORG), null, "the 100th question is allowed");
  assert.equal(await quotaReply(fakeUserClient({ allowed: true, entitlement: entitlement("active", 101) }), ORG), QUOTA_REACHED_REPLY);
  assert.equal(await quotaReply(fakeUserClient({ allowed: true, entitlementError: { code: "PGRST202", message: "missing" } }), ORG), null);
});
