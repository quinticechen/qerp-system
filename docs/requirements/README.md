# Requirement Documents

This folder holds documents about *what to build, why, and how it was decided*: requirements, plans, design options and decision records. What the system **is now** is described in the current-state documents one level up in [docs/](../).

## Rules

1. Write a document here for any new requirement or plan before starting the implementation.
2. When a requirement (or one of its phases) is done, update the matching current-state document one level up **in the same change**, for example:
   - New or changed API → [API.md](../API.md)
   - Table or column changes → [DATABASE_TABLES.md](../DATABASE_TABLES.md)
   - Permission changes → [PERMISSIONS.md](../PERMISSIONS.md)
   - User-visible features → [FEATURES.md](../FEATURES.md)
   - Packages, services, technology choices → [DEPENDENCIES.md](../DEPENDENCIES.md), [SERVICES.md](../SERVICES.md), [TECH_STACK.md](../TECH_STACK.md)
   - AI Agent, evals → [AGENT.md](../AGENT.md), [EVALS.md](../EVALS.md)
3. Requirement documents keep the decisions and the process, and do not need to follow code changes; mark the status (planned, in progress, done) and the completion date at the top of the document.

## Index

| Document | Content | Owner | Status |
|----------|---------|-------|--------|
| [PRD.md](./PRD.md) | The original product requirements (2025-08, textile ERP as a whole); roles and technology choices have been superseded (see the top of the document) | — | Reference |
| [MULTI_TENANT_RBAC.md](./MULTI_TENANT_RBAC.md) | Multi-tenant roles and permissions (R0–R4) | RBAC Session | Done (2026-10-09) |
| [PHASE1_BUSINESS_API.md](./PHASE1_BUSINESS_API.md) | Plan and decisions for the Phase 1 business APIs (A1–A6, B1–B8) | RBAC Session | Done (2026-10-09) |
| [UI_CONSISTENCY.md](./UI_CONSISTENCY.md) | View / edit / create modes of the record dialog and shared components | RBAC Session | Done (2026-10-09) |
| [QUERY_AGENT_PHASE0.md](./QUERY_AGENT_PHASE0.md) | Query Agent Phase 0 foundation design and incident log (F1–F15) | AI Session | Done (2026-10-07) |
| [QUERY_AGENT_ARCHITECTURE_EVAL.md](./QUERY_AGENT_ARCHITECTURE_EVAL.md) | Architecture comparison of a router vs a single Agent (P0-7) | AI Session | Done (2026-10-07) |
| [QUERY_AGENT_PHASE1.md](./QUERY_AGENT_PHASE1.md) | Query Agent Phase 1: wrapping APIs as tools, eval case categories, sub-agent grouping | AI Session | In progress |
| [QUERY_AGENT_TPM_ALIGNMENT.md](./QUERY_AGENT_TPM_ALIGNMENT.md) | TPM definitions: business value, user flows, guardrails, reply policy, eval method | TPM / AI Session | In progress |
| [QUERY_AGENT_LANGFUSE.md](./QUERY_AGENT_LANGFUSE.md) | Query Agent: official SDK, production tracing, thumbs up/down, Langfuse-managed LLM judge, manually triggered CI | AI Session | In progress (2026-10-16) |
| [QUERY_UI_LAYOUT_AND_RECORD_NAV.md](./QUERY_UI_LAYOUT_AND_RECORD_NAV.md) | Query: open the written record after confirming; floating, sidebar and full-screen layouts on desktop | AI Session | Done (2026-10-15) |
| [QUERY_AGENT_EVAL_REDESIGN.md](./QUERY_AGENT_EVAL_REDESIGN.md) | Query Agent eval redesign: outcome-based scoring, cases and prompts moved to Langfuse, LLM scoring; §8 merge sub-agent results into one reply | AI Session | In progress (§8 pending decision, 2026-10-20) |
| [QUERY_AGENT_EVAL_COVERAGE.md](./QUERY_AGENT_EVAL_COVERAGE.md) | Query Agent eval: case coverage per tool, role and situation; reply rubric (符合／部分符合／不符合) for the judge and human labels | AI Session / TPM | Draft for TPM review (2026-10-30) |
| [QUERY_AGENT_EVAL_UTTERANCES.md](./QUERY_AGENT_EVAL_UTTERANCES.md) | Real-utterance collection sheet (filled in by the TPM, turned into eval cases) | TPM | Filled in and turned into cases (2026-10-14) |

