# Epic 03 — AI Chat: Grounded Answers and Message Quota

**Source:** `Docly_AI_Lean_MVP_SDD.md` §2, §3, §4, §6, US-02.02, Core Test Matrix
**Priority:** P0
**Build phase:** 2

---

## Description

Build the single chat API and the owner's ChatGPT-like chat playground. For each question the server embeds the query, retrieves the most relevant chunks **only** from the requested chatbot, asks Gemini to answer strictly from that context, and returns the answer — or a concise "I don't know based on these documents." when evidence is missing. Successful AI requests are counted atomically against the owner's monthly quota (Free 30 / Pro 300). This chat API is the same one the public widget will use in Epic 04.

## Business Value

- Delivers the core promise: "Your docs. Instant answers."
- The owner can verify answer quality before exposing the bot publicly.
- Message quota is the second Free/Pro differentiator and protects AI cost.

## In Scope

1. **AI provider adapter (generation part):** server-only `generate(prompt)` for Gemini, alongside `embed()` from Epic 02; provider swappable behind the adapter.
2. **Retrieval:** pgvector similarity search (SQL function / RPC) filtered by `chatbot_id`; top-k chunks with a minimum similarity threshold.
3. **Grounded prompt:** system instruction requiring answers only from the provided context; document text wrapped as untrusted data; fixed not-found response when context is insufficient.
4. **Chat API (single endpoint/service):** input validation (non-empty, max length), resolve chatbot, authorise caller (owner session in this epic; public path added in Epic 04), check quota, retrieve, generate, count, respond.
5. **Usage counting:** `usage_counters` migration (`owner_id`, `month`, `message_count`, unique `(owner_id, month)`); atomic increment (single SQL statement/function) only for successful AI responses; quota check before calling the provider.
6. **Chat playground UI (dashboard):** message list, input, send, loading, assistant response, error states; welcome message shown first; conversation kept only in client memory.
7. **Error handling:** provider unavailable/timeout → friendly error, UI stays usable; quota exceeded → clear message with Upgrade CTA.
8. **Quality check:** a representative test document with ≥ 3 known Q&A pairs and 1 unrelated question.

## Out of Scope

- Streaming tokens.
- Citations with clickable page numbers.
- Conversation history persistence, multiple threads, analytics.
- Advanced prompt editor or model selection for owners.
- Public/widget access, IP rate limiting (Epic 04).
- Plan upgrade/downgrade UI (Epic 04).
- A second, separate AI pipeline for any client.

## Dependencies

| Depends on | Reason |
|---|---|
| Epic 01 | Auth, `profiles.plan`, shared plan configuration, dashboard shell. |
| Epic 02 | Chatbot, `document_chunks` with embeddings, embedding adapter. |

**Unblocks:** Epic 04 (widget reuses this chat API; billing changes the quota enforced here).

**Independent verification:** with a seeded/uploaded test document, the dashboard playground answers known questions, declines an unrelated one, and the 31st message on Free is rejected — no widget or billing UI needed (plan can be switched via SQL for testing).

## User Stories

### US-03.01 — Ask my bot questions (P0)
**As an** owner, **I want** to ask my bot questions in a chat interface **so that** I can check its responses.

### US-03.02 — Trustworthy, grounded answers (P0)
**As an** owner, **I want** the bot to answer only from my documents and say when it doesn't know **so that** it never invents company facts.

### US-03.03 — Monthly message quota (P0)
**As the** business, **I want** AI messages counted and limited per plan **so that** costs are bounded and Pro has a reason to exist.

### US-03.04 — Fail gracefully (P0)
**As an** owner, **I want** a clear message when something goes wrong **so that** the chat never looks broken.

## Acceptance Criteria

### US-03.01
- [ ] AC-03.01.1 Chat playground shows the bot's welcome message, an input and a send button.
- [ ] AC-03.01.2 Sending shows the user message immediately and a loading indicator until the answer arrives; input is disabled while waiting.
- [ ] AC-03.01.3 Empty/whitespace-only input cannot be sent; messages over the max length (e.g. 1,000 chars) are rejected on client and server.
- [ ] AC-03.01.4 Keyboard: Enter sends, Shift+Enter adds a new line.
- [ ] AC-03.01.5 If the bot has no `Ready` documents, the playground shows a hint to upload documents first.

### US-03.02
- [ ] AC-03.02.1 Retrieval queries only chunks where `chatbot_id` equals the authorised chatbot; verified by a test with two bots holding different content.
- [ ] AC-03.02.2 For a representative test document, at least 3 known questions receive correct answers.
- [ ] AC-03.02.3 An unrelated question returns "I don't know based on these documents." (or equivalent concise not-found text) without hallucinated facts.
- [ ] AC-03.02.4 If no chunk passes the similarity threshold, the not-found response is returned without calling the generator (saves quota and cost).
- [ ] AC-03.02.5 Instructions embedded in a document (e.g. "ignore previous instructions") do not change the bot's behaviour.

### US-03.03
- [ ] AC-03.03.1 Each successful AI answer increments `message_count` for the owner's current calendar month atomically (no lost updates under concurrent requests).
- [ ] AC-03.03.2 Failed provider calls are not counted as successful messages.
- [ ] AC-03.03.3 When the monthly limit is reached (Free 30 / Pro 300), the server rejects the request before calling the provider, with a clear message and an Upgrade CTA.
- [ ] AC-03.03.4 Quota resets naturally at the start of a new calendar month (new counter row).
- [ ] AC-03.03.5 Limits come from the shared plan configuration and the owner's current plan.

### US-03.04
- [ ] AC-03.04.1 Gemini unavailable/timeout → friendly error message in the chat; the user can retry; no stack traces shown.
- [ ] AC-03.04.2 The Gemini API key never appears in client bundles or network responses.
- [ ] AC-03.04.3 Errors are logged with request context but without raw document content, prompts containing documents, or secrets.

## Business Rules

- **BR-03.1** One chat API and one retrieval/AI pipeline serves both dashboard and widget.
- **BR-03.2** Vector search always filters by the authorised `chatbot_id`.
- **BR-03.3** Answers are grounded in retrieved context; otherwise return the not-found response.
- **BR-03.4** Document content is untrusted context, never trusted instructions.
- **BR-03.5** Only successful AI responses count toward quota; counting is atomic, per owner per calendar month.
- **BR-03.6** Message limit: Free 30 / Pro 300 per calendar month — enforced server-side, not only in the UI.
- **BR-03.7** AI keys remain server-side.
- **BR-03.8** Owner-playground messages count against the same monthly quota as widget messages.

## Definition of Done

- [ ] All acceptance criteria above pass.
- [ ] A real uploaded PDF/TXT answers relevant questions and fails safely when information is absent or the provider errors.
- [ ] Unit tests (Vitest): prompt builder, quota check logic, input validation.
- [ ] Integration test: cross-bot retrieval isolation; quota rejection on the limit.
- [ ] Core test matrix rows passing: grounded answer, unrelated question, Free message cap, Gemini unavailable.
- [ ] Lint, type-check and build pass; deployed preview updated.
- [ ] Phase-2 exit condition met: document Q&A works end-to-end.
