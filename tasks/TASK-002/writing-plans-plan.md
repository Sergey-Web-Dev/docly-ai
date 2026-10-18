# UX Polish & Demo Checkout — Implementation Plan

**Task:** TASK-002 · **Branch:** `feature/ux-animations-demo-checkout` (from `main`)

> **For Claude:** Two independent tracks.
> - **Track A** (`coder-frontend`, separate worktree): animations.
> - **Track B** (`coder` + UI in the same agent, main checkout): demo checkout.
>
> Merge Track A into this branch afterwards, then browser check → review → verify → PR.

**Goal:**
1. An animated star field behind the whole app (not inside the embeddable widget).
2. An animated chat preview on the landing page.
3. A realistic **demo** Stripe-style checkout where the user types card details but no card data ever leaves the browser.

**Tech Stack:** existing (Next.js 16, Tailwind v4, shadcn base-nova). No new runtime dependencies: canvas plus CSS/React only.

---

## Track A — Animations

### A1. `StarfieldBackground` (client component, canvas)

**Files:** Create `src/components/starfield-background.tsx` (+ pure helpers `src/lib/starfield.ts` with unit tests). Modify `src/app/layout.tsx`, `src/app/globals.css`, and the page or section backgrounds that are currently opaque.

**Placement and rendering**
- One fixed, full-viewport `<canvas aria-hidden="true">` at `z-index: -1` (or `0`, with content above), `pointer-events: none`.
- Mounted in the root layout. It returns `null` on `/embed/*` (use `usePathname`), because the widget lives inside third-party sites.

**Star motion**
- Use ~120–220 stars depending on the viewport area, each with x, y, depth z, radius and twinkle phase.
- With no mouse input, the stars drift slowly (parallax by depth) and twinkle.
- **Cursor:** on `pointermove`, the field eases its parallax offset toward the cursor (stars lean and flow toward or away from the cursor, deeper stars moving less). Stars near the cursor gain a subtle pull and brighten.
- After ~2 s without movement, ease back to autonomous drift.

**Colour and readability**
- The app keeps its light theme: soft indigo and slate stars on the existing off-white background, with a very faint indigo radial glow.
- Pages and sections need transparent or translucent backgrounds so the field is visible. Cards and forms stay opaque (`bg-background` / `bg-white`) so text contrast stays at WCAG AA.
- Don't make the dashboard look busy: lower the star density and opacity on `/dashboard*` (prop or pathname check).

**Performance and accessibility**
- Use `requestAnimationFrame`, a devicePixelRatio-aware canvas capped at 2, and resize via `ResizeObserver` or a debounced resize.
- Pause when `document.hidden`.
- Under `prefers-reduced-motion: reduce`, draw a single static frame and attach no listeners.
- No layout shift and no CLS; keep paint under about 2 ms per frame on a laptop.

**Tests:** unit tests for the pure helpers: star generation is deterministic with a seed, the count scales with area, and the parallax offset is clamped.

**Commit:** `feat(ui): add animated star field background`

### A2. Animated hero chat preview

**Files:** Modify `src/components/landing/hero.tsx` · Create `src/components/landing/chat-preview.tsx` (client) and a small hook `src/lib/use-typewriter.ts` (or co-located).

**Loop** (pause between scenarios, ~10–12 s each):
1. The user bubble types its text character by character (~35 ms per character), with a blinking caret.
2. The AI bubble shows a "thinking" state: three animated dots plus "Searching employee-handbook.pdf…".
3. The AI answer types out, grounded in the document.

**Scenarios:**
- "How many vacation days do new hires get?" → "New hires get 20 vacation days in their first year, per the employee handbook."
- "Can I work remotely?" → "Yes — remote work is allowed on Tuesdays and Thursdays."
- "What's the support email?" → "You can reach support at help@acme.test."
- An unrelated question, "Who won the World Cup?" → "I don't know based on these documents."

**Behaviour rules**
- Keep the existing card styling. The container has a fixed height so there's no layout jump.
- It stays `aria-hidden` (decorative). Add a visually hidden static transcript for screen readers, or keep the static first exchange in an `sr-only` block.
- Under `prefers-reduced-motion`, show the first exchange statically.
- Pause when off-screen (IntersectionObserver) and when the tab is hidden.
- Clean up every timer on unmount.

**Tests:** unit tests for the typewriter or step scheduler as pure logic, where practical.

**Commit:** `feat(landing): animate the chat preview`

### A3. E2E smoke

Landing still passes the existing specs (H1 text, CTA, pricing, no horizontal scroll at 375 px). Add one check that the canvas exists on `/` and is absent on `/embed/<uuid>`, and that `prefers-reduced-motion` (Playwright `reducedMotion: 'reduce'`) shows the static preview text.

---

## Track B — Demo checkout (Stripe-style, test cards only)

**Product rule:** this deviates from SDD §4 "no card details are collected". The user decided card fields are typed in. To stay safe on a public demo:

- **Card data never leaves the browser.** The client "tokenizes" a Stripe **test** card into a Stripe-like token, and only the token is sent to the server.
- Test cards accepted:
  - `4242 4242 4242 4242` → `tok_visa` → success
  - `5555 5555 5555 4444` → `tok_mastercard` → success
  - `4000 0000 0000 0002` → `tok_chargeDeclined` → "Your card was declined."
  - `4000 0000 0000 9995` → `tok_chargeDeclinedInsufficientFunds` → "Your card has insufficient funds."
- Any other number, even a Luhn-valid one, is rejected client-side: "This is a demo checkout. Use a test card such as 4242 4242 4242 4242 — never enter a real card." Nothing is sent.
- Fields use `autocomplete="off"`, `name` attributes that browsers don't map to saved cards (`demo-card-number` and similar), `inputMode="numeric"` and `spellCheck={false}`. Fields are cleared after submit and on unmount. Nothing is logged and nothing is persisted (no localStorage).

### B1. Payment adapter (server) — TDD

**Files:** Create `src/lib/payments/payment-provider.ts` (interface), `src/lib/payments/mock-payment-provider.ts`, `src/lib/payments/get-payment-provider.ts`, plus tests.

```ts
export interface ChargeRequest { readonly token: string; readonly amountUsd: number; readonly description: string; readonly customerId: string }
export type ChargeResult =
  | { readonly ok: true; readonly chargeId: string }
  | { readonly ok: false; readonly code: 'card_declined' | 'insufficient_funds' | 'invalid_token'; readonly message: string };
export interface PaymentProvider { charge(request: ChargeRequest): Promise<ChargeResult> }
```

- The mock accepts only the known test tokens and returns `ch_demo_<random>`.
- It simulates ~1.2 s of processing (an injectable delay so tests run instantly).
- `getPaymentProvider()` returns the mock. A comment explains where real Stripe would plug in (`STRIPE_SECRET_KEY` + PaymentIntents) without adding the dependency.

### B2. Client-side test-card tokenizer — TDD

**File:** `src/lib/payments/demo-card.ts` (no `server-only`; pure).

- `normalizeCardNumber`, `formatCardNumber` (groups of 4), `detectBrand` (visa/mastercard/unknown), `luhnValid`.
- `validateExpiry(MM/YY)`: not in the past, month 1–12.
- `validateCvc`: 3 digits, or 4 for amex if it's ever detected.
- `tokenizeTestCard({ number, expiry, cvc, name })` → `{ ok: true, token, brand, last4 } | { ok: false, field, error }`. The non-test-card message is the one above.
- Tests cover every rule.

### B3. Checkout server action

**Files:** Modify `src/app/dashboard/actions.ts` (+ tests), `src/lib/schemas.ts`.

`completeDemoCheckout({ token })`:
1. Call `requireUser()`.
2. Parse with zod: `token` is one of the known token strings. Unknown input → "Invalid payment details."
3. If the owner is already Pro, return "You're already on Pro."
4. Call `provider.charge({ token, amountUsd: PLANS.pro.priceUsd, description: 'Docly AI Pro (demo)', customerId: user.id })`.
5. On success, `changePlan(admin, user.id, 'pro')`, revalidate, and return `{ ok: true, chargeId, last4? }`. The client passes `brand`/`last4` only for display, and the server never receives the full number.
6. On failure, return the decline message and leave the plan unchanged.

`setPlan('pro')` is no longer available to clients:
- Restrict `setPlan` to `'free'`, the downgrade/cancel path.
- Remove the Pro path from `PlanActions`.
- The schema rejects `'pro'` with "Use checkout to upgrade."

Logs carry the user id, token type and result only.

### B4. Checkout UI

**Files:** Create `src/app/dashboard/billing/checkout/page.tsx` and `src/components/billing/checkout-form.tsx`. Modify `src/components/billing/plan-actions.tsx` (the Pro button links to the checkout) and `src/app/dashboard/billing/page.tsx`.

The page is Stripe-like and two-column on desktop, stacked on mobile.

**Left: order summary**
- Line items: "Docly AI Pro — monthly", $19.00, subtotal and total, "Billed monthly · cancel anytime".
- A small "Test mode" pill.

**Right: payment form**
- A prominent amber notice: "Demo checkout — no real payment. Use test card **4242 4242 4242 4242**, any future date, any CVC." Include a "Fill test card" helper button.
- Fields: email (prefilled, read-only), card number with brand icon and live 4-digit grouping, expiry MM/YY, CVC, cardholder name. Show inline errors per field (`aria-invalid`, `aria-describedby`).
- Pay button: "Pay $19.00 — demo".
- States:
  - Processing: spinner and "Processing payment…", inputs disabled.
  - Declined: red message, fields kept except the CVC.
  - Success: a success panel ("Payment successful — you're on Pro", demo receipt id `ch_demo_…`, card "•••• 4242"), then a link back to billing. The plan badge updates.

**Downgrade on the billing page:** "Cancel subscription (demo)" with the existing inline confirm. No card is needed.

Accessibility: labels, focus moves to the first invalid field and to the result panel, a live region for status.

### B5. Tests

- **Unit:** demo-card, mock provider, the `completeDemoCheckout` action (mocked provider + `changePlan`), and `setPlan` rejecting `'pro'`.
- **E2E:** update `e2e/widget-billing.spec.ts` and `e2e/walkthrough.spec.ts` upgrade steps to go through the checkout:
  - a real number such as `4111 1111 1111 1111` (a Visa test number, but not in our allowlist) → demo-only error, plan unchanged;
  - `4000 0000 0000 0002` → declined, plan unchanged;
  - `4242…` → success → Pro, and a 3rd document upload works.
  - The network assertion: no request body contains the card number (`page.on('request')` checks POST bodies for `4242424242424242`).
- Regenerate the walkthrough screenshots with a checkout step.

### B6. Docs

- README: Billing section (demo checkout, test cards, tokenization, the deviation from SDD §4 and why it's safe).
- `docs/architecture.md` §5.5: the payment adapter and the checkout flow.

---

## Exit checklist

- [ ] The star field is visible and animated across landing, auth and dashboard; it follows the cursor and drifts when idle; it's static under reduced motion; it's absent on `/embed`; there's no horizontal scroll at 375 px; text contrast is AA.
- [ ] The hero chat preview loops through user typing → thinking → grounded answer; it's static under reduced motion.
- [ ] Upgrading to Pro happens only through the demo checkout with an allowed test card. Real or unknown numbers are rejected client-side, and no card number reaches the server (E2E network assertion).
- [ ] lint, typecheck, unit, integration, E2E and build pass; the branch is pushed; a PR is open.
