import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { serverEnv } from '@/lib/env-server';
import { AppError } from '@/lib/errors';
import { EMBED_BATCH_SIZE, EMBEDDING_DIMENSIONS } from '@/lib/rag-config';

const EMBED_TIMEOUT_MS = 20_000;
const PROVIDER_ERROR = 'The AI service is unavailable right now. Please try again in a minute.';
let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: serverEnv('GEMINI_API_KEY') });
  return client;
}

export async function embedTexts(texts: readonly string[]): Promise<number[][]> {
  const batches: string[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    batches.push(texts.slice(start, start + EMBED_BATCH_SIZE));
  }
  const results = await Promise.all(batches.map((batch) => embedBatch(batch, 'RETRIEVAL_DOCUMENT')));
  return results.flat();
}

// Reused by embedQuery in Epic 03
async function embedBatch(batch: readonly string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> {
  let values: number[][];
  try {
    const response = await getClient().models.embedContent({
      model: serverEnv('GEMINI_EMBEDDING_MODEL'),
      contents: [...batch],
      config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS, abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS) },
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
