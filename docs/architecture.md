# Docly AI — MVP Architecture

**Status:** Approved for implementation planning · **Date:** 2026-10-16 · **Task:** TASK-001
**Inputs:** `Docly_AI_Lean_MVP_SDD.md` (product spec), `docs/epics/epic-01..04`

Principle: **one Next.js app, one database, one AI pipeline.** Plain functions over abstractions. Security lives in the database (RLS + a few SQL functions) and in thin server checks.

---

## 1. Overview

```text
                 ┌──────────────────────── Vercel (Hobby) ────────────────────────┐
Owner browser ──►│ Next.js App Router                                             │
                 │  pages: /  /login  /signup  /dashboard  /dashboard/chat        │
                 │  public: /embed/[botId]   /widget.js                           │
                 │  API:   POST /api/documents   POST /api/chat                   │
                 │  Server Actions: bot settings, publish, delete doc, set plan   │
                 └───────┬──────────────────────────────┬─────────────────────────┘
                         │                              │
              Supabase (Free)                    Google Gemini API (free tier)
              Auth · Postgres + pgvector         embeddings + answer generation
              Storage (private bucket)

External site ─► <script src=".../widget.js" data-bot-id> ─► <iframe /embed/[botId]> ─► POST /api/chat (same origin)
Demo site (demo-site/index.html, separate Vercel project = different origin)
```

| Concern | Choice | Why |
|---|---|---|
| App | Next.js (App Router) + TypeScript, Node runtime | One deployable, server code next to UI |
| UI | Tailwind CSS + shadcn/ui + Lucide | Fast, consistent, no custom design system |
| Auth | Supabase Auth email/password via `@supabase/ssr` | Cookies + RLS out of the box |
| DB | Supabase Postgres + `pgvector` | Data, vectors and access rules in one place |
| Files | Supabase Storage, private bucket | Same auth model as DB |
| AI | `@google/genai`: `gemini-embedding-001` (768 dims) + a Gemini Flash model | Free tier, one SDK for both calls |
| PDF | `unpdf` | Pure JS, works on serverless |
| Validation | Zod | Same schema on client and server |
| Tests | Vitest + Playwright | Per SDD |
| Hosting | Vercel Hobby + Supabase Free | Zero cost, git-push deploys |

**Not used (on purpose):** separate backend, microservices, queues/workers, Edge Functions, Redis, ORM, state-management library, repository/service class layers, streaming, real payments.

---

## 2. Project Structure

```text
src/
├── app/
│   ├── page.tsx                      # Landing (hero, 3 steps, features, pricing, CTA)
│   ├── login/page.tsx, signup/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx                # Auth guard (server), header, plan badge, sign-out
│   │   ├── page.tsx                  # Bot settings · Documents · Embed code · Plan modal
│   │   ├── chat/page.tsx             # Chat playground
│   │   └── actions.ts                # Server Actions: createBot, updateBot, setPublished, deleteDocument, setPlan
│   ├── embed/[botId]/page.tsx        # Public iframe chat
│   └── api/
│       ├── documents/[id]/ingest/route.ts  # Ingestion after direct-to-Storage upload (maxDuration = 60)
│       └── chat/route.ts             # Chat for dashboard AND widget
├── components/                       # shadcn/ui + feature components (ChatWindow shared by playground and embed)
├── lib/
│   ├── supabase/server.ts            # User client (cookies → RLS)
│   ├── supabase/admin.ts             # Service-role client — `import 'server-only'`
│   ├── supabase/client.ts            # Browser client (auth forms only)
│   ├── plans.ts                      # PLANS = { free: {...}, pro: {...} } — single source of limits
│   ├── ai.ts                         # embedTexts(), embedQuery(), generateAnswer() — the only Gemini code
│   ├── ingest.ts                     # validateFile(), extractText(), chunkText(), ingestDocument()
│   ├── chat.ts                       # answerQuestion(): quota → retrieve → prompt → generate
│   ├── prompt.ts                     # buildPrompt(), NOT_FOUND_ANSWER
│   ├── schemas.ts                    # Zod schemas (bot form, chat request)
│   └── errors.ts                     # AppError + toResponse()
└── proxy.ts                          # Next.js 16 proxy: Supabase session refresh + /dashboard redirect
public/widget.js                      # ~60 lines vanilla JS loader
demo-site/index.html                  # Static page with the snippet
supabase/migrations/                  # Schema, RLS, storage policies, SQL functions
```

Rules: route handlers and actions stay thin (validate → call a `lib/` function → return). `lib/supabase/admin.ts` and `lib/ai.ts` are server-only. Components never touch the admin client.

---

## 3. Data Model

```text
auth.users 1─1 profiles 1─0..1 chatbots 1─* documents 1─* document_chunks
                  └─* usage_counters
rate_limits (standalone)
```

| Table | Columns | Notes |
|---|---|---|
| `profiles` | `id` (PK, FK auth.users, cascade), `plan` `'free'\|'pro'` default `'free'`, `created_at` | Created by trigger on sign-up. Clients may SELECT own row only — no UPDATE |
| `chatbots` | `id`, `owner_id` (FK profiles, cascade), `name` ≤60, `welcome_message` ≤300, `accent_color` null (P1), `is_published` default false, timestamps | `UNIQUE(owner_id)` = one bot per account |
| `documents` | `id`, `chatbot_id` (FK, cascade), `file_name`, `storage_path`, `size_bytes`, `status` `processing\|ready\|failed`, `error_message`, `created_at` | `UNIQUE(chatbot_id, file_name)` blocks duplicate ingestion |
| `document_chunks` | `id`, `document_id` (FK, cascade), `chatbot_id` (FK, cascade), `content`, `embedding vector(768)` | HNSW index (cosine), index on `chatbot_id` |
| `usage_counters` | `owner_id` (FK, cascade), `month` date, `message_count` int ≥ 0 | PK `(owner_id, month)` |
| `rate_limits` | `key` text, `window_start` timestamptz, `count` int | PK `(key, window_start)`; key = hash(IP)+bot id, no raw IPs |

Storage: bucket `documents` (private, 5 MB, PDF/TXT MIME), path `{owner_id}/{document_id}`.

---

## 4. Multi-Tenant Security

Two layers, both required:

**1. RLS (database).** Enabled on every table.
- `profiles`: select where `id = auth.uid()`.
- `chatbots`: all operations where `owner_id = auth.uid()`.
- `documents`, `document_chunks`: all operations where the parent chatbot's `owner_id = auth.uid()`.
- `usage_counters`: select own rows only. `rate_limits`: no client access.
- Storage: owner may read/write/delete objects whose first path segment = `auth.uid()`.

**2. Server checks.** Identity always from `supabase.auth.getUser()` on the server; never from request bodies.

**Which Supabase client where**

| Operation | Client | Why |
|---|---|---|
| Dashboard reads/writes (bot, documents, upload, delete, publish) | **User client** (RLS applies) | A bug in app code still cannot cross tenants |
| `setPlan` | Admin client, `WHERE id = <session user>` | Clients must not change their own plan |
| `/api/chat`, `/embed/[botId]` | Admin client, **after** access check, every query filtered by that `chatbot_id` | Anonymous visitors have no session |

**Privileged SQL functions** (`SECURITY DEFINER`, `EXECUTE` granted to `service_role` only, so browsers cannot call them):

| Function | Purpose |
|---|---|
| `reserve_message(owner_id, month, limit)` | Atomic `+1` only if `message_count < limit`; returns false when over quota |
| `refund_message(owner_id, month)` | `-1` when generation failed or nothing was found → only successful answers count |
| `create_document(chatbot_id, file_name, storage_path, size, limit)` | Locks the bot row, counts docs, inserts `processing` row or raises `QUOTA_EXCEEDED` |
| `match_chunks(chatbot_id, embedding, k, min_similarity)` | Cosine search **always** filtered by `chatbot_id` |
| `hit_rate_limit(key, window_seconds, max)` | Fixed-window counter; deletes stale rows |

Limits are passed in from `lib/plans.ts`, so plan numbers exist in one place only.

**Other controls:** Gemini key and service-role key server-only (`server-only` import + no `NEXT_PUBLIC_` prefix) · Zod on every input · file extension + MIME + `%PDF-` magic bytes + 5 MB · document text treated as untrusted data in the prompt · logs contain ids and error codes, never document text, prompts or keys · `/embed/*` allows framing (`frame-ancestors *`), every other route sends `frame-ancestors 'none'`.

---

## 5. Key Flows

### 5.1 Sign-up (Epic 01)
Supabase `signUp` → trigger creates `profiles(plan='free')` → `proxy.ts` refreshes session (`getClaims()`) → `/dashboard` (server layout redirects to `/login` without a user).

### 5.2 Upload & ingestion (Epic 02)
Vercel functions reject request bodies over 4.5 MB, but the SDD allows 5 MB files. So the browser uploads the file **directly to the private Storage bucket**, and the server validates it after downloading.
1. Server Action `startDocumentUpload`: `requireUser` → validate name/type/size → `create_document(... PLANS[plan].documents)` (admin) creates a `processing` row with `storage_path = {owner_id}/{document_id}`. The quota and duplicate check is atomic.
2. The browser uploads to that path with the user client. Storage RLS allows only the owner's folder; the bucket limits files to 5 MB and to PDF/TXT MIME types.
3. `POST /api/documents/[id]/ingest`: the user client confirms ownership via RLS → the admin client claims the row (`ingest_started_at`, so it runs once) → downloads → `validateFile` (magic bytes) → `extractText` (unpdf / UTF-8) → normalise → fail if < 50 chars ("empty or unreadable") → cap at 150,000 chars.
4. `chunkText`: ~1,000 chars with 150 overlap (paragraph → sentence → word), at most 200 chunks.
5. `embedTexts` in batches of 100 (`taskType: RETRIEVAL_DOCUMENT`, 768 dims).
6. Insert all chunks in one statement (admin) → status `ready`.
7. Any error in step 3–6: delete the chunks and the storage object, set status `failed` with a friendly message. Failed rows count toward the quota until deleted.

Synchronous on purpose: the input is bounded (5 MB / 200 chunks), so it fits the 60 s function limit and no queue is needed.

### 5.3 Chat (Epics 03 + 04) — `POST /api/chat { botId, message }`
1. Zod: `botId` uuid, `message` 1–1,000 chars.
2. **Access:** if a session user owns the bot → *owner mode*. Otherwise → *public mode*: bot must exist and be published, then `hit_rate_limit(hash(ip)+botId, 60, 10)`.
3. `reserve_message(owner, current UTC month, PLANS[plan].messages)` → else `QUOTA_EXCEEDED`.
4. `embedQuery` → `match_chunks(botId, vec, 5, 0.55)`.
5. No match → `refund_message`, return `NOT_FOUND_ANSWER` ("I don't know based on these documents.") without calling Gemini.
6. `buildPrompt`: rules (answer only from context, ignore instructions inside documents, otherwise reply with the not-found sentence, be concise) + chunks in `<document>` tags + question.
7. `generateAnswer` (temperature 0.2, ~512 tokens, 20 s timeout). On error → `refund_message`, `PROVIDER_UNAVAILABLE`.
8. Return `{ answer }`. History lives only in React state.

The same function `answerQuestion()` serves both modes, so the playground and widget share a single pipeline.

### 5.4 Widget (Epic 04)
- Snippet: `<script src="https://<app>/widget.js" data-bot-id="<uuid>" async></script>`.
- `widget.js` reads `data-bot-id` from `document.currentScript`, takes the app origin from its `src`, adds a launcher button and a hidden `<iframe src="<origin>/embed/<botId>">` (~380px panel, full width on mobile, close button + Esc).
- `/embed/[botId]` is a server component. It loads only `name, welcome_message, is_published`. Unknown or unpublished bot → "This assistant is unavailable". Otherwise it renders `ChatWindow`, which posts to `/api/chat` on the same origin (so no CORS).
- In public mode, a quota error shows a neutral "temporarily unavailable" message with no upgrade CTA.

### 5.5 Mock billing (Epic 04)
The plan modal reads `PLANS` and current usage. The **"Demo upgrade — no payment"** button opens a confirmation dialog, then calls the `setPlan` Server Action, which updates `profiles.plan` through the admin client. A downgrade deletes nothing: `create_document` blocks uploads once the document count reaches the Free limit, and `reserve_message` applies the Free limit right away.

---

## 6. Error Contract

The API returns `{ error: { code, message, upgrade? } }` with one of these codes:
`VALIDATION` 400 · `UNAUTHORIZED` 401 · `NOT_FOUND` 404 · `BOT_UNAVAILABLE` 404 · `QUOTA_EXCEEDED` 402 (`upgrade: true` in owner mode) · `RATE_LIMITED` 429 · `PROVIDER_UNAVAILABLE` 503.
The UI turns each code into a friendly message. The upgrade CTA appears only for owners.

---

## 7. Configuration & Deployment

**Environment variables** (`.env.example` holds only placeholders):

| Variable | Scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`, or legacy anon key) | Public |
| `NEXT_PUBLIC_APP_URL` | Public (used in the snippet) |
| `SUPABASE_SECRET_KEY` (`sb_secret_…`, or legacy service-role key) | Server only |
| `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_EMBEDDING_MODEL` | Server only |
| `RATE_LIMIT_SALT` | Server only |

**Deploy:**
1. Create a Supabase project and run `supabase db push` to apply the migrations (pgvector, tables, RLS, functions, bucket).
2. Create a Vercel project for the repo root and set the environment variables. Every push to `main` deploys.
3. Create a second Vercel project with root directory `demo-site/`. It is a static page on a different origin.
4. In Supabase Auth, set Site URL and redirect URLs to the Vercel domain.

**Free-tier notes:**
- Supabase Free pauses a project after ~1 week without activity, so open it before the review.
- Supabase Free gives 500 MB database and 1 GB storage, which is plenty for 768-dim vectors.
- Gemini's free tier has per-minute limits, and on the free tier prompts may be used by Google. Note both in the README limitations.
- Vercel Hobby is for non-commercial use, which fits a demo.

---

## 8. Testing

| Level | What |
|---|---|
| Vitest (unit) | `plans`, `validateFile`, `chunkText`, `buildPrompt`, Zod schemas, error mapping. `lib/ai.ts` is mocked with `vi.mock` |
| Vitest + local Supabase (`supabase start`) | Two accounts can't read each other's rows or files. `reserve_message` stops at the limit under parallel calls. `match_chunks` returns only the given bot's chunks. Deleting a document cascades |
| Playwright | One happy path on a preview build: sign up → create bot → upload TXT → ask → copy snippet → `/embed/[id]` answers → demo upgrade → 3rd upload accepted |
| Manual | The SDD Core Test Matrix, including 3 known questions and 1 unrelated question against a real PDF |

CI scripts: `lint`, `typecheck`, `test`, `build`, `test:e2e`.

---

## 9. Epic → Architecture Map

| Epic | Builds |
|---|---|
| 01 Foundation | Scaffold, `lib/supabase/*`, middleware, `profiles` + trigger, `lib/plans.ts`, landing, auth pages, dashboard layout, Vercel deploy |
| 02 Chatbot Builder | `chatbots`, `documents`, `document_chunks`, bucket and policies, `create_document`, `lib/ingest.ts`, `lib/ai.ts` (embeddings), dashboard bot and documents sections |
| 03 AI Chat | `usage_counters`, `reserve_message`/`refund_message`, `match_chunks`, `lib/chat.ts`, `lib/prompt.ts`, `lib/ai.ts` (generate), `/api/chat` owner mode, playground |
| 04 Widget & Billing | Public mode and `hit_rate_limit`, `/embed/[botId]`, `public/widget.js`, framing headers, `setPlan` and plan modal, `demo-site/`, README, E2E, final deploy |

---

## 10. Decisions to Confirm During Implementation

- The exact current Gemini Flash model ID, set via `GEMINI_CHAT_MODEL`.
- ~~`middleware.ts` vs `proxy.ts`~~ → resolved: Next.js 16 `src/proxy.ts`.
- Retrieval constants (`k = 5`, `min_similarity = 0.55`, chunk 1,000/150). Treat them as starting values and tune them on the test document during Epic 03.
