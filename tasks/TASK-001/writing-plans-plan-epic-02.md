# Epic 02 — Chatbot Builder Implementation Plan

**Task:** TASK-001 · **Epic:** `docs/epics/epic-02-chatbot-builder.md`

> **For Claude:** `coder` does Tasks 1–9 (lib, SQL file, actions, route, tests); `coder-frontend` does Task 10 (dashboard UI); Task 11 E2E after UI. Steps marked **[orchestrator]** (Supabase MCP) are run by the main session.

**Goal:** Owner creates one bot (name + welcome message), uploads PDF/TXT (≤ 5 MB), the server extracts → chunks → embeds (Gemini, 768 dims) → stores chunks in pgvector scoped by `chatbot_id`; statuses Processing / Ready / Failed; delete; Free/Pro document quota enforced in SQL.

**Architecture:** `docs/architecture.md` §3, §4, §5.2. One change found while planning (applied to the architecture doc): **files are uploaded from the browser straight to the private Storage bucket**, because Vercel functions reject request bodies > 4.5 MB while the SDD allows 5 MB. The server still validates everything after downloading the object.

```text
Browser                     Server Action / Route                       Supabase
1 validate (UX only) ──► startDocumentUpload()  ── admin.rpc(create_document, limit) ─► documents row 'processing' (quota+dup, atomic)
2 upload file ──────────────────────────────────────────── user client ─► storage documents/{owner}/{docId}  (RLS: own folder, 5 MB, pdf/txt)
3 POST /api/documents/{id}/ingest ─► claim (ingest_started_at) → download → validateFile → extract → chunk → embedTexts → insert chunks → 'ready'
                                     any failure → delete chunks + object, 'failed' + friendly message
```

**Tech Stack:** existing + `@google/genai`, `unpdf`; dev: `pdf-lib` (test fixtures only).

**Conventions:** prefix npm commands with `unset NODE_ENV;`. `.env.local` now exists (user-managed; never read/print it). Commit after each task, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.

---

### Task 1: Migration — chatbots, documents, chunks, storage, `create_document` **[orchestrator applies]**

**Files:** Create `supabase/migrations/20261016000003_chatbots_documents.sql`

```sql
-- Chatbots: one per owner
create table public.chatbots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  name varchar(60) not null check (length(btrim(name)) > 0),
  welcome_message varchar(300) not null check (length(btrim(welcome_message)) > 0),
  accent_color text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  chatbot_id uuid not null references public.chatbots (id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 255),
  storage_path text not null,
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error_message text,
  ingest_started_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chatbot_id, file_name)
);
create index documents_chatbot_id_idx on public.documents (chatbot_id);

create table public.document_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  chatbot_id uuid not null references public.chatbots (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(768) not null
);
create index document_chunks_chatbot_id_idx on public.document_chunks (chatbot_id);
create index document_chunks_document_id_idx on public.document_chunks (document_id);
create index document_chunks_embedding_idx on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- RLS
alter table public.chatbots enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

revoke all on public.chatbots, public.documents, public.document_chunks from anon, authenticated;
grant select, insert on public.chatbots to authenticated;
grant update (name, welcome_message, is_published, updated_at) on public.chatbots to authenticated;
grant select, delete on public.documents to authenticated;
-- document_chunks: no client access at all (server uses the secret key)

create policy "chatbots: owner reads" on public.chatbots for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "chatbots: owner inserts own" on public.chatbots for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "chatbots: owner updates" on public.chatbots for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create policy "documents: owner reads" on public.documents for select to authenticated
  using (exists (select 1 from public.chatbots c where c.id = chatbot_id and c.owner_id = (select auth.uid())));
create policy "documents: owner deletes" on public.documents for delete to authenticated
  using (exists (select 1 from public.chatbots c where c.id = chatbot_id and c.owner_id = (select auth.uid())));

-- Atomic quota + duplicate check. Service role only; limit comes from src/lib/plans.ts.
create function public.create_document(p_chatbot_id uuid, p_file_name text, p_size_bytes integer, p_max_documents integer)
returns public.documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_count integer;
  v_id uuid := gen_random_uuid();
  v_row public.documents;
begin
  select owner_id into v_owner from public.chatbots where id = p_chatbot_id for update;
  if v_owner is null then
    raise exception 'NOT_FOUND';
  end if;

  select count(*) into v_count from public.documents where chatbot_id = p_chatbot_id;
  if v_count >= p_max_documents then
    raise exception 'QUOTA_EXCEEDED';
  end if;

  begin
    insert into public.documents (id, chatbot_id, file_name, storage_path, size_bytes)
    values (v_id, p_chatbot_id, p_file_name, v_owner::text || '/' || v_id::text, p_size_bytes)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'DUPLICATE';
  end;

  return v_row;
end;
$$;

revoke execute on function public.create_document(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.create_document(uuid, text, integer, integer) to service_role;

-- Storage: private bucket, owner-only folder {owner_id}/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 5242880, array['application/pdf', 'text/plain']);

create policy "documents bucket: owner reads own folder" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "documents bucket: owner uploads to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "documents bucket: owner deletes own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

**[orchestrator]** `apply_migration(name="chatbots_documents")` → `get_advisors(security)` clean → `generate_typescript_types` → coder copies into `src/lib/database.types.ts`.
**Commit:** `feat(db): add chatbots, documents, chunks, storage and create_document`

---

### Task 2: Server env, admin client, errors — TDD for errors

**Files:** Create `src/lib/env-server.ts`, `src/lib/supabase/admin.ts`, `src/lib/errors.ts` · Test `src/lib/errors.test.ts`

```ts
// src/lib/env-server.ts
import 'server-only';

type ServerEnvName = 'SUPABASE_SECRET_KEY' | 'GEMINI_API_KEY' | 'GEMINI_EMBEDDING_MODEL' | 'GEMINI_CHAT_MODEL' | 'RATE_LIMIT_SALT';

export function serverEnv(name: ServerEnvName): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
```

```ts
// src/lib/supabase/admin.ts — ONLY call after the caller's access was verified on the server
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { publicEnv } from '@/lib/env';
import { serverEnv } from '@/lib/env-server';

export function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(publicEnv.supabaseUrl, serverEnv('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

**Failing test** `src/lib/errors.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AppError, toErrorResponse } from '@/lib/errors';

describe('toErrorResponse', () => {
  it('should map an AppError to its status and JSON body', async () => {
    const response = toErrorResponse(new AppError('QUOTA_EXCEEDED', 'Free plan allows 2 documents.', true));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: { code: 'QUOTA_EXCEEDED', message: 'Free plan allows 2 documents.', upgrade: true } });
  });

  it('should hide internal details when error is unknown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = toErrorResponse(new Error('db password leaked'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  });
});
```

**Implement** `src/lib/errors.ts`:

```ts
export type ErrorCode =
  | 'VALIDATION' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'DUPLICATE' | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED' | 'BOT_UNAVAILABLE' | 'PROVIDER_UNAVAILABLE' | 'INGESTION_FAILED' | 'INTERNAL';

const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION: 400, UNAUTHORIZED: 401, NOT_FOUND: 404, DUPLICATE: 409, QUOTA_EXCEEDED: 402,
  RATE_LIMITED: 429, BOT_UNAVAILABLE: 404, PROVIDER_UNAVAILABLE: 503, INGESTION_FAILED: 422, INTERNAL: 500,
};

export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly upgrade = false) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string; readonly upgrade?: boolean };
}

export function toErrorBody(error: AppError): ErrorBody {
  return { error: { code: error.code, message: error.message, ...(error.upgrade ? { upgrade: true } : {}) } };
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof AppError) return Response.json(toErrorBody(error), { status: error.status });
  console.error('[api] unhandled error', { name: error instanceof Error ? error.name : typeof error });
  return Response.json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } } satisfies ErrorBody, { status: 500 });
}
```

Run → PASS. **Commit:** `feat(api): add error contract, server env and admin client`

---

### Task 3: RAG constants + file validation — TDD

**Files:** Create `src/lib/rag-config.ts`, `src/lib/ingest/validate-file.ts` · Test `src/lib/ingest/validate-file.test.ts`

```ts
// src/lib/rag-config.ts — starting values, tuned in Epic 03
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MIN_TEXT_CHARS = 50;
export const MAX_TEXT_CHARS = 150_000;
export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 150;
export const MAX_CHUNKS = 200;
export const EMBEDDING_DIMENSIONS = 768;
export const EMBED_BATCH_SIZE = 100;
```

**Failing tests** (cover): valid `.pdf` with `%PDF-` header and `application/pdf` → `{ ok: true, kind: 'pdf' }`; valid `.TXT` (case-insensitive) `text/plain` → `txt`; `.docx` → "Only PDF and TXT files are supported."; size 0 → "The file is empty."; size `MAX_FILE_BYTES + 1` → "Files must be 5 MB or smaller."; `.pdf` without magic bytes → "This file is not a valid PDF."; `.txt` containing a NUL byte → "This file is not a valid text file."; name longer than 255 → "File name is too long.".

**Implement:**

```ts
import { MAX_FILE_BYTES } from '@/lib/rag-config';

export type FileKind = 'pdf' | 'txt';
export interface FileCandidate {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly bytes?: Uint8Array; // omitted in the browser pre-check
}
export type FileValidation = { readonly ok: true; readonly kind: FileKind } | { readonly ok: false; readonly error: string };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const MIME_BY_KIND: Readonly<Record<FileKind, readonly string[]>> = {
  pdf: ['application/pdf', ''],
  txt: ['text/plain', ''],
};

export function validateFile(file: FileCandidate): FileValidation {
  const kind = kindFromName(file.name);
  if (!kind) return { ok: false, error: 'Only PDF and TXT files are supported.' };
  if (file.name.length > 255) return { ok: false, error: 'File name is too long.' };
  if (file.size <= 0) return { ok: false, error: 'The file is empty.' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'Files must be 5 MB or smaller.' };
  if (!MIME_BY_KIND[kind].includes(file.type.split(';')[0]?.trim() ?? '')) return { ok: false, error: 'Only PDF and TXT files are supported.' };
  if (!file.bytes) return { ok: true, kind };
  if (kind === 'pdf' && !startsWith(file.bytes, PDF_MAGIC)) return { ok: false, error: 'This file is not a valid PDF.' };
  if (kind === 'txt' && file.bytes.subarray(0, 4096).includes(0)) return { ok: false, error: 'This file is not a valid text file.' };
  return { ok: true, kind };
}

function kindFromName(name: string): FileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.txt')) return 'txt';
  return null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}
```

**Commit:** `feat(ingest): add file validation and RAG constants`

---

### Task 4: Text normalisation + chunking — TDD

**Files:** Create `src/lib/ingest/chunk-text.ts` · Test `src/lib/ingest/chunk-text.test.ts`

**Failing tests:**
- `normalizeText('a\r\n\r\n\r\n\tb  c\u0000')` → `'a\n\nb c'`.
- `chunkText('')` and whitespace → `[]`.
- short text → `[text]`.
- long multi-paragraph text (e.g. 60 sentences ~ 6 000 chars) → `length > 1`; **every chunk ≤ CHUNK_SIZE**; every input word appears in some chunk; `chunks[1]` starts with words that end `chunks[0]` (overlap).
- a single 5 000-char word without spaces → all chunks ≤ CHUNK_SIZE, concatenation covers it.
- `prepareChunks(text)` throws `AppError('INGESTION_FAILED', 'We couldn't find readable text in this file. Scanned PDFs are not supported.')` when normalised text < `MIN_TEXT_CHARS`; caps text at `MAX_TEXT_CHARS` and chunks at `MAX_CHUNKS`.

**Implement:**

```ts
import { AppError } from '@/lib/errors';
import { CHUNK_OVERLAP, CHUNK_SIZE, MAX_CHUNKS, MAX_TEXT_CHARS, MIN_TEXT_CHARS } from '@/lib/rag-config';

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const bodyLimit = size - overlap - 1;
  const bodies = pack(splitIntoPieces(normalized, bodyLimit), bodyLimit);
  return bodies.map((body, index) => {
    const previous = bodies[index - 1];
    return previous ? `${tail(previous, overlap)} ${body}`.trim() : body;
  });
}

export function prepareChunks(text: string): string[] {
  const normalized = normalizeText(text);
  if (normalized.length < MIN_TEXT_CHARS) {
    throw new AppError('INGESTION_FAILED', "We couldn't find readable text in this file. Scanned PDFs are not supported.");
  }
  return chunkText(normalized.slice(0, MAX_TEXT_CHARS)).slice(0, MAX_CHUNKS);
}

function splitIntoPieces(text: string, limit: number): string[] {
  return text.split(/\n{2,}/).flatMap((paragraph) => {
    const flat = paragraph.replace(/\s+/g, ' ').trim();
    if (!flat) return [];
    if (flat.length <= limit) return [flat];
    return flat.split(/(?<=[.!?])\s+/).flatMap((sentence) => splitLong(sentence, limit));
  });
}

function splitLong(sentence: string, limit: number): string[] {
  if (sentence.length <= limit) return [sentence];
  return sentence.split(' ').flatMap((word) => {
    if (word.length <= limit) return [word];
    const parts: string[] = [];
    for (let i = 0; i < word.length; i += limit) parts.push(word.slice(i, i + limit));
    return parts;
  });
}

function pack(pieces: readonly string[], limit: number): string[] {
  const bodies: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) bodies.push(current);
    current = piece;
  }
  if (current) bodies.push(current);
  return bodies;
}

function tail(text: string, length: number): string {
  const slice = text.slice(-length);
  const firstSpace = slice.indexOf(' ');
  return firstSpace >= 0 ? slice.slice(firstSpace + 1) : slice;
}
```

**Commit:** `feat(ingest): add text normalisation and chunking`

---

### Task 5: Text extraction — TDD with generated PDF

**Files:** Create `src/lib/ingest/extract-text.ts` · Test `src/lib/ingest/extract-text.test.ts`

```bash
npm install unpdf @google/genai
npm install -D pdf-lib
```

**Failing tests** (build PDFs in-test with `pdf-lib`: `PDFDocument.create()`, `addPage()`, `drawText('Vacation policy: 20 days', { font: await doc.embedFont(StandardFonts.Helvetica) })`, `doc.save()`):
- PDF with text → result contains `Vacation policy: 20 days`.
- PDF with an empty page → `''` (later rejected by `prepareChunks`).
- corrupt bytes `%PDF-garbage` → throws `AppError` code `INGESTION_FAILED` "We couldn't read this PDF. It may be damaged or password-protected."
- UTF-8 TXT with BOM → text without BOM; invalid UTF-8 bytes `[0xff, 0xfe, 0xfd]` → `AppError('INGESTION_FAILED', 'This text file is not UTF-8 encoded.')`.

**Implement:**

```ts
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { AppError } from '@/lib/errors';
import type { FileKind } from '@/lib/ingest/validate-file';

export async function extractText(bytes: Uint8Array, kind: FileKind): Promise<string> {
  return kind === 'pdf' ? extractFromPdf(bytes) : extractFromTxt(bytes);
}

async function extractFromPdf(bytes: Uint8Array): Promise<string> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  } catch {
    throw new AppError('INGESTION_FAILED', "We couldn't read this PDF. It may be damaged or password-protected.");
  } finally {
    await pdf?.loadingTask.destroy();
  }
}

function extractFromTxt(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new AppError('INGESTION_FAILED', 'This text file is not UTF-8 encoded.');
  }
}
```

(Each `catch` converts a library error into a user-safe AppError — not swallowed.)

**Commit:** `feat(ingest): extract text from PDF and TXT`

---

### Task 6: Gemini embeddings (`src/lib/ai.ts`)

**Files:** Create `src/lib/ai.ts` · Test `src/lib/ai.test.ts` (mock `@google/genai` with `vi.mock`)

**Failing tests:** 150 texts → `embedContent` called twice (100 + 50) with `taskType: 'RETRIEVAL_DOCUMENT'`, `outputDimensionality: 768`, model from env; returns 150 vectors in order. Wrong vector length or count → `AppError('PROVIDER_UNAVAILABLE')`. SDK throws → `AppError('PROVIDER_UNAVAILABLE', 'The AI service is unavailable right now. Please try again in a minute.')`. (Set `process.env.GEMINI_API_KEY`/`GEMINI_EMBEDDING_MODEL` in the test; mock `server-only` with `vi.mock('server-only', () => ({}))`.)

```ts
import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { serverEnv } from '@/lib/env-server';
import { AppError } from '@/lib/errors';
import { EMBED_BATCH_SIZE, EMBEDDING_DIMENSIONS } from '@/lib/rag-config';

const PROVIDER_ERROR = 'The AI service is unavailable right now. Please try again in a minute.';
let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: serverEnv('GEMINI_API_KEY') });
  return client;
}

export async function embedTexts(texts: readonly string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    vectors.push(...(await embedBatch(batch, 'RETRIEVAL_DOCUMENT')));
  }
  return vectors;
}

async function embedBatch(batch: readonly string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> {
  let values: number[][];
  try {
    const response = await getClient().models.embedContent({
      model: serverEnv('GEMINI_EMBEDDING_MODEL'),
      contents: [...batch],
      config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    values = response.embeddings?.map((embedding) => embedding.values ?? []) ?? [];
  } catch (error) {
    console.error('[ai] embedContent failed', { taskType, count: batch.length, name: error instanceof Error ? error.name : 'unknown' });
    throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
  }
  if (values.length !== batch.length || values.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
    throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
  }
  return values;
}
```

(`embedBatch` is reused by `embedQuery` in Epic 03.) **Commit:** `feat(ai): add Gemini document embeddings`

---

### Task 7: Bot schema + chatbot data helpers + Server Actions

**Files:** Modify `src/lib/schemas.ts` (+ tests) · Create `src/lib/chatbots.ts`, `src/app/dashboard/actions.ts`

- `parseBotSettings(formData)` → `{ ok: true, name, welcomeMessage } | { ok: false, error, values }`; trimmed; name 1–60 ("Name is required." / "Name must be 60 characters or fewer."), welcome 1–300. TDD like Task 4 of Epic 01.
- `src/lib/chatbots.ts` (server-only, takes a Supabase client so RLS applies):

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '@/lib/database.types';
import { getPlan, type Plan } from '@/lib/plans';

export type Chatbot = Tables<'chatbots'>;
export type DocumentRow = Tables<'documents'>;

export async function getOwnChatbot(supabase: SupabaseClient<Database>, ownerId: string): Promise<Chatbot | null> {
  const { data, error } = await supabase.from('chatbots').select('*').eq('owner_id', ownerId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listDocuments(supabase: SupabaseClient<Database>, chatbotId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase.from('documents').select('*').eq('chatbot_id', chatbotId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getOwnPlan(supabase: SupabaseClient<Database>, ownerId: string): Promise<Plan> {
  const { data } = await supabase.from('profiles').select('plan').eq('id', ownerId).single();
  return getPlan(data?.plan);
}
```

- `src/app/dashboard/actions.ts` (`'use server'`; **every action starts with `requireUser()`**; returns `ActionState { error: string | null; notice?: string; upgrade?: boolean }`; ends with `revalidatePath('/dashboard')`):
  - `createBot(prev, formData)`: parse → `supabase.from('chatbots').insert({ owner_id: user.id, name, welcome_message })`; Postgres `23505` → "You already have a bot."
  - `updateBot(prev, formData)`: parse → `.update({ name, welcome_message, updated_at: new Date().toISOString() }).eq('owner_id', user.id)`.
  - `startDocumentUpload(input: { fileName: string; size: number; type: string })` → returns `{ ok: true, documentId, storagePath } | { ok: false, error, upgrade? }`:
    1. `validateFile` (no bytes) → error.
    2. `getOwnChatbot` (user client) → "Create your bot first."
    3. `getOwnPlan` → `createAdminClient().rpc('create_document', { p_chatbot_id, p_file_name, p_size_bytes, p_max_documents: plan.documents })`.
    4. Map `error.message` containing `QUOTA_EXCEEDED` → `` `Your ${plan.name} plan allows ${plan.documents} documents. Delete one or upgrade to Pro.` `` + `upgrade: plan.id === 'free'`; `DUPLICATE` → "A document with this name already exists. Delete it first or rename the file."
  - `deleteDocument(documentId: string)`: validate uuid (zod) → select via **user client** (RLS = ownership) → `supabase.storage.from('documents').remove([storage_path])` → `supabase.from('documents').delete().eq('id', id)` (chunks cascade).

**Verify:** typecheck, unit tests. **Commit:** `feat(bot): add bot settings, upload start and delete actions`

---

### Task 8: Ingestion route `POST /api/documents/[id]/ingest`

**Files:** Create `src/lib/ingest/ingest-document.ts`, `src/app/api/documents/[id]/ingest/route.ts`

```ts
// src/lib/ingest/ingest-document.ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { embedTexts } from '@/lib/ai';
import type { Database } from '@/lib/database.types';
import { AppError } from '@/lib/errors';
import { prepareChunks } from '@/lib/ingest/chunk-text';
import { extractText } from '@/lib/ingest/extract-text';
import { validateFile } from '@/lib/ingest/validate-file';

export interface IngestTarget {
  readonly id: string;
  readonly chatbotId: string;
  readonly fileName: string;
  readonly storagePath: string;
}
export type IngestResult = { readonly status: 'ready' } | { readonly status: 'failed'; readonly errorMessage: string };

const GENERIC_FAILURE = 'Processing failed. Please delete the file and try again.';

export async function ingestDocument(admin: SupabaseClient<Database>, target: IngestTarget): Promise<IngestResult> {
  try {
    const bytes = await download(admin, target.storagePath);
    const validation = validateFile({ name: target.fileName, type: '', size: bytes.byteLength, bytes });
    if (!validation.ok) throw new AppError('INGESTION_FAILED', validation.error);
    const chunks = prepareChunks(await extractText(bytes, validation.kind));
    const vectors = await embedTexts(chunks);
    const rows = chunks.map((content, index) => ({
      document_id: target.id, chatbot_id: target.chatbotId, chunk_index: index, content, embedding: JSON.stringify(vectors[index]),
    }));
    const { error: insertError } = await admin.from('document_chunks').insert(rows);
    if (insertError) throw insertError;
    await setStatus(admin, target.id, 'ready', null);
    return { status: 'ready' };
  } catch (error) {
    const errorMessage = error instanceof AppError ? error.message : GENERIC_FAILURE;
    console.error('[ingest] failed', { documentId: target.id, code: error instanceof AppError ? error.code : 'UNKNOWN' });
    await markFailed(admin, target, errorMessage);
    return { status: 'failed', errorMessage };
  }
}

async function download(admin: SupabaseClient<Database>, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from('documents').download(path);
  if (error || !data) throw new AppError('INGESTION_FAILED', 'The uploaded file was not found. Please upload it again.');
  return new Uint8Array(await data.arrayBuffer());
}

async function setStatus(admin: SupabaseClient<Database>, id: string, status: 'ready' | 'failed', errorMessage: string | null): Promise<void> {
  const { error } = await admin.from('documents').update({ status, error_message: errorMessage }).eq('id', id);
  if (error) throw error;
}

async function markFailed(admin: SupabaseClient<Database>, target: IngestTarget, errorMessage: string): Promise<void> {
  await admin.from('document_chunks').delete().eq('document_id', target.id);
  await admin.storage.from('documents').remove([target.storagePath]);
  await setStatus(admin, target.id, 'failed', errorMessage);
}
```

(Size/type from the download: `type: ''` is accepted by `validateFile`; the bucket already restricts MIME and size; magic bytes are checked here.)

```ts
// src/app/api/documents/[id]/ingest/route.ts
import { z } from 'zod';
import { AppError, toErrorResponse } from '@/lib/errors';
import { ingestDocument } from '@/lib/ingest/ingest-document';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new AppError('VALIDATION', 'Invalid document id.');

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new AppError('UNAUTHORIZED', 'Please sign in again.');

    // RLS: returns the row only if the caller owns its chatbot.
    const { data: document } = await supabase.from('documents').select('id, chatbot_id, file_name, storage_path, status').eq('id', id).maybeSingle();
    if (!document) throw new AppError('NOT_FOUND', 'Document not found.');

    const admin = createAdminClient();
    const { data: claimed } = await admin.from('documents')
      .update({ ingest_started_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'processing').is('ingest_started_at', null)
      .select('id').maybeSingle();
    if (!claimed) throw new AppError('DUPLICATE', 'This document is already being processed.');

    const result = await ingestDocument(admin, { id, chatbotId: document.chatbot_id, fileName: document.file_name, storagePath: document.storage_path });
    return Response.json({ document: { id, ...result } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

(Next 16: `params` is a Promise — confirm with Context7 if typecheck complains.) **Commit:** `feat(ingest): add ingestion route`

---

### Task 9: Integration tests (cloud Supabase)

**Files:** Create `tests/integration/chatbots-documents.test.ts` (reuse `helpers.ts`; add `cleanup` that deletes users → cascades).

Cases:
1. Alice inserts her bot via her client → OK; second insert → error code `23505`.
2. Alice cannot insert a bot with `owner_id = bob.id` (RLS violation).
3. Bob cannot select Alice's bot or documents (empty arrays); Bob's update of Alice's bot affects 0 rows (verify via admin).
4. Alice calling `rpc('create_document', …)` with her own client → error (permission denied).
5. Admin `create_document(limit 2)` ×2 → OK; 3rd → message contains `QUOTA_EXCEEDED`; same file name → `DUPLICATE`; returned `storage_path` = `${alice.id}/${row.id}`.
6. Alice cannot select or insert `document_chunks` from her client.
7. Storage: Alice uploads `text/plain` to `${alice.id}/x.txt` → OK; to `${bob.id}/x.txt` → error; Bob cannot download Alice's object.
8. Cascade: admin inserts a chunk (`embedding: JSON.stringify(Array(768).fill(0.01))`) for a document; Alice deletes the document via her client → chunk row gone (admin select count 0).

Run `npm run test:integration` → all pass. **Commit:** `test(db): cover chatbots, documents, storage RLS and create_document`

---

### Task 10: Dashboard UI (`coder-frontend`)

**Files:** Modify `src/app/dashboard/page.tsx` · Create `src/components/dashboard/create-bot-form.tsx`, `bot-settings-form.tsx`, `documents-panel.tsx`, `document-status-badge.tsx`

Page (`requireUser()` → `getOwnChatbot` → `listDocuments` + `getOwnPlan`):
- **No bot:** card "Create your bot" with `CreateBotForm` (name, welcome message textarea, char limits shown, inline errors, pending state). After success the page shows the bot.
- **Bot exists:** two sections on one page (SDD screen 3):
  - **Bot settings:** `BotSettingsForm` (prefilled; "Save changes"; success notice "Saved").
  - **Documents:** usage line `"{n} / {plan.documents} documents · {plan.name} plan"`; when `n === 0` show next-action empty state "Upload documents — PDF or TXT, up to 5 MB" (AC-02.01.4).
  - **Upload** (`DocumentsPanel`, client): `<input type="file" accept=".pdf,.txt,application/pdf,text/plain">` + "Upload" button; client pre-check with `validateFile` (no bytes) → inline error; then `startDocumentUpload` → upload with browser client `supabase.storage.from('documents').upload(storagePath, file, { contentType: file.type || 'text/plain', upsert: false })` → `fetch('/api/documents/{id}/ingest', { method: 'POST' })` → `router.refresh()`. Show stage text: "Uploading…", "Processing…" (with spinner); disable controls while busy (prevents duplicate submit). Quota/other errors shown inline; when `upgrade` is true show "Upgrade to Pro" link to `/#pricing` (Epic 04 replaces it with the plan modal).
  - **List:** file name, `DocumentStatusBadge` (Processing = spinner/neutral, Ready = green, Failed = red + `error_message` below), "Delete" button → `window.confirm('Delete "<name>"? The bot will stop using it.')` → `deleteDocument` → refresh.
- Accessible labels, `aria-live="polite"` for upload status, responsive at 375 px. Add shadcn `textarea` if needed (`npx shadcn@latest add textarea`).

**Commit:** `feat(dashboard): add bot setup and documents UI`

---

### Task 11: E2E (Playwright) — real Gemini

**Files:** Create `e2e/fixtures/handbook.txt` (≈ 2–3 KB fictional company handbook: company "Acme Robotics", 20 vacation days for new hires, remote work Tuesdays/Thursdays, support email help@acme.test, office in Lisbon — reused by Epic 03 Q&A), `e2e/fixtures/notes.txt` (short, > 50 chars), `e2e/fixtures/bad.csv`, `e2e/helpers.ts` (`signUpFresh(page)`), `e2e/documents.spec.ts`.

Scenarios (desktop project only: `test.skip(({ isMobile }) => isMobile)` to save Gemini quota):
1. Sign up → create bot ("Acme Helper", "Hi! Ask me about Acme.") → reload → settings persist (AC-02.01.3).
2. Upload `bad.csv` → "Only PDF and TXT files are supported." (client) — no network row created.
3. Upload `handbook.txt` → "Processing…" → row shows **Ready**.
4. Upload `handbook.txt` again → "already exists" error.
5. Upload `notes.txt` → Ready; usage "2 / 2 documents"; a third upload (a copy named `extra.txt` created via `setInputFiles({ name, mimeType, buffer })`) → quota message + "Upgrade to Pro".
6. Delete `notes.txt` → gone; usage "1 / 2".

**Run:** `npm run test:e2e` (all projects pass). **Commit:** `test(e2e): cover bot setup and document ingestion`

---

## Epic 02 Exit Checklist

- [ ] AC-02.01.1–5 bot create/edit/one-per-account/cross-account (integration 1–3, E2E 1)
- [ ] AC-02.02.1–5 types/size, chunks with ids, bounded chunks, no duplicates, private storage (unit Tasks 3–5, integration 5–7, E2E 2–4)
- [ ] AC-02.03.1–4 Processing/Ready/Failed, no partial chunks (unit + `markFailed`, E2E 3)
- [ ] AC-02.04.1–3 delete + cascade + quota freed (integration 8, E2E 6)
- [ ] AC-02.05.1–4 server quota before storage write, from `PLANS` (integration 5, E2E 5)
- [ ] lint, typecheck, unit, integration, E2E, build pass; security advisors clean
