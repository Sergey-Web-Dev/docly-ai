# Architecture — Docly AI

Living architecture specification. Each feature adds a section prefixed with its task number.

---

### [TASK-001] Docly AI Lean MVP (2026-10-16)

**Inputs:** `Docly_AI_Lean_MVP_SDD.md`, `docs/epics/epic-01..04`, `tasks/TASK-001/requirements-analyst-requirements.md`

The project is **Next.js, not NestJS**. The architect skill's layered model (Controller → Service → Repository) is applied inside one Next.js App Router application:

| Skill layer | Next.js equivalent |
|---|---|
| Controller + DTO | Route Handler (`app/api/**/route.ts`) or Server Action + Zod schema — thin: parse, authenticate, call service, map errors |
| Service | `src/modules/<module>/<module>-service.ts` — business rules, quota, orchestration |
| Repository | `src/modules/<module>/<module>-repository.ts` — the only place that talks to Supabase |
| Shared integration | `src/shared/ai/`, `src/shared/supabase/`, `src/shared/rate-limit/` |

Dependency rule: `app/*` → `services` → `repositories` / `shared`. Repositories never import services; services never import from `app/`. UI components never import repositories or `shared/supabase/admin`.

---

#### 1. System Context

```text
Owner browser ──► Next.js (Vercel) ──► Supabase Auth
   (dashboard)        │                Supabase Postgres + pgvector (RLS)
                      │                Supabase Storage (private bucket)
                      ├─► Upload route ─► extract (unpdf) ─► chunk ─► embed (Gemini) ─► chunks
                      └─► POST /api/chat ─► authorize ─► quota ─► embed query ─► match_chunks ─► Gemini ─► answer
External site ──► /widget.js ──► <iframe src=/embed/[botId]> ──► same-origin POST /api/chat
Demo site (separate origin, static) embeds the snippet
```

Single repository, single Next.js app, one AI pipeline (BR-03.1 / BR-04.3). The `demo-site/` folder in the same repo is deployed separately as a static site to obtain a different origin.

#### 2. Module Placement

```text
src/
├── app/
│   ├── (marketing)/page.tsx              # Landing (Epic 01)
│   ├── (auth)/login, signup              # Auth screens (Epic 01)
│   ├── dashboard/                        # Protected: bot, documents, embed, plan modal (Epics 01–04)
│   ├── dashboard/chat/                   # Chat playground (Epic 03)
│   ├── embed/[botId]/page.tsx            # Public iframe chat (Epic 04)
│   └── api/
│       ├── documents/route.ts            # POST multipart upload + ingestion (Epic 02)
│       └── chat/route.ts                 # POST — shared by dashboard and widget (Epics 03, 04)
├── modules/
│   ├── plans/        plan-config.ts                       # Single source of plan limits (Epic 01)
│   ├── profiles/     profile-repository.ts, profile-service.ts
│   ├── chatbots/     chatbot-repository.ts, chatbot-service.ts, chatbot-actions.ts, chatbot-schemas.ts
│   ├── documents/    document-repository.ts, document-service.ts, document-actions.ts, file-validation.ts
│   ├── ingestion/    text-extractor.ts, text-chunker.ts, ingestion-service.ts
│   ├── chat/         chat-service.ts, chat-access.ts, retrieval-repository.ts, prompt-builder.ts, chat-schemas.ts
│   ├── usage/        usage-repository.ts, usage-service.ts
│   └── billing/      billing-service.ts, billing-actions.ts
├── shared/
│   ├── supabase/     server-client.ts (user, RLS), admin-client.ts (service role, server-only), browser-client.ts
│   ├── ai/           ai-provider.ts (interface), gemini-provider.ts, fake-provider.ts, get-ai-provider.ts
│   ├── rate-limit/   rate-limiter.ts
│   ├── errors/       app-error.ts, to-http-response.ts
│   └── logger/       logger.ts
├── components/       ui/ (shadcn), feature components
└── proxy.ts | middleware.ts             # Session refresh + /dashboard guard (name per installed Next.js version)
public/widget.js                         # Vanilla loader, no build step
demo-site/index.html                     # Separate-origin demo page
supabase/migrations/*.sql                # Versioned schema, RLS, RPCs
```

`admin-client.ts` and `shared/ai/*` start with `import 'server-only'` so a client import fails the build (BR-01.5).

#### 3. Data Model

```text
auth.users 1──1 profiles 1──0..1 chatbots 1──* documents 1──* document_chunks
                   │                 │                               (chatbot_id denormalised)
                   └──* usage_counters      rate_limit_hits (no FK; hashed keys)
```

| Table | Columns | Constraints / indexes |
|---|---|---|
| `profiles` | `id uuid PK → auth.users ON DELETE CASCADE`, `plan text CHECK (plan IN ('free','pro')) DEFAULT 'free'`, `created_at` | Row created by `AFTER INSERT ON auth.users` trigger |
| `chatbots` | `id uuid PK`, `owner_id → profiles ON DELETE CASCADE`, `name varchar(60)`, `welcome_message varchar(300)`, `accent_color text NULL`, `is_published bool DEFAULT false`, `created_at`, `updated_at` | `UNIQUE (owner_id)` → one bot per account at DB level (BR-02.1) |
| `documents` | `id`, `chatbot_id → chatbots ON DELETE CASCADE`, `file_name`, `storage_path`, `mime_type`, `size_bytes`, `status CHECK IN ('processing','ready','failed')`, `error_message NULL`, `created_at` | `UNIQUE (chatbot_id, file_name)` → duplicate-ingestion guard; index `(chatbot_id)` |
| `document_chunks` | `id`, `document_id → documents ON DELETE CASCADE`, `chatbot_id → chatbots ON DELETE CASCADE`, `chunk_index int`, `content text`, `embedding vector(768)` | HNSW index `embedding vector_cosine_ops`; btree `(chatbot_id)` |
| `usage_counters` | `id`, `owner_id → profiles ON DELETE CASCADE`, `month date` (first day, UTC), `message_count int DEFAULT 0 CHECK >= 0` | `UNIQUE (owner_id, month)` |
| `rate_limit_hits` | `key text`, `window_start timestamptz`, `count int` | `PRIMARY KEY (key, window_start)` |

**Storage:** private bucket `documents`, path `{owner_id}/{chatbot_id}/{document_id}.{ext}`; storage policies allow owner access only where the first path segment equals `auth.uid()`.

**Deletion:** document delete = remove storage object, then delete row (chunks cascade). Bot/account deletion is out of MVP scope but cascades are defined.

#### 4. Key Decisions (ADR summary)

| # | Decision | Rationale | Rejected |
|---|---|---|---|
| AD-01 | One Next.js app, module folders with service/repository split | SDD mandates one app; layering keeps route files thin and logic testable | Separate API server, NestJS |
| AD-02 | **Two Supabase clients:** user client (cookie session, RLS) for all owner management; admin client (service role) only in chat, quota and rate-limit paths **after** server authorization | RLS is defence-in-depth for owner CRUD; the public widget has no session, so it needs a narrow privileged path | Admin client everywhere (RLS useless); anon-role RLS for public chat (leaks chunk reads if a policy is wrong) |
| AD-03 | Privileged RPCs (`reserve_document_slot`, `reserve_message`, `refund_message`, `match_chunks`, `hit_rate_limit`) are `SECURITY DEFINER`, `EXECUTE` revoked from `anon`/`authenticated`, granted to `service_role` only. Limits are passed in from `plan-config.ts` | Keeps plan limits in exactly one place (BR-01.2) while preventing a browser from calling the RPC with a fake limit | Plan-limits table in SQL (duplicates config); limits hard-coded in SQL |
| AD-04 | Mutations from dashboard forms use **Server Actions**; upload and chat use **Route Handlers** | Server Actions remove boilerplate for small forms; upload needs multipart + `maxDuration`; chat must be callable from the iframe | All-REST API (more code) |
| AD-05 | **Synchronous ingestion** inside `POST /api/documents` (`runtime = 'nodejs'`, `maxDuration = 60`) | SDD forbids async job queues; 5 MB / capped text fits in one request | Queue + worker, Edge Functions |
| AD-06 | PDF text extraction with **`unpdf`** (serverless-friendly pdf.js build); TXT decoded as UTF-8 | Works on Vercel without native deps; text-based PDFs only (no OCR, per scope) | `pdf-parse` (stale, fs side effects), OCR |
| AD-07 | AI behind `AiProvider { embedDocuments(texts), embedQuery(text), generateAnswer(input) }`; implementations `gemini` and `fake` selected by `AI_PROVIDER` env | Provider isolation (SDD §3); `fake` gives deterministic unit/E2E tests and offline dev | Direct SDK calls in services |
| AD-08 | Embeddings: `@google/genai` `embedContent`, model from `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`), `outputDimensionality: 768`, `taskType` `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`; cosine distance | 768 fits pgvector HNSW (≤ 2000 dims) with good quality/storage trade-off; cosine is insensitive to truncation norm | 3072 dims (no HNSW index) |
| AD-09 | Generation model from `GEMINI_CHAT_MODEL` (current Flash-tier model, confirmed at implementation), `temperature 0.2`, max output ~512 tokens, 20 s timeout, no streaming | Cheap, fast, concise answers; streaming out of scope | Hard-coded model ID |
| AD-10 | **Message quota = reserve-then-refund.** `reserve_message(owner, month, limit)` does `INSERT … ON CONFLICT DO UPDATE SET message_count = message_count + 1 WHERE message_count < limit RETURNING` before calling Gemini; on provider failure `refund_message` decrements | Strict atomic bound under concurrency; failed requests end up uncounted (SDD §4) | Check-then-increment after success (concurrency overshoot) |
| AD-11 | **Document quota** via `reserve_document_slot(chatbot_id, file_name, storage_path, …, limit)`: locks the chatbot row (`FOR UPDATE`), counts documents, inserts the `processing` row or raises `QUOTA_EXCEEDED` / `DUPLICATE` | Atomic count+insert; quota checked before storage write (AC-02.05.2) | Count in TS then insert (race) |
| AD-12 | Rate limiting in Postgres: `hit_rate_limit(key, window_seconds, max)` fixed window; key = `sha256(ip + RATE_LIMIT_SALT) + ':' + bot_id`; **10 req / 60 s** per IP per bot on the public path; stale rows purged opportunistically | Works on serverless (in-memory is per-instance); no raw IPs stored; no extra infra | Redis/Upstash (extra service), in-memory map |
| AD-13 | **One chat endpoint** `POST /api/chat { botId, message }`. `chat-access.ts` resolves the caller: owner session owning the bot → `owner` mode (works unpublished); otherwise → `public` mode (bot must be published; rate limit applies). Both modes then run the identical pipeline | Satisfies "never build separate AI pipelines"; public bot ID is never a management credential | Separate `/api/public/chat` |
| AD-14 | Widget: `public/widget.js` reads `data-bot-id` from `document.currentScript`, derives app origin from its `src`, injects launcher + `<iframe src="{origin}/embed/{botId}">`. The iframe is same-origin with the API → no CORS needed | Full isolation from host page (BR-04.8); tiny, dependency-free | Web component injecting chat DOM into host page |
| AD-15 | Headers: `/embed/*` sends `Content-Security-Policy: frame-ancestors *`; all other routes `frame-ancestors 'none'` + `X-Frame-Options: DENY` | Embeddable widget without making the dashboard clickjackable | Global framing allowed |
| AD-16 | Plan change via Server Action `setPlan('free'|'pro')` → `billing-service` → admin client updates `profiles.plan WHERE id = session user`. `profiles` has no UPDATE policy for clients | Client cannot self-upgrade (AC-01.03.3); still a one-click demo | Client-side update with RLS policy |
| AD-17 | Demo website = `demo-site/index.html` deployed as a separate static project (second Vercel project with root `demo-site/`, or GitHub Pages) | Real cross-origin proof (Phase-3 exit) from the same repo | Page served by the main app (same origin) |
| AD-18 | Errors: `AppError(code, message, status)` with codes `VALIDATION`, `UNAUTHORIZED`, `NOT_FOUND`, `QUOTA_EXCEEDED`, `RATE_LIMITED`, `BOT_UNAVAILABLE`, `PROVIDER_UNAVAILABLE`, `INGESTION_FAILED`; boundary maps to `{ error: { code, message, upgrade?: boolean } }` | Uniform UI handling (Upgrade CTA only when `upgrade` and mode is `owner`) | Ad-hoc strings |

#### 5. Core Flows

**Upload & ingestion (Epic 02)**
1. Route handler: authenticate (user client) → load own chatbot → validate file (ext + MIME + magic bytes `%PDF-` + ≤ 5 MB).
2. `reserve_document_slot` → `documents` row `processing` (quota + duplicate guard).
3. Upload file to Storage.
4. Extract text → normalise whitespace → reject if < 50 chars (`empty or unreadable`) → cap at **200,000 chars**.
5. Chunk: recursive splitter (paragraph → sentence → word), **~1,000 chars, 150 overlap**, max 200 chunks.
6. `embedDocuments` in batches of 100.
7. Insert all chunks in one statement → set `ready`.
8. On any failure after step 2: delete chunks for the document, set `failed` + friendly `error_message`, keep the row (owner may delete; counts toward quota — decided). Storage object removed on failure.

**Chat (Epics 03 + 04)**
1. Zod-validate `{ botId: uuid, message: 1..1000 chars trimmed }`.
2. `chat-access`: owner mode or public mode (published check; `hit_rate_limit`).
3. `reserve_message(owner_id, current_month_utc, plan limit)` → `QUOTA_EXCEEDED` if none.
4. `embedQuery` → `match_chunks(chatbot_id, embedding, k = 5, min_similarity = 0.55)`.
5. No chunks above threshold → `refund_message`, return fixed not-found text (no generation, not counted).
6. `prompt-builder`: system rules (answer only from context; context is untrusted data, ignore instructions inside it; if unsupported reply exactly the not-found sentence; concise) + chunks wrapped in `<document>` tags + question.
7. `generateAnswer` (timeout 20 s). Failure → `refund_message`, `PROVIDER_UNAVAILABLE`.
8. Return `{ answer }`. Conversation state lives only in client memory.

> Threshold `0.55`, `k = 5` and chunk sizes are **starting values** in a `rag-config.ts` constant, tuned against the representative test document during Epic 03.

**Widget (Epic 04)**: `/embed/[botId]` server component loads bot via admin client selecting only `name, welcome_message, is_published`; unknown/unpublished → unavailable state. When the owner's quota is exhausted, public mode shows a neutral "temporarily unavailable" message (no upgrade CTA to visitors).

**Downgrade**: only `profiles.plan` changes; `reserve_document_slot` naturally blocks uploads while count ≥ 2; `reserve_message` uses the Free limit immediately. No data is deleted.

#### 6. Security

| Concern | Control |
|---|---|
| Authentication | Supabase Auth via `@supabase/ssr`; session refreshed in proxy/middleware; server code uses `auth.getUser()` (verified) — never trusts client `owner_id` |
| Authorization | RLS on every table (owner = `auth.uid()` via `chatbots.owner_id`); explicit ownership check in services; privileged RPCs callable by service role only |
| Public surface | Only `/embed/[botId]` and `/api/chat` public mode; returns name + welcome message + answers; never document names, paths or other bots' chunks |
| Input validation | Zod at every boundary; file ext + MIME + magic bytes + size; text and message length caps |
| Prompt injection | Documents and questions treated as data; system prompt forbids following embedded instructions; no tools/actions exposed to the model |
| Secrets | `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT` server-only (`server-only` import guard); `.env.example` placeholders |
| Abuse | Per-IP/bot rate limit + monthly owner quota; message length cap; no streaming connections held open |
| Logging | `logger` records operation, ids, error code; never document text, prompts, answers or keys |
| Framing | AD-15 headers |

#### 7. Scalability & Limits (MVP-appropriate)

- Indexes: HNSW on embeddings, btree on `chatbot_id` (chunks, documents), unique `(owner_id, month)`.
- Synchronous ingestion bounded by 5 MB / 200 k chars / 200 chunks / 2 embedding batches → fits a 60 s function.
- No caching, no queues, no Redis — explicitly out of scope; documented in README limitations.
- Hosting: Vercel (Hobby for the demo; verify current free-tier terms and function duration before deploy).

#### 8. Environment Variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable), `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_EMBEDDING_MODEL`, `AI_PROVIDER` (`gemini|fake`), `RATE_LIMIT_SALT`, `NEXT_PUBLIC_APP_URL`.

#### 9. Testing Strategy

| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | `plan-config`, `file-validation`, `text-chunker`, `prompt-builder`, `chat-access` decisions, error mapping, Zod schemas |
| Integration | Vitest + local Supabase (`supabase start`) | RLS cross-account denial, RPC quotas (concurrent `reserve_message`), `match_chunks` bot isolation, cascade delete |
| E2E | Playwright, `AI_PROVIDER=fake` | Happy path: sign up → bot → upload TXT → ask → snippet → embed page answers → upgrade → 3rd upload succeeds |
| Manual / smoke | Real Gemini on preview | Representative document: 3 known questions + 1 unrelated (AC-03.02.2/3) |

#### 10. Epic → Architecture Mapping

| Epic | Delivers |
|---|---|
| 01 | Scaffold, `shared/supabase`, `shared/errors`, `shared/logger`, proxy guard, `profiles` + trigger, `plans/plan-config`, landing, auth, CI scripts, Vercel preview |
| 02 | `chatbots`, `documents`, `document_chunks`, storage bucket/policies, `reserve_document_slot`, `ingestion/*`, `shared/ai` (embed), dashboard bot + documents |
| 03 | `usage_counters`, `reserve_message`/`refund_message`, `match_chunks`, `chat/*`, `shared/ai` (generate), `/api/chat` owner mode, playground |
| 04 | `chat-access` public mode, `rate_limit_hits` + `hit_rate_limit`, `/embed/[botId]`, `public/widget.js`, framing headers, `billing/*`, plan modal, `demo-site/`, README, E2E, deploy |

#### 11. Resolved Gap-Analysis Items

| Gap (TASK-001) | Resolution |
|---|---|
| Embedding model & dimension | `gemini-embedding-001` (env-configurable), 768 dims, cosine (AD-08) |
| Chunk size / top-k / threshold / message length / text cap | 1,000 / 150 overlap; k = 5; 0.55 start; 1,000 chars; 200 k chars (tunable constants) |
| Rate limit values & storage | 10 req/min per IP per bot, Postgres fixed window, hashed IP (AD-12) |
| Do `Failed` docs count to quota? | Yes; owner deletes them (AD-11, flow step 8) |
| Widget message on quota exhaustion | Neutral "temporarily unavailable", no upgrade CTA |
| Hosting timeout vs sync ingestion | Vercel Node runtime `maxDuration = 60` + hard input caps (AD-05) |
| Accent color (P1) | Column exists (nullable); no UI unless time remains |

#### 12. Open Items to Confirm at Implementation

- Exact current Gemini Flash model ID and `gemini-embedding-001` availability on the chosen API key (check Context7 / Google docs when implementing Epic 02/03).
- Next.js major version installed → `proxy.ts` vs `middleware.ts`.
- Demo-site host (second Vercel project vs GitHub Pages).

---

### [TASK-001] Simplified MVP Architecture — supersedes parts of the section above (2026-10-16)

**Canonical document:** `docs/architecture.md`. Where it conflicts with the section above, `docs/architecture.md` wins.

**Simplifications (priority: fast development, minimal complexity, free tier):**

| Earlier decision | Replaced by | Rationale |
|---|---|---|
| AD-01 `src/modules/*` with service/repository files per module | Flat `src/lib/*.ts` plain functions (`plans`, `ai`, `ingest`, `chat`, `prompt`, `schemas`, `errors`) called by thin route handlers / Server Actions | Fewer files and indirections; MVP has ~5 domain operations |
| AD-07 `AiProvider` interface + `gemini`/`fake` implementations | Single `lib/ai.ts` (`embedTexts`, `embedQuery`, `generateAnswer`); tests mock it with `vi.mock`; E2E runs on a preview with real Gemini | File boundary is enough isolation; no runtime switch |
| AD-11 `reserve_document_slot` | Renamed `create_document` (same atomic semantics) | Naming |
| AD-12 table `rate_limit_hits` | `rate_limits` | Naming |
| Storage path `{owner}/{chatbot}/{doc}` | `{owner}/{doc}.{ext}` | One bot per owner |

**Unchanged (security-critical):** RLS on all tables; user client for owner CRUD; admin client only after server authorization (chat, embed, setPlan); service-role-only SQL functions with limits passed from `lib/plans.ts`; reserve-then-refund message quota; single `/api/chat` for dashboard and widget; iframe widget + framing headers; synchronous ingestion; 768-dim `gemini-embedding-001` with cosine HNSW.

**Deployment:** Vercel Hobby (app) + second Vercel project for `demo-site/` + Supabase Free + Gemini free tier.
