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
# From weave-flow-erp-system/ — uses default test account (quinticechen@gmail.com)
python3 scripts/verify-query-ui.py

# Or with explicit credentials
python3 scripts/verify-query-ui.py --email quinticechen@gmail.com --password Quing_0603

# Headless (no browser window, faster)
python3 scripts/verify-query-ui.py --headless
```

### What the Script Verifies

1. **Authentication** — Supabase session injection via localStorage
2. **Query Float Button** — visible, indigo gradient, manta ray SVG
3. **Chat Panel** — opens on click, shows header and welcome message, suggestion chips present
4. **Quick-reply → AI response** — suggestion chip sends message, AI reply rendered in bubble
5. **Manual input (Enter)** — textarea accepts text, Enter key sends, reply received
6. **Clear & close** — trash button resets to welcome, toggle closes panel

### Passing Criteria

All checks must show `✅ PASS`. The "Thinking animation" check may show `ℹ️ INFO` (acceptable — mock API responds instantly). Any `❌ FAIL` must be fixed before the task is complete.

### What Counts as "No Automated Test Available"

If your change is to:
- Supabase migrations (schema/RLS)
- Non-Query pages (product, inventory, shipping, etc.)
- MCP tool logic without a UI-visible effect

…then the verification script does not cover it. In these cases, state explicitly what manual verification you performed and its result.

## Security Rules

- **RLS:** Every table must have `organization_id`-scoped policies. Never add PERMISSIVE policies that check role only (without org filter) — they bypass org isolation due to OR semantics.
- **CORS:** The mcp-server allowlist is in `mcp-server/src/index.ts` → `ALLOWED_ORIGINS`. Only add origins that the team controls.
- **JWT:** The `/query` and `/mcp` endpoints require a valid Supabase Bearer token. Never disable this check.

## Known Configuration

| Item | Value |
|------|-------|
| Frontend port | 8080 |
| MCP server port | 3100 |
| Supabase project ref | gyiyedvutcbwzpbcsmjc |
| Test account | quinticechen@gmail.com |
| Supabase OAuth redirect | Must include `http://localhost:8080/**` in Supabase dashboard allowlist |
