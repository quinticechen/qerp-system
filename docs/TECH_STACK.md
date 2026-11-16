# Tech Stack

> Current-state document (2026-11-16). External services: [SERVICES.md](./SERVICES.md); package versions: [DEPENDENCIES.md](./DEPENDENCIES.md). What the product does and who it's for: [README.md](../README.md).

## 1. Architecture

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│ Frontend (React + Vite)  │        │ AI server mcp-server           │
│ Vercel                   │──────▶ │ Cloud Run (Express + AI SDK)   │──▶ OpenRouter (models)
│ src/                     │ /query │ router + sub-agents + tools    │
└────────────┬─────────────┘        └──────────────┬────────────────┘
             │ supabase-js (user's JWT)              │ supabase-js (the same user's JWT)
             ▼                                       ▼
┌──────────────────────────────────────────────────────────────────┐
│ Supabase (PostgreSQL 17, Auth, PostgREST)                         │
│ · Business APIs: PL/pgSQL functions that check permissions,       │
│   write, and compute progress and document numbers                │
│ · RLS: limits reads and writes by organization and permission key │
│ · Triggers: shipping and receiving progress, document numbers,    │
│   edit history                                                    │
└──────────────────────────────────────────────────────────────────┘
```

- **Every business write goes through a business API in the database** (`supabase.rpc`), so the frontend and the AI share the same rules. Reads query tables or views directly and are limited by RLS.
- **Permissions are decided in the database**: `user_has_organization_permission()` is the single source of truth, used by RLS, the business APIs and the AI. The frontend only keeps the screen consistent ([PERMISSIONS.md](./PERMISSIONS.md)).
- **The AI never writes directly**: write tools only produce a confirmation card, and the write runs after the user confirms ([AGENT.md](./AGENT.md)).

## 2. Frontend (`src/`)

| Item | Choice |
|------|--------|
| Language and framework | TypeScript, React 18 |
| Build | Vite 5 (dev server on port 8080) |
| UI | shadcn/ui (Radix UI) + Tailwind CSS 3; icons from lucide-react |
| Routing | React Router 6 |
| Server state | TanStack Query (React Query) |
| Forms and validation | react-hook-form, zod |
| Data access | `@supabase/supabase-js`; business writes are wrapped in `src/lib/api/*.ts` |
| Tests | Vitest, Testing Library (jsdom); `scripts/verify-query-ui.py` (Playwright) checks the AI query screen |
| Package manager | Bun |

Structure:

```
src/
├── pages/           Route pages
├── components/      Folders by feature (order, purchase, inventory, shipping, product…); ui/ is shadcn/ui
├── hooks/           Data reading and permissions (useProductCatalog, usePermissions…)
├── lib/api/         Business API calls (callApi, ApiError)
├── lib/             Shared logic (dates, environment, permission labels, edit-history labels)
└── integrations/supabase/  Supabase client and database types (types.ts)
```

## 3. Database and backend logic (`supabase/`)

| Item | Approach |
|------|----------|
| Database | Supabase PostgreSQL 17 |
| Business logic | PL/pgSQL functions (business APIs): implemented in the non-public `private` schema (`SECURITY DEFINER`), and called over RPC through PostgREST via `public` wrapper functions of the same name; errors are reported as 4xx through `api_fail()` ([API.md](./API.md) §2.3) |
| Permissions | RLS by permission key ([PERMISSIONS.md](./PERMISSIONS.md)) |
| Derived data | Triggers recompute shipping and receiving progress and document numbers; the `record_audit_logs` trigger records the edit history |
| Schema changes | `supabase/migrations/*.sql`, applied in the Supabase SQL Editor |
| Tests | `supabase/tests/*.test.sql`: run inside a transaction that is always rolled back at the end; `build-run.sh` assembles `run.sql` to run in the SQL Editor |

## 4. AI server (`mcp-server/`)

| Item | Choice |
|------|--------|
| Runtime | Node.js (TypeScript), Express 5 |
| Model calls | Vercel AI SDK (`ai`) + OpenRouter provider |
| Protocol | Model Context Protocol (`@modelcontextprotocol/sdk`) |
| Tests | `bun run test` (node:test); `bun run eval` replays cases against a fake database |

Details: [AGENT.md](./AGENT.md), [EVALS.md](./EVALS.md).

## 5. Repository layout

| Path | Content |
|------|---------|
| `src/` | Frontend (pages, components, hooks, `lib/api` business API calls) |
| `mcp-server/` | AI server, tools, evals |
| `supabase/migrations/` | Database schema and functions |
| `supabase/tests/` | Rolled-back database tests |
| `scripts/` | Browser verification scripts |
| `docs/` | Current-state documents |
| `docs/requirements/` | Requirements, plans and decisions ([rules](./requirements/README.md)) |

## 6. Development

```bash
bun run dev          # frontend, http://localhost:8080
bun run test         # frontend unit tests
bun run lint

cd mcp-server
bun run dev          # AI server, http://localhost:3100
bun run test         # tool and permission tests
```

- Verify the Query screen: `python3 scripts/verify-query-ui.py --headless` (account in `.env` as `VERIFY_EMAIL` / `VERIFY_PASSWORD`).
- Database changes: `supabase/tests/build-run.sh <migration> -- <test files…>` produces `run.sql`. Run it in the Supabase SQL Editor (it always rolls back; the result must be `ALL TESTS PASSED`) before applying the migration.
- Query evals call real models and cost money; run them only when asked ([QUERY_AGENT_EVALS.md](./QUERY_AGENT_EVALS.md)).
- Development rules: [CLAUDE.md](../CLAUDE.md).
