# Docly AI

Your docs. Instant answers. Upload company documents (PDF or TXT), ask questions in a chat, and embed the same assistant on any website with one `<script>` tag.

- **Live app:** `<APP_URL>`
- **Demo site with the widget embedded (different origin):** `<DEMO_URL>`
- Walkthrough with screenshots: [`docs/walkthrough.md`](docs/walkthrough.md)

## Demo journey

1. Open `<APP_URL>` and sign up with email and password (the account is signed in immediately).
2. Create your bot (name and welcome message).
3. Upload a PDF or TXT file and wait for the status **Ready**.
4. Ask a question in the dashboard chat. Answers come only from your documents; anything else gets "I don't know based on these documents."
5. Switch **Published** on and copy the embed snippet.
6. Open the demo site with your bot: `<DEMO_URL>/?app=<APP_URL>&bot=<BOT_ID>`. Click the launcher and ask the same question as a visitor.
7. Open **Plan** (`/dashboard/billing`) and press **Demo upgrade, no payment**. Limits change immediately (2 to 10 documents, 30 to 300 messages per month).

Billing is simulated. No payment details are collected and no money is charged.

## Architecture

One Next.js app, one Supabase database, one AI pipeline. The dashboard chat and the public widget call the same `POST /api/chat` and the same `answerQuestion()` function. Details: [`docs/architecture.md`](docs/architecture.md).

```text
Owner browser ──► Next.js (Vercel)  ── Server Actions / API routes ──► Supabase (Auth, Postgres + pgvector, Storage)
                       │                                          └──► Google Gemini (embeddings + answers)
                       │
External site ─► <script src="<APP_URL>/widget.js" data-bot-id="..."> ─► launcher + <iframe src="<APP_URL>/embed/<botId>">
                                                                             └─► POST /api/chat (same origin as the app)

POST /api/chat
  session user owns the bot  -> owner mode   (works unpublished)
  anyone else                -> public mode  (bot must be published; per-IP, per-hour and per-bot rate limits;
                                              messages count against the OWNER's monthly quota)
  -> reserve_message (atomic quota) -> embed question -> match_chunks (always filtered by bot id)
  -> Gemini answers only from the retrieved chunks (or says it does not know) -> refund on failure
```

Multi-tenant security lives in the database (RLS on every table plus a few SQL functions that only the server's service role can call) and in thin server checks. See [Security notes](#security-notes).

## Tech stack

- Next.js 16 (App Router) and TypeScript, Node runtime
- Tailwind CSS 4, shadcn/ui (base-nova), Lucide icons
- Supabase: Auth (email and password via `@supabase/ssr`), Postgres with `pgvector` and RLS, private Storage bucket
- Google Gemini through `@google/genai`: `gemini-embedding-001` (768 dimensions) for retrieval, `gemini-3.5-flash-lite` for answers
- `unpdf` for PDF text extraction, Zod for validation
- Vitest (unit and integration) and Playwright (E2E)

### Why `gemini-3.5-flash-lite`

The chat model is set by `GEMINI_CHAT_MODEL`. On the free tier the larger `gemini-3.8-flash` hit quota limits and frequent `503` (overloaded) responses during testing. The Flash-Lite model answers in about 5 seconds, has a much more forgiving free-tier quota and is still good enough for answers grounded in retrieved text. Only `429` and `503` are retried (once, within a 25 second request budget). You can switch models by changing the variable, no code change needed.

## Environment variables

Copy `.env.example` to `.env.local` and fill in the values. Never commit `.env.local`.

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | Supabase publishable key (`sb_publishable_...`, or the legacy anon key) |
| `NEXT_PUBLIC_APP_URL` | Public | Public origin of this app, used in the embed snippet (for example `http://localhost:3000`) |
| `SUPABASE_SECRET_KEY` | Server only | Supabase secret key (`sb_secret_...`, or the legacy service-role key) |
| `GEMINI_API_KEY` | Server only | Google AI Studio API key |
| `GEMINI_CHAT_MODEL` | Server only | Answer model, `gemini-3.5-flash-lite` |
| `GEMINI_EMBEDDING_MODEL` | Server only | Embedding model, `gemini-embedding-001` |
| `RATE_LIMIT_SALT` | Server only | Random secret mixed into the hashed visitor IP used as the rate-limit key. Generate one, for example with `openssl rand -hex 32` |

## Local setup

Requirements: Node 20 or newer, a free Supabase project and a Gemini API key.

```bash
npm install
cp .env.example .env.local   # fill in the values from the table above
npm run dev
```

Open http://localhost:3000.

### Supabase

1. Create a Supabase project.
2. Apply every file in `supabase/migrations/` in filename order, either with `supabase db push` or by running them in the SQL editor:

   | Migration | Adds |
   |---|---|
   | `20261016000001_profiles.sql` | `profiles` table, plan column and sign-up trigger |
   | `20261016000002_profiles_grants.sql` | Grants: clients can only read their own profile, never change the plan |
   | `20261016000003_chatbots_documents.sql` | `chatbots`, `documents`, `document_chunks`, `pgvector`, Storage bucket and policies, `create_document` |
   | `20261016000004_ingestion_hardening.sql` | Narrower column grants, `updated_at` trigger, hardened `create_document`, atomic `complete_document` |
   | `20261016000005_chat.sql` | `usage_counters`, `reserve_message`, `refund_message`, `match_chunks` |
   | `20261016000006_chat_hardening.sql` | `reserve_message` returns the reserved month, `refund_message` takes it, `match_chunks` runs as invoker |
   | `20261016000007_widget.sql` | `rate_limits`, `hit_rate_limit`, owner grant to publish and unpublish a bot |

3. In the Supabase dashboard open Authentication, Providers, Email and turn **Confirm email off**. Sign-up signs the user in immediately and relies on this.

## Scripts and tests

```bash
npm run dev               # development server
npm run build             # production build
npm start                 # serve the production build
npm run lint
npm run typecheck
npm test                  # unit tests (Vitest, no network)
npm run test:integration  # database tests against your Supabase project (needs SUPABASE_SECRET_KEY)
npm run test:e2e          # Playwright against http://localhost:3000 (starts `npm run dev`)
```

- Unit tests mock Gemini and Supabase. Tests that touch the rate limiter set their own `RATE_LIMIT_SALT`.
- Integration tests create throwaway users in your Supabase project and check RLS, cross-account denial, the quota functions, the rate limiter and plan changes. They never call Gemini.
- E2E tests use the real Gemini API for the few steps that need an answer, so they need a valid `GEMINI_API_KEY` and free-tier quota.

## Embed the widget

1. In the dashboard open **Embed on your website**, switch **Published** on and copy the snippet:

   ```html
   <script src="<APP_URL>/widget.js" data-bot-id="<BOT_ID>" async></script>
   ```

2. Paste it before `</body>` on any page. A launcher appears in the bottom-right corner and opens a chat panel (full screen on phones). Escape or the close button closes it.
3. While unpublished, visitors see "This assistant is unavailable". The bot id is only a public identifier; it gives no access to settings, documents or any other bot.

`demo-site/index.html` is a small static page ("Acme Robotics") that embeds the widget, meant to be served from a different origin than the app:

```bash
python3 -m http.server 4000 -d demo-site
# then open (replace the bot id)
# http://localhost:4000/?app=http://localhost:3000&bot=<BOT_ID>
```

With the `app` and `bot` query parameters the page injects the widget script for that deployment. `app` must be `http://localhost:<port>`, `http://127.0.0.1:<port>` or an origin listed in the `ALLOWED_APP_ORIGINS` array at the top of the page script (add your deployed app origin there); anything else is rejected with a message. Without them it shows the placeholder snippet only.

## Deployment

1. **Supabase:** create the project, apply the migrations and turn Confirm email off (see above).
2. **Vercel (app):** import the repository, keep the root directory, and set all variables from the table. `NEXT_PUBLIC_APP_URL` is the Vercel domain (`https://<app>.vercel.app`). Every push to `main` deploys.
3. **Supabase Auth URL configuration:** set Site URL and the redirect URLs to the Vercel domain.
4. **Vercel (demo site):** create a second project from the same repository with **Root Directory** `demo-site/` and no build command. It is static and lives on a different origin, which proves the widget works on third-party sites. GitHub Pages works too. Open `<DEMO_URL>/?app=<APP_URL>&bot=<BOT_ID>`, or edit the commented snippet in `demo-site/index.html`.
5. Smoke test: sign up, create a bot, upload a file, ask, publish, chat from the demo site, upgrade.

## Limitations

- Only text-based PDF and TXT files, up to 5 MB. No OCR for scanned PDFs and no DOCX.
- Ingestion is synchronous (at most 5 MB, 200 chunks, 60 second function limit), with no queue.
- No streaming answers, no source citations and no saved chat history. The conversation lives in the browser tab only.
- One bot per account.
- Billing is simulated: the Free/Pro switch changes the enforced limits but collects no payment. A downgrade deletes nothing; new uploads are blocked until the document count is below the Free limit.
- Gemini free tier has per-minute and per-day rate limits (answers can fail with a friendly "temporarily unavailable" message), and on the free tier Google may use prompts to improve its products. Do not upload confidential documents to a free-tier key.
- A Supabase free project pauses after about a week of inactivity. Open the dashboard to wake it before a review.
- Public rate limits, all per bot: 10 messages per minute per visitor, 20 per hour per visitor, and 30 per minute across all visitors. Visitors share the owner's monthly quota (Free 30, Pro 300).
- Rate limiting is only reliable behind Vercel. The visitor IP comes from headers that only Vercel's edge sets trustworthily (`x-vercel-forwarded-for`, `x-real-ip`); anywhere else (local dev, other hosts) the right-most `x-forwarded-for` hop or `x-real-ip` is used, and if neither exists all visitors share one `unknown` bucket (logged once). Do not rely on the limiter for abuse protection outside Vercel.
- The limits use fixed windows, so a burst straddling a window boundary can briefly reach up to twice the limit.
- On localhost the demo page (`:4000`) and the app (`:3000`) are different origins but the same site, so a signed-in owner's session cookie is sent and the widget chats in owner mode (works unpublished, no rate limit). Use a private window to test public mode.

## Security notes

- **RLS everywhere.** Owners only see their own profile, bot and documents. `document_chunks`, `usage_counters` writes and `rate_limits` have no client access at all.
- **Privileged functions are server-only.** `create_document`, `complete_document`, `reserve_message`, `refund_message`, `match_chunks` and `hit_rate_limit` have `EXECUTE` granted to `service_role` only (browsers cannot call them). Plan limits are passed in from `src/lib/plans.ts`.
- **The plan cannot be self-edited.** Clients have no UPDATE on `profiles`; `setPlan` writes it with the admin client for the session user only.
- **Public mode never trusts the session.** Owner and plan come from the bot row and the owner's profile. Unknown and unpublished bots return the same "unavailable" answer.
- **No raw IPs are stored.** The per-visitor rate-limit keys are `chat:<botId>:<ipHash>` (minute) and `chat:<botId>:<ipHash>:h` (hour), where `ipHash` is `sha256(ip + "|" + RATE_LIMIT_SALT)` truncated to 32 hex characters. The per-bot key is `chat:<botId>`. IPv6 addresses are reduced to their /64 prefix before hashing and IPv4-mapped IPv6 is treated as IPv4.
- **Header trust.** Client IP headers are trusted only when `VERCEL` is set (see Limitations). A missing `RATE_LIMIT_SALT` fails public chat closed with a logged error.
- **Demo-site allowlist.** `demo-site/index.html` injects a script from the `app` query parameter, so it only accepts `http://localhost:<port>`, `http://127.0.0.1:<port>` and origins listed in `ALLOWED_APP_ORIGINS` at the top of its script (add your deployed app origin there) and a strict bot uuid.
- **Secrets stay on the server.** The Supabase secret key and the Gemini key are only read in server-only modules and have no `NEXT_PUBLIC_` prefix.
- **Framing.** `/embed/*` allows being framed from any site (`frame-ancestors *`); every other route sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- **Prompt injection.** Document text is placed in randomised delimiters with angle brackets escaped, and the model is told to treat it as data.
- **Logs contain ids and error codes only**, never document text, prompts or keys.
