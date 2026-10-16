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
    const rows = chunks.map((content, index) => ({ chunk_index: index, content, embedding: JSON.stringify(vectors[index]) }));
    // One transaction: all chunks are inserted and the document becomes ready, or nothing changes.
    const { error } = await admin.rpc('complete_document', { p_document_id: target.id, p_size_bytes: bytes.byteLength, p_chunks: rows });
    if (error) throw error;
    return { status: 'ready' };
  } catch (error) {
    const errorMessage = error instanceof AppError ? error.message : GENERIC_FAILURE;
    console.error('[ingest] failed', { documentId: target.id, code: errorCode(error) });
    await markFailed(admin, target, errorMessage);
    return { status: 'failed', errorMessage };
  }
}

function errorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return 'UNKNOWN';
}

async function download(admin: SupabaseClient<Database>, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from('documents').download(path);
  if (error || !data) throw new AppError('INGESTION_FAILED', 'The uploaded file was not found. Please upload it again.');
  return new Uint8Array(await data.arrayBuffer());
}

type FailureStep = 'set_failed' | 'delete_chunks' | 'remove_object';

// Never throws: each step runs independently and reports its own failure.
async function markFailed(admin: SupabaseClient<Database>, target: IngestTarget, errorMessage: string): Promise<void> {
  const run = async (step: FailureStep, action: () => PromiseLike<{ error: object | null }>): Promise<void> => {
    try {
      const { error } = await action();
      if (error) console.error('[ingest] cleanup step failed', { documentId: target.id, step, code: errorCode(error) });
    } catch (error) {
      console.error('[ingest] cleanup step failed', { documentId: target.id, step, code: errorCode(error) });
    }
  };

  await run('set_failed', () =>
    admin.from('documents').update({ status: 'failed', error_message: errorMessage }).eq('id', target.id).eq('status', 'processing'));
  await run('delete_chunks', () => admin.from('document_chunks').delete().eq('document_id', target.id));
  await run('remove_object', () => admin.storage.from('documents').remove([target.storagePath]));
}
