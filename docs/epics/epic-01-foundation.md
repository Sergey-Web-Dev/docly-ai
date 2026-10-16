# Epic 01 — Foundation: Scaffold, Auth, Landing

**Source:** `Docly_AI_Lean_MVP_SDD.md` §2, §3, §4, §5, §6, §7, §8 (Phase 1), US-01.01, US-01.02 (auth part), US-04.01 (tooling part)
**Priority:** P0
**Build phase:** 1

---

## Description

Set up the single Next.js application, the Supabase project (Auth, Postgres + pgvector, Storage), the shared plan configuration and the public landing page. An owner can sign up, sign in, sign out and reach a protected (empty) dashboard. Quality tooling and a deployed preview exist from day one so every later epic is verified on the same pipeline.

## Business Value

- A visitor understands the offer (Upload → Ask → Embed) and the Free/Pro pricing within seconds.
- A visitor can create an account without assistance — the entry point of the reviewer's demo journey.
- Later epics build on a stable, deployed, secure base instead of retrofitting auth and tooling.

## In Scope

1. **Scaffold:** one repository, one Next.js (App Router, TypeScript) app, Tailwind CSS, shadcn/ui, Lucide icons.
2. **Tooling:** ESLint, TypeScript type-check, Vitest set up, Playwright set up, `npm` scripts for `lint`, `typecheck`, `test`, `build`, `test:e2e`.
3. **Supabase base:** versioned SQL migrations folder; enable `pgvector`; `profiles` table (`id`, `plan` `free|pro` default `free`, `created_at`) created automatically for each new auth user; RLS on `profiles` (owner reads own row; `plan` is **not** writable by the client).
4. **Shared plan configuration:** a single server/client-importable module defining Free and Pro limits (bots 1/1, documents 2/10, AI messages per calendar month 30/300, widget yes/yes, price $0/$19 mock). This is the only source of plan numbers.
5. **Auth:** email/password sign-up, sign-in, sign-out via Supabase Auth; form validation and error messages.
6. **Route protection:** `/dashboard/**` redirects unauthenticated users to the login page; authenticated users visiting login are sent to the dashboard.
7. **Dashboard shell:** protected layout with header (app name, plan badge, sign-out) and an empty state pointing to the next action ("Create your bot").
8. **Landing page:** hero with tagline and working CTA, 3-step section (Upload → Ask → Embed), feature preview, pricing section rendered from the shared plan configuration, final CTA. Responsive (mobile + desktop).
9. **Environment & deployment:** `.env.example` with placeholders, server-only variables kept out of client bundles, deployed preview on the chosen hosting.

## Out of Scope

- Chatbot creation, documents, chat, widget, billing actions (Epics 02–04).
- OAuth / magic link / social login, password reset flows beyond what Supabase provides by default.
- Email templates customisation, teams, roles beyond owner.
- Multilingual UI, analytics, marketing CMS, blog.
- Decorative graphs, fake usage metrics, 3D hero art, onboarding wizards.

## Dependencies

| Depends on | Reason |
|---|---|
| — | First epic. External prerequisites only: Supabase project, hosting account, Gemini API key placeholder in `.env.example`. |

**Unblocks:** Epic 02, Epic 03, Epic 04.

## User Stories

### US-01.01 — Understand product and pricing (P0)
**As a** visitor, **I want** a concise landing page **so that** I can decide whether to try Docly AI.

### US-01.02 — Create an account and sign in (P0)
**As a** visitor, **I want** to sign up with email and password **so that** I can start building my bot.

### US-01.03 — Protected dashboard (P0)
**As an** owner, **I want** my dashboard to be accessible only to me **so that** my data stays private.

### US-01.04 — Reproducible project setup (P0)
**As a** developer/reviewer, **I want** the project to build, lint and deploy from a clean checkout **so that** every later epic can be verified the same way.

## Acceptance Criteria

### US-01.01
- [ ] AC-01.01.1 Hero states what the app does ("Your docs. Instant answers.") and the CTA leads to sign-up.
- [ ] AC-01.01.2 Three-step section shows Upload → Ask → Embed.
- [ ] AC-01.01.3 Pricing shows Free and Pro prices and limits read from the shared plan configuration (no hard-coded duplicates).
- [ ] AC-01.01.4 Layout works at 375 px and ≥ 1280 px widths; no horizontal scroll.
- [ ] AC-01.01.5 No dead links, no placeholder/lorem sections.

### US-01.02
- [ ] AC-01.02.1 Sign-up with valid email/password creates a Supabase user and a `profiles` row with `plan = 'free'`.
- [ ] AC-01.02.2 Sign-in with valid credentials lands on `/dashboard`.
- [ ] AC-01.02.3 Invalid credentials or an existing email show a clear inline error; the form keeps the entered email.
- [ ] AC-01.02.4 Sign-out ends the session and returns the user to the landing or login page.

### US-01.03
- [ ] AC-01.03.1 Unauthenticated request to any `/dashboard` route redirects to login.
- [ ] AC-01.03.2 Dashboard shows the current plan (Free) and an empty state with the next action "Create your bot".
- [ ] AC-01.03.3 A client cannot change its own `plan` via the Supabase client (RLS denies the update).
- [ ] AC-01.03.4 A user cannot read another user's `profiles` row.

### US-01.04
- [ ] AC-01.04.1 `lint`, `typecheck`, `build` pass on a clean checkout.
- [ ] AC-01.04.2 At least one Vitest unit test (e.g. plan configuration) and one Playwright smoke test (landing loads, CTA navigates to sign-up) pass.
- [ ] AC-01.04.3 Migrations apply cleanly to an empty Supabase project.
- [ ] AC-01.04.4 `.env.example` lists every required variable with placeholders; no secrets in the repository; service-role and AI keys are never referenced from client components.
- [ ] AC-01.04.5 The deployed preview serves the landing page and the auth flow.

## Business Rules

- **BR-01.1** Every new account starts on the Free plan.
- **BR-01.2** Plan limits are defined exactly once (shared plan configuration) and consumed by landing, UI and server enforcement.
- **BR-01.3** The `plan` field can be changed only by server code (Epic 04 mock billing), never directly by the client.
- **BR-01.4** Never trust a client-supplied `owner_id`; identity comes from the Supabase session on the server.
- **BR-01.5** AI API keys and the Supabase service-role key remain server-side only.
- **BR-01.6** Only five screens exist in the MVP (landing, login/sign-up, dashboard, chat playground, pricing/plan modal); this epic delivers the first two plus the dashboard shell.

## Definition of Done

- [ ] All acceptance criteria above pass.
- [ ] Landing and sign-up/sign-in/sign-out work on the deployed preview.
- [ ] Session persists across page refresh.
- [ ] Lint, type-check, unit test and smoke E2E test pass locally.
- [ ] Migrations committed and versioned; RLS enabled on `profiles`.
- [ ] Phase-1 exit condition partially met: "user signs in and sees own dashboard" (own bot appears in Epic 02).
