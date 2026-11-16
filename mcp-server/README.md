# QERP Query Server (`mcp-server`)

The backend for **Query**, QERP's AI assistant. It answers questions and drafts records in Chinese for the ERP's chat panel, and exposes the same business tools to any Model Context Protocol (MCP) client. Every request runs as the signed-in user, inside one organization and within that user's permissions.

Architecture, the tool list and known issues: [docs/AGENT.md](../docs/AGENT.md). Endpoint details: [docs/API.md](../docs/API.md). Evals: [docs/QUERY_AGENT_EVALS.md](../docs/QUERY_AGENT_EVALS.md).

## Endpoints

All endpoints except `/health` and `/billing/webhook` need `Authorization: Bearer <Supabase access token>`.

| Method and path | Purpose |
|-----------------|---------|
| `POST /query` | One chat turn from the ERP's Query panel (`organization_id` in the body) |
| `POST /query/actions/:id/confirm` · `/cancel` | Confirm or cancel a drafted write. Writes run only here, never inside the agent loop |
| `POST /query/messages/:id/feedback` | Thumbs up / down on a reply |
| `POST /mcp` | MCP over Streamable HTTP; the organization comes from the `X-Organization-Id` header |
| `POST /billing/checkout` · `/billing/portal` | Stripe Checkout for a paid plan, or Stripe's billing portal (owner or admin) |
| `POST /billing/webhook` | Stripe events; authenticated by the `Stripe-Signature` header instead of a JWT |
| `GET /health` | Health check |

The server only serves organizations the user actively belongs to, and offers only the tools the user's role allows (`user_has_organization_permission()`, the same check the database uses).

## Run locally

```bash
cd mcp-server
# create .env with the variables below
bun run dev            # http://localhost:3100, reloads on change
bun run test           # tool, permission and adapter tests; run after every change
```

`bun run build` then `bun run start` runs the compiled server. Production runs on Google Cloud Run, deployed from `Dockerfile` ([docs/SERVICES.md](../docs/SERVICES.md)).

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Yes | Supabase project; every query runs with the caller's JWT, so RLS applies |
| `OPENROUTER_API_KEY` | For `/query` | Model calls |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | No | Tracing, prompt versions and evals; without them Query still works |
| `LANGFUSE_SAMPLE_RATE` | No | Share of successful requests traced (default 0.05) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | For billing | Stripe API and webhook signing secret |
| `STRIPE_PORTAL_CONFIGURATION` | No | Stripe billing portal configuration id (`bpc_…`); default is the account's default configuration |
| `SUPABASE_SERVICE_ROLE_KEY` | For billing | Used only by the Stripe webhook to write `organization_subscriptions` |
| `PORT` | No | Default 3100 |

## Connect an MCP client

Point any client that speaks Streamable HTTP at `/mcp` with the user's token and organization. For Claude Code, in `.mcp.json`:

```json
{
  "mcpServers": {
    "qerp": {
      "type": "http",
      "url": "http://localhost:3100/mcp",
      "headers": {
        "Authorization": "Bearer <Supabase access token>",
        "X-Organization-Id": "<organization uuid>"
      }
    }
  }
}
```

Then ask in plain language, for example 「現在哪些產品庫存不足？」 (which products are low on stock?) or 「列出永泰布行的訂單」 (list 永泰布行's orders).

## Evals

`bun run eval` replays the eval cases against real models and costs money, so run it only when it's needed ([docs/QUERY_AGENT_EVALS.md](../docs/QUERY_AGENT_EVALS.md)).
