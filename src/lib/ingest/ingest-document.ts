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
      document_id: target.id,
      chatbot_id: target.chatbotId,
      chunk_index: index,
      content,
      embedding: JSON.stringify(vectors[index]),
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
