# Docly AI — Lean MVP Specification (SDD)

**Version:** 2.0 (take-home assignment)  
**Status:** Ready for planning  
**Goal:** Deliver one complete, polished flow with the minimum code necessary.  
**Timebox:** 20–35 focused development hours with AI assistance (estimate, not a guarantee).  
**Priority:** P0 = must ship; P1 = only if time remains.

---

## 1. Product Overview

**Docly AI** lets a small business upload company documents, ask questions about them in a ChatGPT-like interface, and embed the same chatbot on its own website.

**Tagline:** Your docs. Instant answers.

**Demo journey (must work):** Visit landing → sign up → create bot → upload PDF/TXT → ask a question → receive a grounded answer → copy embed snippet → open demo website → ask the same bot a question → view Free/Pro pricing → upgrade in mock billing → observe a real limit change.

**Success condition:** A reviewer can complete this journey without setup instructions, database access, or manual intervention.

## 2. In Scope (P0)

- [ ] Clear, responsive landing page with hero, 3-step explanation, feature preview, pricing, CTA.
- [ ] Supabase email/password sign-up, sign-in and sign-out.
- [ ] Single chatbot per user in the MVP; name and welcome message.
- [ ] Upload PDF and TXT documents (max 5 MB each); show processing state and errors.
- [ ] Extract text, chunk it, embed it and store vectors in Supabase pgvector.
- [ ] ChatGPT-like chat page with AI answers grounded in uploaded documents; concise not-found response when evidence is missing.
- [ ] Public embeddable widget via one copyable `<script>` snippet, isolated in an iframe.
- [ ] Free/Pro pricing, mock upgrade/downgrade flow and server-enforced usage/feature limits.
- [ ] Public deployed demo, README, and a 2–4 minute narrated walkthrough (or screenshot tutorial).

### Explicitly out of scope

- Multi-workspace/team collaboration, multiple bots per account, roles beyond owner/visitor.
- Analytics dashboard, conversation history persistence, custom domains, multilingual UI.
- Streaming tokens, citations with clickable page numbers, advanced prompt editor.
- OCR, DOCX, websites crawling, integrations, batch upload, async job queues.
- Real Stripe payments, invoices, webhooks, subscription renewals.
- Custom widget theming beyond name/welcome text and one accent color (P1).
- Production-scale throughput and enterprise SLOs.

**Trade-off:** Widget and dashboard share the same chat API and knowledge base. Never build separate AI pipelines.

## 3. Suggested Technology

| Area | Choice |
|---|---|
| App | Next.js (App Router), TypeScript |
| UI | Tailwind CSS + shadcn/ui + Lucide icons |
| Auth / DB / Storage | Supabase Auth, PostgreSQL, Storage |
| Retrieval | pgvector similarity search scoped by chatbot ID |
| AI | Gemini for generation, compatible embedding model; isolate provider behind a small adapter |
| Testing | Vitest for pure logic; Playwright smoke tests |
| Hosting | Compatible Next.js hosting plan; verify free-tier terms before deploying |

**Keep one repository and one Next.js application.** A public `/embed/[botId]` page renders in an iframe; a lightweight `/widget.js` loader inserts a floating launcher/iframe into customer sites.

### Minimal architecture

```text
Owner browser --> Next.js app --> Supabase Auth / Storage / Postgres
                          |                  + pgvector
                          +--> Upload -> text extraction -> chunks -> embeddings
                          +--> Chat -> vector retrieval -> Gemini -> answer
External website --> widget.js --> iframe --> same Chat API
```

### Minimal data model

- `profiles`: `id`, `plan` (`free|pro`), `created_at`.
- `chatbots`: `id`, `owner_id`, `name`, `welcome_message`, `accent_color`, `is_published`.
- `documents`: `id`, `chatbot_id`, `file_name`, `storage_path`, `status` (`processing|ready|failed`), `error_message`.
- `document_chunks`: `id`, `document_id`, `chatbot_id`, `content`, `embedding`.
- `usage_counters`: `id`, `owner_id`, `month`, `message_count` (uniqueness per owner/month).

**Implementation note:** Auth users live in Supabase Auth. Define foreign keys, indexes, RLS policies and deletion behavior in versioned SQL migrations. Store vectors with dimensions matching the chosen embedding model.

## 4. Pricing and Gating

| | Free | Pro (mock, $19/mo) |
|---|---|---|
| Bots | 1 | 1 |
| Documents | 2 | 10 |
| AI messages / calendar month | 30 | 300 |
| Embedded widget | Yes | Yes |
| Branding customization | No | Accent color (P1) |

No money is charged. Buttons must explicitly say **Demo upgrade — no payment**. Server must reject document uploads or chat requests above limits with a clear error and Upgrade CTA. Count successful AI requests atomically to avoid easy quota bypass; consider failed requests separately. Widget traffic counts against the bot owner's monthly quota.

## 5. User Roles

| Role | Can do |
|---|---|
| Owner (authenticated) | Manage their bot, upload own documents, test chat, view plan, copy snippet |
| Website visitor (anonymous) | Chat only with a published bot via public widget |

**Boundary:** Visitors cannot read private document files, modify bot settings or query another bot's chunks. Owners cannot access another owner's resources. Public bot identifiers are not authorization credentials for management APIs.

---

# Epic-01: Landing, Auth and Bot Setup

## Description / Business Value

A visitor must understand the offer, create an account and set up a usable bot quickly.

## In Scope

Landing page, sign-up/sign-in/sign-out, owner dashboard, bot creation and settings.

## User Stories & Acceptance Criteria

### US-01.01 — Understand product and pricing (P0)

**As a** visitor, **I want** a concise landing page **so that** I can decide whether to try Docly AI.

- [ ] Hero states what the app does and has a working CTA.
- [ ] Three-step section: Upload → Ask → Embed.
- [ ] Free and Pro prices/limits are visible and consistent with app logic.
- [ ] Layout works on mobile and desktop; no dead links or placeholder sections.

### US-01.02 — Sign in and create bot (P0)

**As an** owner, **I want** to sign up and create a bot **so that** I can upload knowledge.

- [ ] Email/password sign-up, sign-in, sign-out work via Supabase.
- [ ] Protected dashboard redirects unauthenticated users to login.
- [ ] Owner can create one bot with a name and welcome message.
- [ ] Dashboard shows bot and clear next action: Upload documents.
- [ ] A different account cannot access this bot's management endpoints.

**Definition of Done:** Landing and sign-in work in a deployed preview; bot persists across refresh.

---

# Epic-02: Documents and Grounded Chat

## Description / Business Value

Transform uploaded files into useful grounded answers. This is the central product feature.

## In Scope

PDF/TXT upload, ingestion, embeddings, vector retrieval, simple chat UI.

## User Stories & Acceptance Criteria

### US-02.01 — Upload company documents (P0)

**As an** owner, **I want** to upload a document **so that** my bot learns company knowledge.

- [ ] Accept only `.pdf` and `.txt`, up to 5 MB each; reject unsupported or oversized files.
- [ ] Show `Processing`, `Ready` or `Failed` with useful feedback.
- [ ] Extract text, split into bounded chunks, generate embeddings, persist chunks.
- [ ] Reject empty or unreadable documents without marking them Ready.
- [ ] Enforce document quotas before accepting an upload.
- [ ] Owner sees document names and may delete a document and its chunks.

### US-02.02 — Ask questions in dashboard (P0)

**As an** owner, **I want** to ask my bot questions **so that** I can check its responses.

- [ ] Chat interface supports send, loading, assistant response and error states.
- [ ] Server retrieves relevant chunks belonging **only** to selected bot.
- [ ] AI instruction requires grounding in retrieved context; if none supports an answer, respond with a clear 'I don't know based on these documents.'
- [ ] Reject empty input and bound message length.
- [ ] API key remains server-side; account quota applies to requests.
- [ ] A representative test document produces a correct answer to at least three known questions and declines an unrelated one.

**Definition of Done:** A real uploaded PDF/TXT can answer relevant questions and fails safely when information is absent or provider errors occur.

---

# Epic-03: Public Widget and Billing

## Description / Business Value

The owner can publish the bot externally and see how SaaS plans would work.

## User Stories & Acceptance Criteria

### US-03.01 — Embed on an external site (P0)

**As an** owner, **I want** a copyable widget script **so that** visitors can ask questions on my website.

- [ ] Dashboard displays the correct snippet for the current bot.
- [ ] Widget launcher appears on a separate demo HTML website.
- [ ] Clicking launcher opens a responsive iframe chat panel.
- [ ] Public visitor can chat with a published bot without an owner session.
- [ ] Widget uses same document retrieval and AI endpoint as dashboard.
- [ ] Unpublished or unknown bot gives a friendly unavailable state.
- [ ] Public chat has basic IP/bot rate limiting and monthly plan quota; no privileged data is exposed.

### US-03.02 — Change demo plan (P0)

**As an** owner, **I want** to view plans and simulate an upgrade **so that** I understand what paying would unlock.

- [ ] Pricing page shows Free/Pro limits from a shared plan configuration.
- [ ] Owner starts on Free and can mock-upgrade/downgrade with confirmation.
- [ ] UI clearly states this is simulated billing; no card details are collected.
- [ ] Server enforces limits, not only the frontend.
- [ ] Downgrading does not delete existing docs; it blocks new uploads beyond Free limits until usage is within quota.

**Definition of Done:** Reviewer embeds bot on an independent page, chats successfully, upgrades to Pro, and sees effective gating.

---

# Epic-04: QA, Deployment and Demo

## User Stories & Acceptance Criteria

### US-04.01 — Review a working product (P0)

**As a** reviewer, **I want** a stable public demo and clear setup notes **so that** I can evaluate the app.

- [ ] Deployed landing, authenticated dashboard and public widget are reachable.
- [ ] README includes architecture summary, environment variables, local setup, migrations and limitations.
- [ ] `.env.example` has placeholders, no live secrets committed.
- [ ] Lint, type-check, build, key unit tests and one happy-path E2E test pass.
- [ ] Test two separate accounts for cross-account access denial.
- [ ] Demo video (2–4 minutes) or illustrated written walkthrough shows the end-to-end journey.
- [ ] Empty states, loading states, form errors and responsive layout reviewed.

## Core Test Matrix

| Scenario | Expected |
|---|---|
| Upload text-based PDF; ask documented question | Correct grounded response |
| Ask unrelated question | States docs do not support answer |
| Upload invalid/large file | Action rejected and explained |
| Sign in as another owner; guess bot ID | No access to private data |
| Embed published bot on static page | Loads and answers |
| Query unpublished bot | Public chat unavailable |
| Hit Free message/document cap | Server rejects with upgrade guidance |
| Mock upgrade to Pro | New limits apply |
| Gemini unavailable | Friendly error, no broken UI |

---

## 6. Key Business and Security Rules

1. Each account owns one chatbot. All management operations require owner authentication and authorization.
2. Use Supabase RLS plus server checks on resources and storage paths. Never trust a client-supplied `owner_id`.
3. Document ingestion and vector search always filter by authorized `chatbot_id`.
4. AI API keys and privileged Supabase keys remain on the server.
5. Uploads have type, size and extracted-text limits. Document content is untrusted context, not trusted AI instructions.
6. Public widget requests may access only **published** chatbots and only the chat operation.
7. Enforce quotas and throttling server-side (including public widget users); do not trust UI gating.
8. Prevent duplicate ingestion and partial, misleading `Ready` status on failures. Delete associated chunks when deleting documents.
9. Track basic request errors without logging raw private documents or secrets.
10. No real payments; billing actions must be clearly labeled as a demo.

## 7. UX / Design Direction

**Visual direction:** Clean, light B2B SaaS inspired by Linear/Vercel; white/off-white backgrounds, dark typography, one blue or indigo accent, shadcn/ui components, restrained motion.

**Screens (only five):**
1. Landing with pricing.
2. Login / signup.
3. Dashboard: bot + documents + embed code (single view, tabs or sections).
4. Chat playground.
5. Pricing / plan modal.

**Widget:** floating launcher + 380px-ish chat pane on desktop; full-width or near-full-width on mobile. Keyboard accessible, easy close button, clear loading indicator.

**Avoid:** decorative graphs, fake usage metrics, empty navigation sections, 3D hero art, over-designed onboarding.

## 8. Build Order / Stop Conditions

| Phase | Work | Exit condition |
|---|---|---|
| 1 | Scaffold, Supabase migrations, auth, landing | User signs in and sees own bot |
| 2 | Upload, extraction, embeddings, RAG, chat | Document Q&A works end-to-end |
| 3 | Widget loader/iframe and external demo page | Visitor chats on a different origin |
| 4 | Mock billing, quotas, UI polish, deploy | Review journey works; tests pass |

**Working agreement for Codex:** Implement one user story at a time. Before coding, state approach and files. After coding, run relevant checks and report acceptance criteria pass/fail. Do not implement P1 or out-of-scope features without explicit approval.

## 9. Final Definition of Done

- [ ] All P0 user stories meet their acceptance criteria.
- [ ] End-to-end demo journey works on the deployed application.
- [ ] Real PDF/TXT knowledge powers both dashboard and embedded widget.
- [ ] Free/Pro mock billing demonstrably changes enforced limits.
- [ ] No private documents, privileged tokens or cross-tenant data are exposed.
- [ ] README and demo deliverable are included.

**Timebox rule:** If behind schedule, cut P1 customization, refine design last, and preserve the required end-to-end journey. Do not cut embed functionality, real grounded chat, or pricing/billing: all are explicitly required by the assignment.
