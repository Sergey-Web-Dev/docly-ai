# Epic 04 — Public Widget, Mock Billing, Release

**Source:** `Docly_AI_Lean_MVP_SDD.md` §1, §2, §4, §5, §6, §7, §8 (Phases 3–4), §9, US-03.01, US-03.02, US-04.01, Core Test Matrix
**Priority:** P0
**Build phase:** 3 + 4

---

## Description

Let the owner publish the bot and embed it on any website with one copyable `<script>` snippet. A lightweight `/widget.js` loader inserts a floating launcher that opens an isolated iframe (`/embed/[botId]`) talking to the **same** chat API from Epic 03. Add Free/Pro pricing with a clearly labelled mock upgrade/downgrade that changes the limits enforced on the server. Close the MVP with final QA, deployment, README and the demo walkthrough so a reviewer can complete the full journey unaided.

## Business Value

- Turns the bot into something the owner can put in front of real website visitors — the product's distribution channel.
- Demonstrates how the SaaS would monetise (Free → Pro) with real, observable limit changes.
- Makes the assignment reviewable: public demo, docs, tests and walkthrough.

## In Scope

### Widget
1. **Publish toggle** in the dashboard (`is_published`, default `false`), owner-only.
2. **Embed snippet** in the dashboard: one `<script>` tag with the bot ID and app origin, plus a copy button.
3. **`/widget.js` loader:** small vanilla script; injects a floating launcher button and an iframe panel; open/close; no dependencies; no access to the host page's data.
4. **`/embed/[botId]` page:** public, minimal chat UI (bot name, welcome message, messages, input, loading, errors); responsive (~380 px panel on desktop, near full-width on mobile); keyboard accessible; visible close button.
5. **Public chat path** through the same chat API/service: allowed only for published bots and only the chat operation; returns public bot info (name, welcome message) only.
6. **Unavailable state** for unknown or unpublished bots.
7. **Abuse protection:** basic per-IP + per-bot rate limit (simple fixed window) on public chat; owner's monthly quota applies to widget traffic.
8. **Demo website:** a separate static HTML page (served from a different origin) embedding the snippet.

### Billing (mock)
9. **Pricing / plan modal** in the dashboard rendered from the shared plan configuration, showing current plan and usage (documents used/limit, messages used/limit this month).
10. **Mock upgrade/downgrade:** buttons labelled **"Demo upgrade — no payment"** / downgrade, with a confirmation dialog; server action updates `profiles.plan` for the authenticated owner only.
11. **Downgrade rule:** existing documents are kept; new uploads blocked until the document count is below the Free limit; message quota uses the Free limit immediately.
12. **Upgrade CTAs** from quota errors (Epics 02/03) open this plan modal.

### Release
13. Final deploy of landing, dashboard, embed page, widget loader and demo page.
14. README: architecture summary, environment variables, local setup, migrations, limitations, demo journey.
15. Happy-path Playwright E2E (sign up → create bot → upload → ask → copy snippet → widget answers → upgrade); two-account cross-access test.
16. UX pass: empty, loading and error states; form errors; responsive layout.
17. 2–4 minute narrated video or illustrated written walkthrough.

## Out of Scope

- Real Stripe/payments, card collection, invoices, webhooks, renewals, proration.
- Widget theming beyond bot name/welcome message (accent color is P1, Pro-only, only if time remains).
- Custom domains, domain allow-lists, widget analytics, conversation persistence.
- Streaming, citations, multilingual UI.
- Distributed/Redis rate limiting, CAPTCHA, enterprise SLOs, production-scale throughput.
- Separate AI pipeline for the widget.

## Dependencies

| Depends on | Reason |
|---|---|
| Epic 01 | Plan configuration, `profiles.plan`, auth, deployment pipeline. |
| Epic 02 | Chatbot ID, `is_published` column, document quota to re-gate after plan change. |
| Epic 03 | The chat API reused by the widget; message quota changed by billing. |

**Unblocks:** MVP release (Final Definition of Done).

**Independent verification:** on a page of a different origin, a visitor chats with a published bot and gets a grounded answer; an unpublished bot shows the unavailable state; switching the plan in the UI changes the server-enforced document and message limits.

## User Stories

### US-04.01 — Publish and get my embed code (P0)
**As an** owner, **I want** to publish my bot and copy a script snippet **so that** I can add it to my website.

### US-04.02 — Chat on an external website (P0)
**As a** website visitor, **I want** to open a chat launcher and ask questions **so that** I get answers from the company's documents without signing in.

### US-04.03 — Safe public access (P0)
**As an** owner, **I want** the public widget to expose only chat for my published bot **so that** my files, settings and quota are protected.

### US-04.04 — View plans and simulate upgrade/downgrade (P0)
**As an** owner, **I want** to see Free/Pro plans and simulate changing plan **so that** I understand what paying would unlock.

### US-04.05 — Review a working product (P0)
**As a** reviewer, **I want** a stable public demo, clear setup notes and a walkthrough **so that** I can evaluate the app without help.

## Acceptance Criteria

### US-04.01
- [ ] AC-04.01.1 Dashboard shows a publish toggle; state persists across refresh.
- [ ] AC-04.01.2 Dashboard displays the correct snippet for the current bot and deployed origin; copy button copies it and shows confirmation.
- [ ] AC-04.01.3 Only the owner can change `is_published` (server check + RLS).

### US-04.02
- [ ] AC-04.02.1 Pasting the snippet into a separate static HTML page shows a floating launcher.
- [ ] AC-04.02.2 Clicking the launcher opens the iframe chat panel with the bot name and welcome message; close button and Esc close it.
- [ ] AC-04.02.3 Panel is ~380 px wide on desktop and near full-width on mobile; launcher and controls are keyboard reachable with visible focus.
- [ ] AC-04.02.4 A visitor without an owner session can send a question and receive a grounded answer from the same retrieval + AI endpoint used by the dashboard.
- [ ] AC-04.02.5 Loading and error states (incl. Gemini unavailable) are shown clearly in the widget.

### US-04.03
- [ ] AC-04.03.1 Unknown or unpublished bot ID → friendly "This assistant is unavailable" state; no chat requests are processed.
- [ ] AC-04.03.2 Public endpoints return only name and welcome message; no document names, storage paths, owner data or chunks of any other bot.
- [ ] AC-04.03.3 The public bot ID cannot be used to call management APIs (settings, upload, delete, publish, plan).
- [ ] AC-04.03.4 Exceeding the per-IP/per-bot rate limit returns a friendly "Too many requests, try again shortly".
- [ ] AC-04.03.5 Widget messages count against the owner's monthly quota; when exhausted the widget shows a neutral unavailable message (no upgrade CTA to visitors).

### US-04.04
- [ ] AC-04.04.1 Pricing modal shows Free/Pro limits from the shared plan configuration, the current plan and current usage.
- [ ] AC-04.04.2 New owners are on Free; upgrade and downgrade require confirmation.
- [ ] AC-04.04.3 Buttons read **"Demo upgrade — no payment"**; the UI states billing is simulated; no card or payment fields exist.
- [ ] AC-04.04.4 After upgrading, the 3rd document upload and the 31st monthly message succeed (server-enforced Pro limits).
- [ ] AC-04.04.5 After downgrading with > 2 documents, no documents are deleted, new uploads are rejected until count ≤ 2, and the Free message limit applies.
- [ ] AC-04.04.6 The plan can only be changed through the authenticated server action for the caller's own profile.

### US-04.05
- [ ] AC-04.05.1 Deployed landing, authenticated dashboard, embed page and widget loader are reachable; demo page works from a different origin.
- [ ] AC-04.05.2 README covers architecture, environment variables, local setup, migrations, limitations and the demo journey.
- [ ] AC-04.05.3 `.env.example` uses placeholders only; no live secrets committed.
- [ ] AC-04.05.4 Lint, type-check, build, unit tests and one happy-path E2E test pass.
- [ ] AC-04.05.5 Two-account test confirms cross-account access denial (guessing another bot ID gives no private data).
- [ ] AC-04.05.6 Every row of the Core Test Matrix (SDD §Epic-04) passes.
- [ ] AC-04.05.7 Demo video (2–4 min) or illustrated walkthrough shows the full journey.

## Business Rules

- **BR-04.1** Public widget requests may access only **published** chatbots and only the chat operation.
- **BR-04.2** Public bot identifiers are not authorisation credentials for management APIs.
- **BR-04.3** Widget and dashboard share the same chat API and knowledge base.
- **BR-04.4** Widget traffic counts against the bot owner's monthly message quota.
- **BR-04.5** Quotas and throttling are enforced server-side, including for anonymous visitors.
- **BR-04.6** No real payments; all billing actions are clearly labelled as demo.
- **BR-04.7** Downgrade never deletes data; it blocks new uploads until the document count is below the Free limit.
- **BR-04.8** The widget is isolated in an iframe and does not read or modify the host page.
- **BR-04.9** Plan limits come only from the shared plan configuration.

## Definition of Done

- [ ] All acceptance criteria above pass.
- [ ] Reviewer embeds the bot on an independent page, chats successfully, upgrades to Pro and sees effective gating.
- [ ] Full demo journey (SDD §1) works on the deployed app without setup help, DB access or manual intervention.
- [ ] Real PDF/TXT knowledge powers both dashboard and widget.
- [ ] No private documents, privileged tokens or cross-tenant data exposed.
- [ ] README and demo deliverable included.
- [ ] SDD §9 Final Definition of Done satisfied.
