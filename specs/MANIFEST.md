# Specifications Manifest — Docly AI

**Product:** Docly AI — Embeddable Chatbot Builder. Upload PDF/TXT, ask grounded questions, embed the same bot on any website. Free/Pro mock billing.
**Source of truth:** `Docly_AI_Lean_MVP_SDD.md` (v2.0)

## Documents

| Document | Purpose | Last Updated |
|---|---|---|
| `../Docly_AI_Lean_MVP_SDD.md` | Product specification (SDD) | — |
| `../docs/epics/epic-01-foundation.md` | Epic 01 — scaffold, auth, landing | 2026-10-16 |
| `../docs/epics/epic-02-chatbot-builder.md` | Epic 02 — bot setup, ingestion | 2026-10-16 |
| `../docs/epics/epic-03-ai-chat.md` | Epic 03 — grounded chat, message quota | 2026-10-16 |
| `../docs/epics/epic-04-widget-billing.md` | Epic 04 — widget, mock billing, release | 2026-10-16 |
| `../tasks/TASK-001/requirements-analyst-requirements.md` | Traceability + gap analysis | 2026-10-16 |
| `../docs/architecture.md` | **Canonical MVP architecture (minimal)** | 2026-10-16 |
| `architect-architecture.md` | Architecture decision log (AD-01…AD-18 + simplification) | 2026-10-16 |

## Tech Stack

- Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, Lucide
- Supabase: Auth (`@supabase/ssr`), Postgres + pgvector (HNSW, 768 dims), Storage (private bucket)
- AI: Google Gemini via `@google/genai`, isolated in `src/lib/ai.ts`
- PDF extraction: `unpdf`; validation: Zod
- Testing: Vitest (unit + integration on local Supabase), Playwright (E2E)
- Hosting: Vercel Hobby + Supabase Free; demo site as a second Vercel project (separate origin)

## Key Decisions

- One Next.js app; thin route handlers / Server Actions → plain functions in `src/lib/*`.
- User (RLS) Supabase client for owner management; service-role client only after server authorization in chat/quota/rate-limit paths.
- Single `POST /api/chat` for dashboard and widget (owner vs public mode).
- Atomic quotas via service-role-only RPCs; limits passed from `lib/plans.ts` (single source).
- Synchronous ingestion, no queues; no streaming; no real payments.

## Tasks

| Task | Status |
|---|---|
| TASK-001 Lean MVP | Requirements ✅, Architecture ✅, API design / plan — next |
