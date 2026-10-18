# Space Dashboard, Space Chat & Answer Sources — Plan

**Task:** TASK-004 · **Branch:** `feature/space-dashboard-chat`

The user decided:
- Space theme on the dashboard (including billing and checkout) and in chat, each in a **different format** from the landing page's "sparkle sky".
- The chat (playground **and** the embeddable widget) is restyled in space colours.
- Answers show which document they came from — **owner playground only**. The public widget never shows file names, which keeps AC-04.03.2.

## Shared contract (both tracks rely on it)

`POST /api/chat` response:

```ts
{ answer: string; isGrounded: boolean; usage: { used: number; limit: number } | null;
  sources: { documentId: string; fileName: string }[] } // owner mode: 0..3 unique docs; public mode: always []
```

- Not-found answers and blocked answers → `sources: []`.

## Track A — Backend sources (`coder`)

1. **Retrieval:** `match_chunks` already returns `document_id`. After retrieval, load `file_name` for those document ids with the admin client, filtered by `chatbot_id`. No SQL migration.
2. **Prompt:**
   - Each `<document-{nonce} index="n">` block also carries `source="{fileName}"`, escaped like the content.
   - The system instruction asks the model to end its reply with a final line `SOURCES: 1, 3` listing the indices actually used. If no document supports the answer, it replies with the not-found sentence and no SOURCES line.
3. **Parsing:**
   - A pure `extractSources(text, chunkCount)` strips the trailing `SOURCES:` line from the answer, even if the model formats it slightly differently (case, brackets, "Sources -").
   - It returns valid 1-based indices. Out-of-range indices and duplicates are dropped.
   - Fallback when the model gives no SOURCES line on a grounded answer: use the document of the highest-similarity chunk.
   - Map indices to chunk → document, de-duplicate by `documentId`, keep the order of first use, at most 3.
4. **Mode:**
   - Public mode always returns `sources: []`, so file names are never sent to visitors.
   - The `SOURCES:` line must never reach the user in either mode.
5. **Tests:**
   - Unit tests for `extractSources` (variants, garbage, no line, out-of-range), the prompt (source attribute escaped) and `answerQuestion` (owner gets sources, public gets `[]`, not-found and blocked answers get `[]`).
   - Update the route test and the `ChatAnswer` type.
6. **Docs:** `docs/architecture.md` §5.3 and §6 response shape; README feature list.

## Track B — Space UI (`coder-frontend`, worktree)

1. **Star-field variants** (same canvas engine, new pure helpers plus tests):
   - **`constellations`** (all `/dashboard*` except `/dashboard/chat`):
     - Dark backdrop with a slow **aurora**: teal/indigo/violet bands as CSS gradients, gently waving.
     - Calm small stars. Stars within ~140 px of the cursor are linked by thin fading lines (constellation lines). Without a cursor, a few small constellations form and dissolve slowly.
     - No shooting stars and no spikes, which keeps it distinct from the landing page.
   - **`galaxy`** (`/dashboard/chat` and `/embed/*`):
     - Deep space with a slowly rotating **spiral galaxy** (arms of tiny particles, warm core glow), placed off-centre (bottom-right on desktop, top on mobile).
     - Fine star dust, very slow motion, no cursor effects beyond a subtle parallax. It must stay calm for reading.
   - The landing/auth `space` variant is unchanged.
   - All variants keep reduced-motion (static frame), the coarse/low-core throttle and the hidden-tab pause.
   - The dark background comes from CSS on the server via `html:has(...)` (no flash).
2. **Dark dashboard UI:** the layout header, bot settings, documents, embed panel, billing (pricing cards use `tone="dark"`), checkout and the success panel become dark glass (`bg-white/5`, `border-white/10`, readable inputs with a `border-white/40` boundary), with AA contrast and visible focus.
   - The demo-checkout amber notice stays clearly visible in a dark-amber style.
3. **Space chat** (`ChatWindow`, shared by the playground and the widget):
   - Dark glass panel.
   - User bubbles use an indigo→violet gradient; assistant bubbles are glass with a faint glow.
   - A glowing "thinking" orb or dots, and a dark input with a gradient send button.
   - Not-found answers are muted, and error bubbles are readable.
   - **Sources:** when `sources.length > 0` (owner playground), render chips under the answer: a file icon plus "employee-handbook.pdf", with the label "Source"/"Sources". `mode="public"` never renders chips, even if data is present.
4. **Widget:** the `/embed` page uses the galaxy backdrop inside the iframe, and the `widget.js` launcher button and panel border pick up the space palette (dark panel, indigo→violet launcher gradient, glow). widget.js must stay under 5 KB.
5. **E2E:** theme checks for `/dashboard` (constellations backdrop present, dark html), `/dashboard/chat` and `/embed/<uuid>` (galaxy). Billing cards are now dark, so update the earlier "light" assertions. Source chips render in the playground when the API returns sources (mock the response with `page.route`) and never render in public mode.

## Exit checklist
- [ ] Three visually distinct space formats: landing (sparkles and shooting stars), dashboard (aurora and constellations), chat/widget (galaxy).
- [ ] Owner answers show the correct source file name; the widget never shows file names.
- [ ] lint, typecheck, unit, integration, E2E and build pass; the browser check is done; the review findings are fixed; a PR is open.
