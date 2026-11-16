# Public Home Page and Free-Trial Requests

> Requirement document. Status: in progress (2026-11-16). Owner: user request (neither parallel session; see [SESSION_COORDINATION.md](../SESSION_COORDINATION.md) §6).

## 1. Goal

`https://qerp.qwizai.com/` used to show a spinner and send every visitor to `/login`. Search engines and people arriving from a shared link saw nothing about the product. The Home page explains QERP to a textile business owner and collects free-trial requests, and it is set up to be found and shared (title, description, canonical URL, Open Graph, structured data).

## 2. Decisions (user, 2026-11-16)

| Question | Decision |
|----------|----------|
| Product name | **QERP** (matches the domain). The UI subtitle stays 紡織業 ERP |
| Main call to action | 「免費試用」 (free trial) opens a request form. After 「建立」 (create), the form is replaced by a thank-you message: the team will call and open the account as soon as possible. **Changed the same day**: 「免費試用」 now goes to `/pricing`, and the form opens from the free plan there ([PRICING_AND_BILLING.md](./PRICING_AND_BILLING.md)) |
| Form fields | Name, phone and company name are required; email, company size and note are optional |
| Where requests go | A new Supabase table `trial_requests`; the team reads it in the Supabase dashboard. No email notification for now |
| Self sign-up | Kept: the login page's sign-up tab works as before, and the Home page links to 登入 (sign in) |
| Signed-in visitors | Opening `/` still goes to `/dashboard` (or `/create-organization` without an organization), as before |

## 3. Page content

Header (logo, section links, 登入, 免費試用) → hero → the order-to-shipping flow in four steps → features → Query AI assistant with a static sample conversation and confirmation card → the four roles → FAQ → closing call to action → footer. All text is in Traditional Chinese.

## 4. Free-trial requests

- `public.trial_requests` has no `organization_id`: the visitor is not signed in and belongs to no organization yet. This is the one exception to the "every table is organization-scoped" rule, and it is safe because clients can only insert.
- Clients (`anon`, `authenticated`) may insert only the form's columns; there is no SELECT, UPDATE or DELETE grant or policy. `status` (`new` → `contacted` → `activated`, or `declined`) is set by the team.
- Database checks repeat the form's validation (lengths, phone characters, email shape, size options).
- Rate limit, in a `private` definer trigger: the same phone once per 10 minutes, at most 30 requests per hour overall. It fails with `PT429` (HTTP 429) and 「申請太頻繁，請稍後再試」 (too many requests, try again later).
- The form also has a hidden honeypot field; a filled-in honeypot shows the thank-you message without saving.

## 5. SEO

- `index.html` carries the Home page's title, description, canonical URL, Open Graph and Twitter tags, and JSON-LD, for crawlers and link previews that don't run JavaScript. At startup the app removes these static tags, so `react-helmet-async` (`SEO`) is the only source on each page.
- The Home page adds JSON-LD `SoftwareApplication`, `Organization`, `WebSite` and `FAQPage` (from the same FAQ the page shows).
- Canonical URLs always use `https://qerp.qwizai.com` plus the path, so Vercel preview URLs don't compete with production.
- Share image: `public/og-image.png` (1200×630).
- `sitemap.xml` lists only the public pages (`/`, `/pricing`, `/login`); `robots.txt` keeps crawlers out of the signed-in app pages.

## 6. Out of scope

An English version, email or LINE notifications for new requests, and an admin screen for requests in the ERP.
