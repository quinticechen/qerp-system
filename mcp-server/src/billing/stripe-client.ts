/**
 * Minimal Stripe REST client (no SDK): form-encoded requests with the secret key.
 * Only the calls billing needs; see https://docs.stripe.com/api.
 */

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class StripeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Params = Record<string, unknown>;

/** Flattens nested params the way Stripe expects: a[b]=1, a[0][c]=2. */
export function encodeParams(params: Params, prefix = ""): string[] {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === "object") pairs.push(...encodeParams(item as Params, `${name}[${index}]`));
        else pairs.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === "object") {
      pairs.push(...encodeParams(value as Params, name));
    } else {
      pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs;
}

export interface StripePrice {
  id: string;
  lookup_key: string | null;
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items: { data: { price: StripePrice; current_period_end?: number }[] };
}

export class StripeClient {
  /**
   * @param portalConfiguration Billing portal configuration to use (STRIPE_PORTAL_CONFIGURATION); without it Stripe
   *   uses the account's default, which other apps on the same Stripe account may change.
   */
  constructor(
    private readonly secretKey: string,
    private readonly fetchFn: FetchLike = fetch as unknown as FetchLike,
    private readonly portalConfiguration?: string,
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, params: Params = {}): Promise<T> {
    const body = encodeParams(params).join("&");
    const url = `https://api.stripe.com/v1${path}${method === "GET" && body ? `?${body}` : ""}`;
    const response = await this.fetchFn(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: method === "POST" ? body : undefined,
    });
    const data = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) throw new StripeError(data.error?.message ?? `Stripe ${path} failed`, response.status);
    return data;
  }

  async findPrice(lookupKey: string): Promise<StripePrice | null> {
    const list = await this.request<{ data: StripePrice[] }>("GET", "/prices", { lookup_keys: [lookupKey], active: true, limit: 1 });
    return list.data[0] ?? null;
  }

  createCheckoutSession(params: Params): Promise<{ id: string; url: string }> {
    return this.request("POST", "/checkout/sessions", params);
  }

  createPortalSession(customer: string, returnUrl: string): Promise<{ url: string }> {
    return this.request("POST", "/billing_portal/sessions", { customer, return_url: returnUrl, configuration: this.portalConfiguration || undefined });
  }

  retrieveSubscription(id: string): Promise<StripeSubscription> {
    return this.request("GET", `/subscriptions/${encodeURIComponent(id)}`);
  }
}
