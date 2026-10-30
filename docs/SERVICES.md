# Services in Use

> Current-state document (2026-10-16).

| Service | Purpose | Configuration |
|---------|---------|---------------|
| Supabase | PostgreSQL database, Auth (email/password, Google OAuth), PostgREST API | Project `gyiyedvutcbwzpbcsmjc`; there is only one environment (production), and migrations are applied directly to the production database |
| Vercel | Frontend deployment: production and preview deployments | Environment variable `VITE_QUERY_API_URL` (AI server URL); at build time `APP_ENV` is set from `VERCEL_ENV`: production → production, preview → staging (`vite.config.ts`, `src/lib/appEnvironment.ts`) |
| Google Cloud Run | AI server `query-ai-agent` (`asia-south1`, project `erp-system-463209`) | Continuously deployed from `mcp-server/Dockerfile`; environment variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (optional `LANGFUSE_SAMPLE_RATE`, default 0.05). Traces are sent after the reply; when CPU is only allocated during requests, sending may be delayed until the next request, and everything is flushed before shutdown (SIGTERM) |
| OpenRouter | AI model gateway | Default order: `google/gemini-2.5-flash-lite` → `google/gemini-2.5-flash` → `anthropic/claude-haiku-4.5` (`mcp-server/src/agent/ai-gateway.ts`) |
| Langfuse | Langfuse Cloud (EU), used through official SDK v6: AI eval cases (Dataset `query-agent`) and experiments; Query Agent system prompt versions (Prompt Management; production reads the `production` label and falls back to the in-code version if it can't); production traces (PII removed, 5% sampled, [AGENT.md](./AGENT.md)) and users' thumbs up/down; score configs, annotation queues and LLM judge calibration | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` ([EVALS.md](./EVALS.md)). Running the LLM judge in Langfuse requires a connection under Settings → LLM Connections |
| GitHub Actions | `Query Agent Eval` (manually triggered eval), `Keep Supabase Active` | Repository secrets the eval needs: see [QUERY_AGENT_EVALS.md](./QUERY_AGENT_EVALS.md) §3.1 |
| Google OAuth | Sign-in with a Google account | The Supabase Auth redirect allow list must include `http://localhost:8080/**` |

## Environments

| Environment | Frontend | Database | Features not yet implemented |
|-------------|----------|----------|------------------------------|
| Production | Vercel production | Supabase (the only one) | Hidden |
| Staging | Vercel preview | The same Supabase | Shown greyed out |
| Local | `bun run dev` (port 8080) | The same Supabase | Shown greyed out |

There is no separate test database; database changes are verified with a rolled-back test (`supabase/tests/run.sql`) before being applied.
