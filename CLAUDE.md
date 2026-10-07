# weave-flow-erp-system — Project Guide

紡織業 ERP 系統。All UI text and documentation in this project must be in Chinese. Program logic (variable names, function names, comments in code) stays in English.

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

## Known Configuration

| Item | Value |
|------|-------|
| Frontend port | 8080 |
| MCP server port | 3100 |
| Supabase project ref | gyiyedvutcbwzpbcsmjc |
| Test account | quinticechen@gmail.com |
| Supabase OAuth redirect | Must include `http://localhost:8080/**` in Supabase dashboard allowlist |
