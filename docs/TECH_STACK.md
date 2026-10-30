# Tech Stack

> Current-state document (2026-10-09). External services: [SERVICES.md](./SERVICES.md); package versions: [DEPENDENCIES.md](./DEPENDENCIES.md).

## 1. Frontend (`src/`)

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

## 2. Database and backend logic (`supabase/`)

| Item | Approach |
|------|----------|
| Database | Supabase PostgreSQL 17 |
| Business logic | PL/pgSQL functions (business APIs): implemented in the non-public `private` schema (`SECURITY DEFINER`), and called over RPC through PostgREST via `public` wrapper functions of the same name; errors are reported as 4xx through `api_fail()` ([API.md](./API.md) §2.3) |
| Permissions | RLS by permission key ([PERMISSIONS.md](./PERMISSIONS.md)) |
| Derived data | Triggers recompute shipping and receiving progress and document numbers; the `record_audit_logs` trigger records the edit history |
| Schema changes | `supabase/migrations/*.sql`, applied in the Supabase SQL Editor |
| Tests | `supabase/tests/*.test.sql`: run inside a transaction that is always rolled back at the end; `build-run.sh` assembles `run.sql` to run in the SQL Editor |

## 3. AI server (`mcp-server/`)

| Item | Choice |
|------|--------|
| Runtime | Node.js (TypeScript), Express 5 |
| Model calls | Vercel AI SDK (`ai`) + OpenRouter provider |
| Protocol | Model Context Protocol (`@modelcontextprotocol/sdk`) |
| Tests | `bun run test` (node:test); `bun run eval` replays cases against a fake database |

Details: [AGENT.md](./AGENT.md), [EVALS.md](./EVALS.md).
