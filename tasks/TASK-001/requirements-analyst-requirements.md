# Docly AI Lean MVP — Requirements Decomposition

## Overview
Decomposition of the Lean MVP SDD into 4 independently verifiable epics. Detailed epics live in `docs/epics/`.

## Source
`Docly_AI_Lean_MVP_SDD.md` v2.0

## Epics

| Epic | File | Depends on | Verify independently by |
|---|---|---|---|
| 01 Foundation | `docs/epics/epic-01-foundation.md` | — | Sign up/in/out on deployed preview; landing with pricing; protected dashboard |
| 02 Chatbot Builder | `docs/epics/epic-02-chatbot-builder.md` | 01 | Bot persists; PDF/TXT reaches Ready with chunks scoped by chatbot_id; doc quota |
| 03 AI Chat | `docs/epics/epic-03-ai-chat.md` | 01, 02 | Playground answers known questions, declines unrelated; message quota |
| 04 Widget & Billing | `docs/epics/epic-04-widget-billing.md` | 01, 02, 03 | Widget answers on other origin; mock upgrade changes enforced limits; release |

```
01 Foundation ──► 02 Chatbot Builder ──► 03 AI Chat ──► 04 Widget & Billing
      └──────────────────┴────────────────────┴──────────────►┘
```

## Traceability (SDD → Epic)

| SDD item | Epic |
|---|---|
| §2 Landing; US-01.01 | 01 |
| §2 Supabase auth; US-01.02 (auth) | 01 |
| §2 Single bot, name/welcome; US-01.02 (bot) | 02 |
| §2 PDF/TXT upload, extract/chunk/embed/pgvector; US-02.01 | 02 |
| §2 ChatGPT-like grounded chat; US-02.02 | 03 |
| §2 Embeddable widget; US-03.01 | 04 |
| §2 Free/Pro, mock billing; US-03.02 | 04 (+ shared plan config in 01, doc quota in 02, message quota in 03) |
| §2 Deployed demo, README, walkthrough; US-04.01 | 01 (tooling/preview) + 04 (final) |
| §6 Business/security rules 1–10 | Distributed as BR-xx in each epic |
| Core Test Matrix | Rows assigned to 02, 03, 04; all verified in 04 |

## Non-Functional Requirements
1. NFR-001 Security: RLS + server ownership checks; keys server-side; public access only to chat of published bots.
2. NFR-002 Limits: uploads ≤ 5 MB, PDF/TXT only, bounded extracted text and message length.
3. NFR-003 Resilience: provider errors produce friendly UI errors; no partial Ready.
4. NFR-004 UX: responsive (mobile/desktop), keyboard-accessible widget, five screens only.
5. NFR-005 Quality: lint, type-check, build, Vitest unit tests, one Playwright happy-path E2E.

## Gap Analysis / Assumptions (to confirm)
- [ ] Embedding model & vector dimension (e.g. Gemini embedding at 768 dims) — decide in architecture.
- [ ] Concrete numbers: chunk size (~1,000 chars, overlap ~150), top-k (~5), similarity threshold, max message length (1,000 chars), max extracted text — proposed defaults, tunable.
- [ ] Public rate limit values (proposed: 10 req/min per IP per bot) and storage (Postgres table vs in-memory; serverless instances make in-memory unreliable).
- [ ] Whether `Failed` documents count toward the document quota (proposed: count all existing rows; owner deletes failed ones).
- [ ] Widget quota-exhausted message to visitors: neutral text, no upgrade CTA (assumption).
- [ ] Hosting provider and its free-tier function timeout vs synchronous ingestion of a 5 MB PDF.
- [ ] Accent color (P1) explicitly excluded unless time remains.

## Next Steps (Suggested)
- `/brainstorm` TASK-001 — refine design decisions from the gap list.
- `/architect` TASK-001 — settle schema, adapter, rate-limit storage.
- `/writing-plans` TASK-001 — implementation plan per epic.
