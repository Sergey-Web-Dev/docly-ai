# Docly AI Lean MVP — Implementation Plan (Index)

**Task:** TASK-001

> **For Claude:** Use `using-git-worktrees` to create isolated workspace, then implement with `coder` skill. Implement **one epic plan at a time**, one task at a time; report acceptance-criteria pass/fail after each epic.

**Goal:** Ship the SDD demo journey — landing → sign up → bot → upload PDF/TXT → grounded answer → embed widget on another origin → mock upgrade changes enforced limits.

**Architecture:** One Next.js 16 App Router app. Thin route handlers / Server Actions call plain functions in `src/lib/*`. Supabase Auth + Postgres (pgvector, RLS) + Storage; quotas, retrieval and rate limiting in service-role-only SQL functions. Gemini via `@google/genai` isolated in `src/lib/ai.ts`. See `docs/architecture.md` (canonical).

**Tech Stack:** Next.js 16, TypeScript, Tailwind CSS v4, shadcn/ui, Lucide, `@supabase/ssr` + `@supabase/supabase-js`, Supabase CLI, pgvector, `@google/genai`, `unpdf`, Zod 4, Vitest, Playwright, Vercel.

---

## Epic Plans

| # | Plan | Epic | Status | Exit check |
|---|---|---|---|---|
| 01 | `writing-plans-plan-epic-01.md` | `docs/epics/epic-01-foundation.md` | ✅ Done (deploy pending) | Sign up / in / out on deployed preview; landing pricing from `PLANS` |
| 02 | `writing-plans-plan-epic-02.md` | `docs/epics/epic-02-chatbot-builder.md` | ✅ Done | PDF/TXT → `Ready`, chunks scoped by `chatbot_id`; doc quota |
| 03 | `writing-plans-plan-epic-03.md` | `docs/epics/epic-03-ai-chat.md` | ✅ Done (PR #1) | Playground answers 3 known Qs, declines unrelated; message quota |
| 04 | `writing-plans-plan-epic-04.md` | `docs/epics/epic-04-widget-billing.md` | ✅ Done (deploy pending) | Widget answers on another origin; demo upgrade changes limits; release |

Plans are written epic by epic so each later plan reflects the real code produced by the previous one.

## Global Conventions (apply to every epic)

**Prerequisites (once):** Node.js ≥ 20.9, npm, Docker Desktop (for local Supabase), Supabase CLI (`brew install supabase/tap/supabase`), GitHub, Vercel and Supabase accounts, Gemini API key (from Epic 02).

**Commands**

| Purpose | Command |
|---|---|
| Dev server | `npm run dev` |
| Unit tests | `npm test` (Vitest, `src/**/*.test.ts`) |
| Integration tests (local Supabase) | `npm run test:integration` |
| E2E | `npm run test:e2e` (Playwright, needs local Supabase running) |
| Lint / types / build | `npm run lint` · `npm run typecheck` · `npm run build` |
| Local DB | `supabase start` · `supabase db reset` (re-applies all migrations) |
| Types | `npm run db:types` |

**Rules**
- TDD for all pure logic in `src/lib/*` (write failing test → run → implement → run → commit).
- SQL/RLS behaviour verified by integration tests against local Supabase, never by trust.
- Commit after every task: Conventional Commits, scope = area (`feat(auth): …`, `chore(db): …`).
- Golden principles (`.claude/GOLDEN-PRINCIPLES.md`): kebab-case files, no `any`, no `!` non-null assertions, explicit return types on exports, early returns.
- Never commit `.env*` except `.env.example`.
- Do **not** implement P1 (accent colour) or anything listed as out of scope.

**Deviations from `docs/architecture.md` discovered during planning (already applied to it):**
- Next.js 16 → `src/proxy.ts` (not `middleware.ts`), session checked with `supabase.auth.getClaims()`.
- Supabase key names: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` (legacy anon / service-role keys also work as values).
