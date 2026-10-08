# weave-flow-erp-system — Project Guide

紡織業 ERP 系統。All UI text and documentation in this project must be in Chinese. Program logic (variable names, function names, comments in code) stays in English.

## Parallel Sessions

Two Claude Code sessions develop this project at the same time — one on the Query AI agent, one on roles and permissions — sharing this working directory, the `main` branch and the one Supabase database. **Before changing any file or the database, read `docs/SESSION_COORDINATION.md`**: it says which session owns which files and database objects, the contracts between them, and the handoff status. Always:

- Commit only your own files by explicit path — never `git add -A`, `git add .` or `git commit -a`.
- In `src/integrations/supabase/types.ts`, add only the types for your own migration; never regenerate the whole file.
- Never `CREATE OR REPLACE` a database object the other session owns; leave a request in the coordination doc instead.

## Stack

- **Frontend:** React + TypeScript + Vite (port 8080)
- **UI:** shadcn/ui + Tailwind CSS
- **Backend:** Supabase (auth, database, RLS)
- **MCP Server:** Node.js on port 3100 (`mcp-server/`)
- **Package manager:** Bun

## Start Dev Environment

```bash
# Frontend (from weave-flow-erp-system/)
bun run dev          # starts on http://localhost:8080

# MCP / AI backend (from weave-flow-erp-system/mcp-server/)
bun run dev          # starts on http://localhost:3100
```

## Project Structure

```
weave-flow-erp-system/
├── src/
│   ├── components/
│   │   └── query/           ← AI Query chat UI (QueryFloatButton, QueryChat, MarkdownMessage)
│   ├── hooks/               ← Custom hooks (useAuth, useQueryChat, …)
│   ├── pages/               ← Route-level components
│   └── contexts/            ← OrganizationContext
├── mcp-server/
│   └── src/
│       ├── index.ts         ← HTTP server (CORS, /mcp, /query routes)
│       ├── agent/           ← AI query handler
│       └── tools/           ← MCP tool registrations per domain
├── scripts/
│   └── verify-query-ui.py  ← Browser-based UI verification agent
└── supabase/
    └── migrations/          ← Never modify without explicit user confirmation
```

## Mandatory Testing After Code Changes

**Run the verification script after every change that touches frontend UI or the /query endpoint.**

### Prerequisites

```bash
pip install playwright
playwright install chromium
```

### Command

```bash
# From weave-flow-erp-system/ — credentials loaded from .env automatically
python3 scripts/verify-query-ui.py

# Headless (no browser window, faster)
python3 scripts/verify-query-ui.py --headless
```

> Credentials are stored in `weave-flow-erp-system/.env` (`VERIFY_EMAIL` / `VERIFY_PASSWORD`). Never hardcode them here.

### What the Script Verifies

1. **Authentication** — Supabase session injection via localStorage
2. **Query Float Button** — visible, indigo gradient, manta ray SVG
3. **Chat Panel** — opens on click, shows header and welcome message, suggestion chips present
4. **Quick-reply → AI response** — suggestion chip sends message with `organization_id`, AI reply rendered in bubble
5. **Manual input (Enter)** — textarea accepts text, Enter key sends, reply received
6. **Clear & close** — trash button resets to welcome, toggle closes panel

### Passing Criteria

All checks must show `✅ PASS`. The "Thinking animation" check may show `ℹ️ INFO` (acceptable — mock API responds instantly). Any `❌ FAIL` must be fixed before the task is complete.

### Agent Evals (changes under `mcp-server/src/`)

`verify-query-ui.py` mocks `/query`, so agent behaviour (routing, prompts, tools, gateway) is covered by the eval harness instead. From `mcp-server/`:

```bash
bun run test                               # deterministic tool/adapter tests — must all pass
bun run eval -- --label <short-change-name>
```

The eval replays `evals/cases/*.json` against real models with an in-memory fake database, and writes a report to `evals/reports/`. Not every case passes yet, so the bar is **no regression**: every case that passed in the most recent full run (no `--filter`) under `evals/reports/` must still pass. Tool descriptions and prompts are fragile with the primary model — rerun the eval after any wording change, however small. Compare the two reports' per-case tables and list any case that went from ✅ to ❌. When a change fixes a known failure, add or tighten a case so it stays fixed. Design and case format: `docs/QUERY_AGENT_PHASE0.md` §4.7.

To debug a specific Query reply, look it up in `query_traces` by the `traceId` that `/query` returns: it records the route, every model attempt (with errors and fallbacks), the tool calls, tokens and latency.

### What Counts as "No Automated Test Available"

If your change is to:
- Supabase migrations (schema/RLS)
- Non-Query pages (product, inventory, shipping, etc.)

…then the verification script does not cover it. In these cases, state explicitly what manual verification you performed and its result.

## Security Rules

- **RLS:** Every table must have `organization_id`-scoped policies. Never add PERMISSIVE policies that check role only (without org filter) — they bypass org isolation due to OR semantics.
- **CORS:** The mcp-server allowlist is in `mcp-server/src/index.ts` → `ALLOWED_ORIGINS`. Only add origins that the team controls.
- **JWT:** The `/query` and `/mcp` endpoints require a valid Supabase Bearer token. Never disable this check.
- **Organization & tool permissions:** `/query` (`organization_id` in the body) and `/mcp` (`X-Organization-Id` header) only serve organizations the user actively belongs to. Which tools the model gets is decided by `mcp-server/src/agent/auth-guard.ts` via the database function `user_has_organization_permission()` — the same one RLS uses. Grant AI access by setting a tool's `permission` key; never by hard-coding roles in the server.
- **Tools stay inside the selected organization:** RLS lets a user read every organization they belong to, so every tool query filters `organization_id = ctx.organizationId` (by-id lookups too), and writes check referenced records with `allInOrganization()`. `tests/org-isolation.test.ts` must cover each new tool.
- **Database objects stay inside the organization too:** views are created `WITH (security_invoker = true)` and expose `organization_id` so the UI can filter by the current organization (a view without it runs as its owner and bypasses RLS). A `SECURITY DEFINER` function that takes a user or organization id must answer only about the caller or the caller's organizations — call `can_inspect_organization()` (see `supabase/migrations/20261007130000_org_boundary_hardening.sql`). Run the Supabase security advisor after any such migration.
- **The AI never writes directly:** in the agent loop, `write` tools only create drafts (`query_pending_actions`); the write runs when the user confirms the card (`POST /query/actions/:id/confirm`, `mcp-server/src/agent/actions.ts`), which re-checks membership and permission and claims the action atomically. A new write tool needs `summarize()` (card text with names, never IDs); the registry refuses one without it. The eval fails any case where the agent loop writes.

## Unfinished Features

Users must never meet a control that does nothing. Any UI whose feature is not implemented yet (a setting that is not saved, a button with no handler, a card of placeholders) is wrapped in `UnfinishedFeature` (`src/components/common/UnfinishedFeature.tsx`):

- **Production**: not rendered at all (the production build drops it).
- **Local and staging**: shown with a grey background, a dashed border and a「尚未實作」label, with its inputs disabled, so it can still be reviewed.

The environment comes from `src/lib/appEnvironment.ts` (`APP_ENV`, `SHOW_UNFINISHED_FEATURES`). `vite.config.ts` sets it at build time from Vercel's `VERCEL_ENV`: `production` → production, `preview` → staging; the dev server is development. Set `VITE_APP_ENV` to override.

- Wrap whole cards or sections, not single inputs; pass a grid span such as `lg:col-span-2` as the wrapper's `className`.
- Remove the wrapper in the same change that makes the feature work.
- Do not ship a half-wired feature unwrapped: if saving, the permission check or the database part is missing, it is unfinished.

## Known Configuration

| Item | Value |
|------|-------|
| Frontend port | 8080 |
| MCP server port | 3100 |
| Supabase project ref | gyiyedvutcbwzpbcsmjc |
| Test account | quinticechen@gmail.com |
| Supabase OAuth redirect | Must include `http://localhost:8080/**` in Supabase dashboard allowlist |
