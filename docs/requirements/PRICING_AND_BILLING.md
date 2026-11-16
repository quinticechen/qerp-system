# Pricing, Subscriptions and Activation

> Requirement document. Status: in progress (2026-11-16): code done; migration, Stripe products and Cloud Run secrets awaiting the user. Owner: user request (neither parallel session; see [SESSION_COORDINATION.md](../SESSION_COORDINATION.md) §6). Follows [HOME_PAGE.md](./HOME_PAGE.md).

## 1. Decisions (user, 2026-11-16)

| Question | Decision |
|----------|----------|
| Where 「免費試用」 (free trial) goes | To a new public `/pricing` page |
| Plans | Free, Standard, Pro. Paid plans billed monthly, yearly or every two years |
| Free plan | Contact form (the existing `trial_requests`); the team calls and **activates manually** |
| Paid plans | Stripe Checkout; the organization is **activated as soon as payment succeeds** |
| Sign-up before or after paying | **Before** (option A): pick a plan → sign in or sign up → create an organization if needed → pay. The payment always belongs to a known organization |
| Self sign-up | Still open, but a self-created organization stays **not activated** until it pays or the team activates it |
| Subscription ends | The organization drops to the free plan; data is kept |
| Prices | As below (TWD, tax included) |

## 2. Plans

Plans differ only in seats and Query messages; every plan has the whole ERP. The pricing page shows each longer period's saving against paying monthly for the same months, computed from these prices (`savingsPercent()` in `src/lib/billingPlans.ts`): yearly 省 17%, every two years 省 25%, plus the amount saved in TWD.

| | Free | Standard | Pro |
|---|---|---|---|
| Members | 3 | 10 | 30 |
| Query messages per month (organization-wide) | 100 | 1,000 | 5,000 |
| Monthly | NT$0 | NT$1,490 | NT$3,990 |
| Yearly (10 months' price) | — | NT$14,900 | NT$39,900 |
| Every two years (18 months' price) | — | NT$26,800 | NT$71,800 |

The same numbers live in three places that must agree: `src/lib/billingPlans.ts` (pricing page), `private.plan_limits()` (database limits) and the Stripe prices (lookup keys `qerp_<plan>_<period>`: `qerp_standard_month`, `qerp_standard_year`, `qerp_standard_two_years`, `qerp_pro_month`, `qerp_pro_year`, `qerp_pro_two_years`; the two-year prices recur every 2 years).

## 3. Activation and limits

- `public.organization_subscriptions`: one row per organization. A new organization gets `plan = free, status = pending`. Organizations that existed before the migration were set to `free / active / manual`.
- `status`: `pending` (not activated: one seat, no Query), `active`, `past_due` (Stripe failed to collect and is retrying; still usable).
- **Activation screen**: while pending, every ERP page except Organization Settings (`/system`) shows 「尚未開通」 (not activated yet) with links to the pricing page and the free-trial form (`OrganizationActivationGate` in `Layout`). This is a screen, not a database boundary.
- **Seats**: a trigger on `user_organizations` refuses adding or reactivating a member beyond the plan (`55000`, HINT `plan_member_limit`, 「已達目前方案的成員上限（N 人），請升級方案」 (member limit reached, upgrade the plan); while pending 「組織尚未開通，開通後才能邀請成員」 (not activated, can't invite yet)).
- **Query**: before the agent runs, `/query` reads `get_organization_entitlement()`; a pending organization, or one past its monthly messages (counted in Asia/Taipei months, all members' questions), gets a fixed reply. If the lookup fails, Query keeps answering.
- **Downgrade**: when a paid subscription ends the organization becomes `free / active`. Members above the free limit keep their access, but no one new can be added until the count is under the limit.

### Manual activation (free plan)

After the call, the team activates the person's organization in the Supabase SQL Editor:

```sql
update public.organization_subscriptions
set status = 'active', plan = 'free', activated_by = 'manual', activated_at = now()
where organization_id = (select id from public.organizations where name = '<組織名稱>');
-- then mark the request
update public.trial_requests set status = 'activated' where phone = '<電話>';
```

## 4. Payment flow

1. `/pricing` → 「選擇標準方案」 (choose the Standard plan) → `/checkout?plan=standard&period=year`.
2. Signed out: `/login?next=/checkout?...` (sign-in, sign-up email confirmation and Google sign-in all return to `next`). No organization: `/create-organization?next=...`.
3. `/checkout` shows the current organization, plan, period and price; only an owner or admin (`canEditSystemSettings`) can continue. 「前往付款」 (go to payment) calls `POST /billing/checkout`, which creates a Stripe Checkout Session (mode subscription, `client_reference_id` and metadata = organization id, `locale zh-TW`, promotion codes allowed) and returns its URL.
4. After paying, Stripe returns to `/billing/success`, which polls the entitlement until the plan is active (normally a few seconds). Cancelling returns to `/pricing?canceled=1`.
5. Stripe sends `checkout.session.completed` to `POST /billing/webhook`; the server verifies the signature, reads the subscription and writes `plan`, `billing_period`, `status = active`, Stripe ids and `current_period_end`.
6. Later events: `customer.subscription.updated` (renewal, plan change, `past_due`, cancel at period end) and `customer.subscription.deleted` (back to free). Events for a subscription that isn't the organization's current one are ignored.
7. Organization Settings has a 「方案與帳單」 (plan and billing) card: plan, status, period, renewal date, members and Query usage; owners and admins get 「管理方案與付款」 (manage plan and payment), which opens Stripe's billing portal (`POST /billing/portal`), or 「升級方案」 (upgrade) on the free plan.

## 5. Setup (one-time, by the user)

1. Apply `supabase/migrations/20261116171234_billing_subscriptions.sql` after its rolled-back test passes (`supabase/tests/billing_subscriptions.test.sql`).
2. Stripe (test mode first): products QERP 標準 and QERP 專業 with the six prices and lookup keys in §2; Billing portal settings saved (allow cancel at period end, switching between the six prices); a webhook endpoint `https://query-ai-agent-189729990634.asia-south1.run.app/billing/webhook` with the events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
3. Cloud Run env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (used only to write `organization_subscriptions` from the webhook, `mcp-server/src/billing/admin-store.ts`).
4. Supabase Auth redirect URLs must allow `https://qerp.qwizai.com/**` (sign-up confirmation returns to `/checkout?...`).

## 6. Not covered yet

- Members above the limit after a downgrade are not made read-only (needs the permission function, owned by the RBAC Session).
- The activation screen is UI only: a pending organization's members could still call the business APIs directly. Making it a database boundary means checking activation in `user_has_organization_permission()` (RBAC Session).
- `/mcp` (external MCP clients) doesn't check the plan or the Query allowance; it runs tools, not models.
- Invoices / 統一發票 (Taiwan e-invoices): Stripe receipts only.
