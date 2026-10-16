# Epic 02 — Chatbot Builder: Bot Setup and Knowledge Ingestion

**Source:** `Docly_AI_Lean_MVP_SDD.md` §2, §3 (data model), §4, §6, US-01.02 (bot part), US-02.01
**Priority:** P0
**Build phase:** 1 (bot) + 2 (ingestion)

---

## Description

The owner creates their single chatbot (name + welcome message), uploads PDF/TXT documents, and the system turns each document into searchable knowledge: text extraction → bounded chunks → embeddings → rows in pgvector, all scoped to the chatbot. The owner sees each document's status (`Processing`, `Ready`, `Failed`) and can delete documents together with their chunks. Document quotas from the plan are enforced on the server.

## Business Value

- Gives the owner a bot that "knows" their company documents — the raw material for every answer in Epics 03 and 04.
- Clear processing feedback builds trust and prevents confusion when a file is unusable.
- Document quota is the first visible Free/Pro differentiator.

## In Scope

1. **Migrations:** `chatbots` (`id`, `owner_id`, `name`, `welcome_message`, `accent_color` nullable, `is_published` default `false`), unique per owner; `documents` (`id`, `chatbot_id`, `file_name`, `storage_path`, `status`, `error_message`, `created_at`); `document_chunks` (`id`, `document_id`, `chatbot_id`, `content`, `embedding vector(N)`); foreign keys with `ON DELETE CASCADE`; vector index; RLS (owner-only access).
2. **Private Storage bucket** for uploaded files; path namespaced by owner/chatbot; storage policies restrict access to the owner.
3. **Bot creation & settings:** create one bot (name, welcome message); edit both; persisted across refresh.
4. **Upload:** `.pdf` and `.txt` only, ≤ 5 MB each, one file per upload; validated on client **and** server (extension + MIME + size).
5. **Ingestion pipeline (synchronous, in the request):** extract text (text-based PDF + UTF-8 TXT) → normalise → enforce extracted-text limit → split into bounded chunks with small overlap → generate embeddings through the AI provider adapter → insert chunks → mark `ready`.
6. **AI provider adapter (embedding part):** small server-only module exposing `embed(texts)`; Gemini-compatible embedding model; vector dimension matches the migration.
7. **Failure handling:** empty/unreadable/scanned PDF, extraction error, embedding error → `failed` with a user-friendly `error_message`; no partial chunks left behind.
8. **Document list & delete:** list with file name and status; delete removes storage object, document row and all its chunks.
9. **Document quota:** server checks the owner's plan limit (Free 2 / Pro 10) before accepting an upload; rejection returns a clear message and an Upgrade CTA.
10. **Dashboard section:** bot settings + documents (single dashboard view; tabs or sections).

## Out of Scope

- Multiple bots per account.
- OCR, DOCX, website crawling, integrations, batch/multi-file upload.
- Async job queues, background workers, retries scheduling.
- Re-indexing, document versioning, document preview/download for the owner.
- Accent color editing (P1 — only if time remains, and Pro-only).
- Chat (Epic 03), publishing and widget (Epic 04), plan changes (Epic 04).

## Dependencies

| Depends on | Reason |
|---|---|
| Epic 01 | Auth/session, `profiles.plan`, shared plan configuration, dashboard shell, migrations pipeline, pgvector enabled. |

**Unblocks:** Epic 03 (needs chunks to retrieve), Epic 04 (needs bot ID for embed; document quota is gated by plan).

**Independent verification:** documents reach `Ready` and their chunks exist in `document_chunks` with the correct `chatbot_id` (verified via integration test or SQL), without any chat UI.

## User Stories

### US-02.01 — Create and configure my bot (P0)
**As an** owner, **I want** to create a bot with a name and welcome message **so that** I have a place to put my knowledge.

### US-02.02 — Upload company documents (P0)
**As an** owner, **I want** to upload a PDF or TXT document **so that** my bot learns company knowledge.

### US-02.03 — See processing status (P0)
**As an** owner, **I want** to see whether each document is processing, ready or failed **so that** I know whether the bot can use it.

### US-02.04 — Remove a document (P0)
**As an** owner, **I want** to delete a document **so that** the bot no longer uses outdated knowledge and I free up quota.

### US-02.05 — Respect my plan's document limit (P0)
**As an** owner, **I want** a clear message when I reach my document limit **so that** I know to delete a file or upgrade.

## Acceptance Criteria

### US-02.01
- [ ] AC-02.01.1 Owner with no bot sees "Create your bot" and can create one with name (required, ≤ 60 chars) and welcome message (required, ≤ 300 chars).
- [ ] AC-02.01.2 A second bot cannot be created (UI hides the action; server/DB rejects it).
- [ ] AC-02.01.3 Name and welcome message can be edited; changes persist across refresh.
- [ ] AC-02.01.4 After creation the dashboard shows the bot and the next action "Upload documents".
- [ ] AC-02.01.5 A different signed-in owner gets 403/404 on this bot's management endpoints and sees no data via RLS.

### US-02.02
- [ ] AC-02.02.1 Only `.pdf` and `.txt` up to 5 MB are accepted; other types or larger files are rejected with an explanatory message on both client and server.
- [ ] AC-02.02.2 A valid text-based document is extracted, chunked, embedded and stored; every chunk row carries the correct `document_id` and `chatbot_id`.
- [ ] AC-02.02.3 Chunk size is bounded (e.g. ~800–1,200 characters with overlap) and extracted text is capped by a configured maximum.
- [ ] AC-02.02.4 Uploading the same file twice while the first is processing does not create duplicate ingestion (button disabled + server guard).
- [ ] AC-02.02.5 The original file is stored in a private bucket; it is not accessible via a public URL or by another owner.

### US-02.03
- [ ] AC-02.03.1 During ingestion the document shows `Processing` with a loading indicator.
- [ ] AC-02.03.2 On success the status becomes `Ready`.
- [ ] AC-02.03.3 Empty, scanned/unreadable, or corrupt files end as `Failed` with a readable reason; no chunks remain for them.
- [ ] AC-02.03.4 An embedding provider error ends as `Failed` ("Processing failed, please try again"); no partial chunks and no misleading `Ready`.

### US-02.04
- [ ] AC-02.04.1 Owner can delete a document after a confirmation.
- [ ] AC-02.04.2 Deletion removes the document row, all its chunks and the storage object.
- [ ] AC-02.04.3 Deleted documents no longer count toward the document quota.

### US-02.05
- [ ] AC-02.05.1 On Free, a 3rd upload is rejected by the server with "Free plan allows 2 documents" and an Upgrade CTA.
- [ ] AC-02.05.2 The quota check happens on the server before any storage write or ingestion work.
- [ ] AC-02.05.3 Documents with `Failed` status do not block quota indefinitely (owner can delete them; counting rule documented).
- [ ] AC-02.05.4 Limits are read from the shared plan configuration and the owner's current `profiles.plan`.

## Business Rules

- **BR-02.1** One chatbot per account.
- **BR-02.2** All management operations require an authenticated owner; ownership is checked on the server and enforced by RLS. Never trust client-supplied `owner_id` or `chatbot_id` without verification.
- **BR-02.3** Ingestion always writes chunks with the authorised `chatbot_id`.
- **BR-02.4** Uploads have type (PDF/TXT), size (≤ 5 MB) and extracted-text limits.
- **BR-02.5** Document content is untrusted data; it is never executed or treated as instructions.
- **BR-02.6** No partial or misleading `Ready` status; failures leave no orphan chunks.
- **BR-02.7** Deleting a document deletes its chunks and its stored file.
- **BR-02.8** Document limit: Free 2, Pro 10 — enforced server-side.
- **BR-02.9** Errors are logged without raw document contents or secrets.

## Definition of Done

- [ ] All acceptance criteria above pass.
- [ ] Bot persists across refresh; owner sees bot + documents in the dashboard.
- [ ] A real text-based PDF and a TXT file reach `Ready`; an invalid/oversized file is rejected; an empty/scanned PDF ends `Failed`.
- [ ] Unit tests (Vitest) for file validation and chunking logic.
- [ ] Cross-account test: second owner cannot read/modify the first owner's bot, documents, chunks or storage files.
- [ ] Migrations with FKs, indexes, RLS and cascade deletion are committed.
- [ ] Lint, type-check and build pass; deployed preview updated.
