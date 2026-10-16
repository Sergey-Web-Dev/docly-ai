# Epic 04 — Public Widget, Mock Billing, Release Implementation Plan

**Task:** TASK-001 · **Epic:** `docs/epics/epic-04-widget-billing.md` · **Branch:** `feature/epic-04-widget-billing` (from `feature/epic-03-ai-chat`; PR #1 into `main` is open)

> **For Claude:** `coder` does Tasks 2–4 and 9; `coder-frontend` does Tasks 5–8 and 10–11. Task 1 (SQL) is applied by the orchestrator. Pitfalls already met in this project: new functions get PUBLIC `EXECUTE` by default (the orchestrator revokes it right away with `execute_sql`), and Supabase MCP declines `DROP`/`REVOKE` inside `apply_migration`.

**Goal:** The owner publishes the bot and copies one `<script>` tag. On any website a floating launcher opens an iframe chat that uses the **same** `/api/chat` pipeline. Visitors are rate-limited per IP and bot, and their messages count against the owner's monthly quota. A Free/Pro page offers "Demo upgrade — no payment" and changes the limits the server enforces. Then the release: demo site, README, walkthrough, deploy.

**Architecture:** `docs/architecture.md` §5.3–§5.5, §7.

```text
Host page ──<script src="{APP}/widget.js" data-bot-id>──► launcher + <iframe src="{APP}/embed/{botId}">
/embed/[botId] (server): admin reads {name, welcome_message, is_published} → unavailable card | <ChatWindow mode="public">
POST /api/chat → resolveChatAccess:
   session user owns bot → owner mode (works unpublished)
   otherwise            → resolvePublicAccess: admin reads bot (must be published) + owner plan → hit_rate_limit(hash(ip)+bot, 60 s, 10)
→ answerQuestion (unchanged; public mode: neutral quota message, usage null)
/dashboard/billing → setPlan('free'|'pro') server action → admin update profiles.plan WHERE id = session user
```

**Conventions:** run npm with `unset NODE_ENV;`; never read or print `.env*`; check library APIs with Context7; use TDD for pure logic; commit per task with trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; the orchestrator pushes.

---

### Task 1: Migration — rate limits, publish grant **[orchestrator]**

**File:** `supabase/migrations/20261016000007_widget.sql`

```sql
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
-- no client access at all

-- Fixed-window limiter. Returns true when the call is allowed.
create function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  if p_key is null or length(p_key) > 200 or p_window_seconds is null or p_window_seconds < 1 or p_max is null or p_max < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;

  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 hour';
  end if;

  return v_count <= p_max;
end;
$$;

grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- Owners may publish/unpublish their own bot (RLS "chatbots: owner updates" already scopes rows).
grant update (is_published) on public.chatbots to authenticated;
```

**[orchestrator]**
1. Apply the migration.
2. Run `execute_sql`: `revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated; revoke all on public.rate_limits from anon, authenticated;`
3. Verify with `has_function_privilege` and the column privileges, then run `get_advisors`.
4. Update the types by hand and append the revokes to the file.

---

### Task 2: Client key + public access — TDD

**Files:** Create `src/lib/client-key.ts` (+ test) · Modify `src/lib/chat-access.ts` (+ test), `src/lib/chatbots.ts`, `src/lib/rag-config.ts`, `src/app/api/chat/route.ts`

```ts
// rag-config.ts
export const PUBLIC_RATE_LIMIT = { windowSeconds: 60, max: 10 } as const;
```

```ts
// client-key.ts — hashed, never stores raw IPs
import 'server-only';
import { createHash } from 'node:crypto';
import { serverEnv } from '@/lib/env-server';

export function clientIp(headers: Headers): string {
  const candidate = headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip') ?? headers.get('x-forwarded-for') ?? '';
  return candidate.split(',')[0]?.trim() || 'unknown';
}

export function rateLimitKey(headers: Headers, botId: string): string {
  const digest = createHash('sha256').update(`${clientIp(headers)}|${serverEnv('RATE_LIMIT_SALT')}`).digest('hex').slice(0, 32);
  return `chat:${botId}:${digest}`;
}
```

`resolveChatAccess(botId, headers)`:
- If a session user owns the bot, use **owner mode**, exactly as today.
- Otherwise call `resolvePublicAccess(botId, headers)` (signed-out visitors and signed-in non-owners alike):
  1. `createAdminClient()` → `select id, owner_id, is_published from chatbots where id = botId`. If the bot is missing or `!is_published`, throw `AppError('BOT_UNAVAILABLE', 'This assistant is unavailable.')`.
  2. Read `profiles.plan` for `owner_id` with the admin client and log any error. A failed read must throw, not silently fall back to Free.
  3. `admin.rpc('hit_rate_limit', { p_key: rateLimitKey(headers, botId), p_window_seconds, p_max })`. If it returns false, throw `AppError('RATE_LIMITED', 'Too many messages. Please wait a minute and try again.')`.
  4. Return `{ chatbotId: bot.id, ownerId: bot.owner_id, plan, mode: 'public' }`.

The route passes `request.headers`. Remove the Epic 04 TODOs.

**Tests:**
- `clientIp` header precedence and the `unknown` fallback.
- `rateLimitKey` contains no raw IP and is stable.
- Unknown bot → BOT_UNAVAILABLE; unpublished bot → BOT_UNAVAILABLE.
- Published bot → public target whose plan comes from the **owner** profile.
- Signed-out → public; signed-in non-owner → public; owner of an unpublished bot → owner mode.
- Rate limit false → RATE_LIMITED. The RPC error → PROVIDER_UNAVAILABLE.

**Commit:** `feat(widget): add public chat access with hashed per-IP rate limit`

---

### Task 3: Publish + plan server actions — TDD for schemas

**Files:** Modify `src/app/dashboard/actions.ts`, `src/lib/schemas.ts` (+ tests) · Create `src/lib/billing.ts`

- `setPublished(isPublished: boolean)`: call `requireUser()`, parse with `z.boolean()`, then use the user client: `.update({ is_published }).eq('owner_id', user.id).select('id')`. If no row comes back, return "Create your bot first." Finish with `revalidatePath('/dashboard')`.
- `setPlan(planId)`: call `requireUser()`, parse with `z.enum(['free', 'pro'])`, then `billing.changePlan(createAdminClient(), user.id, planId)`. That runs `update profiles set plan where id = userId`, and an error throws. Finish with `revalidatePath('/dashboard', 'layout')`. It returns `{ ok: true, plan }` or `{ ok: false, error }`.
- `getBillingSummary(supabase, userId)` lives in `billing.ts`. It returns `{ plan, documents: { used, limit }, messages: { used, limit }, isOverDocumentLimit }` using the existing `listDocuments`, `getMonthlyUsage` and `getOwnPlan`.

**Commit:** `feat(billing): add publish toggle and demo plan change actions`

---

### Task 4: Integration tests (no Gemini)

**File:** `tests/integration/widget-billing.test.ts`
1. `hit_rate_limit(key, 60, 3)` returns true, true, true, false. A different key is independent. Invalid args raise `22023`.
2. `hit_rate_limit` is not callable from an authenticated client, and `rate_limits` is not readable from one.
3. Alice can set `is_published` on her own bot. Bob's update of Alice's bot affects 0 rows. Alice still cannot set `accent_color` or `owner_id`, and cannot update `profiles.plan`.
4. After `changePlan` (admin) to pro, `create_document` with the Pro limit accepts a 3rd document. After a downgrade, nothing is deleted and `create_document` with the Free limit raises `DQ001`.
5. `reserve_message` with the Free limit fails once the counter reaches 30, even if the counter was set while on Pro (downgrade).

**Commit:** `test(db): cover rate limiter, publish grant and plan changes`

---

### Task 5: Security headers + embed page

**Files:** Modify `next.config.ts` · Create `src/app/embed/[botId]/page.tsx`, `src/app/embed/[botId]/embed-chat.tsx` (client)

```ts
// next.config.ts
async headers() {
  return [
    { source: '/embed/:path*', headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }] },
    { source: '/((?!embed/).*)', headers: [
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] },
    { source: '/widget.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }] },
  ];
},
```

Verify with `curl -I` that `/dashboard` sends DENY and `/embed/x` does not.

The embed page is a server component with `export const dynamic = 'force-dynamic'`:
- Validate the uuid, then read `name, welcome_message, is_published` with the admin client.
- If the bot is missing or unpublished, show a centered card: "This assistant is unavailable" / "Please check back later."
- Otherwise render a full-height layout: a header with the bot name and a close button (`aria-label="Close chat"`) that calls `window.parent.postMessage({ type: 'docly:close' }, '*')`, then `<ChatWindow mode="public" …>` filling the rest.
- The page has no site header or footer, has a transparent-safe background, and adds `<meta name="robots" content="noindex">`.

**Commit:** `feat(widget): add embeddable chat page and framing headers`

---

### Task 6: `public/widget.js` loader

**File:** Create `public/widget.js` (vanilla ES2017, no build, < 4 KB, IIFE, `'use strict'`)

```js
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || window.__doclyWidgetLoaded) return;
  var botId = script.getAttribute('data-bot-id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(botId)) { console.warn('[docly] invalid data-bot-id'); return; }
  window.__doclyWidgetLoaded = true;
  var origin = new URL(script.src).origin;
  // … build launcher button (fixed bottom-right, 56px circle, aria-label "Open chat", aria-expanded),
  // panel div (fixed, 380×600 desktop, max-height calc(100vh - 100px); ≤ 480px viewport → inset 0, full screen),
  // create <iframe title="Chat with {bot}" src="{origin}/embed/{botId}" allow="clipboard-write"> lazily on first open,
  // toggle on click, close on Escape (host page) and on window 'message' { type: 'docly:close' } when event.origin === origin,
  // return focus to the launcher on close; all styles inline with high z-index (2147483000) and `all: initial` on the root.
})();
```

The finished file must also:
- set the launcher accent color to indigo `#4f46e5` with a chat-bubble SVG icon, and switch to a close icon while open;
- add no globals besides the guard flag;
- read nothing from the host page.

**Commit:** `feat(widget): add embeddable launcher script`

---

### Task 7: Dashboard embed panel

**Files:** Create `src/components/dashboard/embed-panel.tsx` · Modify `src/app/dashboard/page.tsx`

A new card titled "Embed on your website" (`as="h2"`):
- **Published switch.** Use a labelled checkbox or switch, "Published — visitors can chat with this bot", that calls `setPublished` and shows a pending state.
- **Snippet.** Show it in a read-only `<pre><code>`: `<script src="{APP_ORIGIN}/widget.js" data-bot-id="{bot.id}" async></script>`. Take `APP_ORIGIN` from `NEXT_PUBLIC_APP_URL`, falling back to the request `host`/`x-forwarded-proto` via `headers()`.
- **Copy button.** It uses `navigator.clipboard.writeText` and shows "Copied" for 2 s. If the clipboard is unavailable, select the text.
- **Hints.** While unpublished, show "Unpublished: visitors will see 'This assistant is unavailable'." Also add a "Preview widget" link to `/embed/{bot.id}` (new tab).

**Commit:** `feat(dashboard): add publish toggle and embed snippet`

---

### Task 8: Billing page (SDD screen 5)

**Files:** Create `src/app/dashboard/billing/page.tsx`, `src/components/billing/plan-actions.tsx` · Modify `src/app/dashboard/layout.tsx` (the header plan badge links to `/dashboard/billing`; add a "Plan" nav link), `src/components/dashboard/documents-panel.tsx` and `src/components/chat/chat-window.tsx` (owner-mode upgrade links → `/dashboard/billing`)

The page:
- **Header and notice.** The title is "Plan & billing". Show an info callout: "Billing is simulated for this demo. No payment details are collected and no money is charged."
- **Usage block.** Show documents `used / limit` and messages this month `used / limit`. If over the document limit after a downgrade, show "You have {n} documents; the Free plan allows {limit}. Existing documents keep working, but new uploads are blocked until you delete {n-limit}."
- **Plan cards.** Reuse `PricingCards` with `renderAction`:
  - current plan → a disabled "Current plan" button;
  - Pro while on Free → **"Demo upgrade — no payment"**;
  - Free while on Pro → "Downgrade to Free".
- **Confirmation.** Each action button opens an inline confirm step ("Switch to Pro? This is a demo — nothing is charged." with Confirm/Cancel) and then calls `setPlan`. On success show a toast or notice and refresh.
- Nothing collects card data.

**Commit:** `feat(billing): add demo plan page`

---

### Task 9: README, demo site, architecture sync

**Files:** Create `demo-site/index.html` · Rewrite `README.md` · Update `docs/architecture.md`

- **`demo-site/index.html`:**
  - A small static "Acme Robotics" page: hero, a few paragraphs, a footer, no frameworks.
  - At the bottom, the real snippet with placeholders: `<script src="https://YOUR-APP.vercel.app/widget.js" data-bot-id="YOUR_BOT_ID" async></script>`.
  - A tiny inline script supports `?app=…&bot=…`. When both are present, it injects the widget script with those values instead, so reviewers can test any deployment without editing the file.
  - A comment explains how to serve it on another origin (`python3 -m http.server 4000 -d demo-site`) and how to deploy it as a second Vercel project or on GitHub Pages.
- **`README.md` sections:**
  - what it is, the demo journey and live links (placeholders until deploy);
  - architecture summary with a diagram from `docs/architecture.md`;
  - tech stack;
  - environment variables table (from `.env.example`, no values);
  - local setup (Node 20+, `npm install`, `.env.local`, Supabase project, applying `supabase/migrations/*.sql` in order, "Confirm email" off);
  - scripts and tests;
  - the embed instructions;
  - deployment (Vercel + Supabase Auth URL configuration + demo site);
  - limitations (no OCR/DOCX, no streaming/citations/history, simulated billing, Gemini free-tier rate limits, Supabase free project pauses after inactivity, synchronous ingestion ≤ 5 MB);
  - security notes.
- **`docs/architecture.md`:** §5.4 and §5.5 match the implementation (billing page instead of modal, headers, rate-limit key, close via postMessage).

**Commit:** `docs: add README, demo site and sync architecture`

---

### Task 10: E2E — widget, billing, headers (desktop; real Gemini only for one widget answer)

**File:** `e2e/widget-billing.spec.ts` (reuse `signUpFresh`, `setMonthlyUsage`, fixtures)

1. **Headers.** `request.get('/dashboard')` returns `x-frame-options: DENY`. `request.get('/embed/<random uuid>')` has a CSP `frame-ancestors *` and no `x-frame-options`.
2. **Unknown bot.** `/embed/<random uuid>` shows "This assistant is unavailable".
3. **Widget on another origin.**
   - Sign up, create the bot, upload the handbook, wait for Ready.
   - The embed card shows "Unpublished". Turn Published on, then read the snippet text.
   - Use `page.route('http://acme-demo.test/**', …)` to fulfill a demo HTML page that contains that snippet.
   - Open the demo page in a **new browser context**, so it has no owner cookies. The launcher is visible; click it and the iframe appears.
   - Through `frameLocator`, see the welcome message, then ask "How many vacation days do new hires get?". The answer contains `20`.
   - Close the panel with the close button; the panel is hidden.
4. **Unpublish.** Unpublish in the owner context and reload the demo page. Opening the launcher shows "This assistant is unavailable".
5. **Billing.**
   - `/dashboard/billing` shows the simulated-billing notice and "Demo upgrade — no payment".
   - Confirm the upgrade: the badge shows "Pro plan" and documents read `x / 10`. Uploading `notes.txt` and a 3rd generated file succeeds.
   - Downgrade: documents are kept, the over-limit notice appears, and a new upload is rejected with the quota message.
6. **Public quota.** Call `setMonthlyUsage(email, 30)` on Free, then send a widget message (with the bot published again). The neutral "temporarily unavailable" message appears with no upgrade link.

Set `retries: 1` for this spec (the Gemini latency spikes we saw).

**Commit:** `test(e2e): cover widget on another origin, unpublish, billing and headers`

---

### Task 11: Illustrated walkthrough (deliverable instead of video)

**Files:** `e2e/walkthrough.spec.ts` (runs only when `WALKTHROUGH=1`; skipped otherwise), `docs/walkthrough.md`, `docs/walkthrough/*.png`

The spec runs the full SDD demo journey on desktop at 1280×800 and saves numbered screenshots: landing → sign up → create bot → upload → Ready → chat answer → embed snippet → demo site with an open widget answering → billing → after upgrade. `docs/walkthrough.md` embeds them in order, with a 1–2 sentence caption for each.

**Commit:** `docs: add illustrated walkthrough`

---

### Task 12: Deploy **[user-assisted]**

1. Merge order: PR #1 (Epic 03) → `main`, then a PR for this branch → `main`.
2. **The user** imports `Sergey-Web-Dev/docly-ai` in the Vercel dashboard and sets the env vars: public Supabase URL and key, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL=gemini-3.5-flash-lite`, `GEMINI_EMBEDDING_MODEL=gemini-embedding-001`, `RATE_LIMIT_SALT`, `NEXT_PUBLIC_APP_URL=https://<app>.vercel.app`.
3. Set Supabase Auth → URL Configuration to the Vercel domain.
4. Deploy the demo site as a second Vercel project (root `demo-site/`), or on GitHub Pages.
5. Smoke test on production in the built-in browser: the full journey, the widget on the demo-site origin, upgrade.
6. Put the live links in the README.

---

## Epic 04 Exit Checklist

- [ ] AC-04.01.1–3 publish toggle, snippet and copy, owner-only (E2E 3, integration 3)
- [ ] AC-04.02.1–5 launcher on another origin, iframe panel, responsive, keyboard and close, same pipeline, loading and errors (E2E 3, browser check at 375/1280)
- [ ] AC-04.03.1–5 unavailable states, no private data, bot id not a management credential, rate limit, quota for visitors (unit Task 2, integration 1–3, E2E 2, 4, 6)
- [ ] AC-04.04.1–6 plans from `PLANS`, confirm, demo labels, Pro limits after upgrade, downgrade keeps data, server-only plan change (E2E 5, integration 3–5)
- [ ] AC-04.05.1–7 deploy, README, `.env.example`, all checks, cross-account test, core test matrix, walkthrough
