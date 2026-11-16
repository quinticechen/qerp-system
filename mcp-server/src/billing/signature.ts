import { createHmac, timingSafeEqual } from "node:crypto";

/** How old a webhook may be before it's treated as a replay (Stripe's default tolerance). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Checks a Stripe-Signature header ("t=<unix>,v1=<hex>[,v1=...]") against the raw request body:
 * HMAC-SHA256 of "<t>.<body>" with the endpoint's signing secret (https://docs.stripe.com/webhooks#verify-manually).
 */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((part) => part.split("=") as [string, string]);
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  return signatures.some((signature) => {
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
