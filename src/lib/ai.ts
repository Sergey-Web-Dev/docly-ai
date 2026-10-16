import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { serverEnv } from '@/lib/env-server';
import { AppError } from '@/lib/errors';
import { EMBED_BATCH_SIZE, EMBEDDING_DIMENSIONS, GENERATION_TIMEOUT_MS, MAX_OUTPUT_TOKENS } from '@/lib/rag-config';

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

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text], 'RETRIEVAL_QUERY');
  if (!vector) throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
  return vector;
}

export interface GenerateInput {
  readonly systemInstruction: string;
  readonly prompt: string;
}

const RETRY_BACKOFF_MS = 1500;
const RETRYABLE_STATUSES: readonly number[] = [429, 503];

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const { status } = error;
  return typeof status === 'number' ? status : undefined;
}

function isRetryable(error: unknown): boolean {
  const status = statusOf(error);
  return status !== undefined && RETRYABLE_STATUSES.includes(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateAnswer(input: GenerateInput): Promise<string> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await getClient().models.generateContent({
        model: serverEnv('GEMINI_CHAT_MODEL'),
        contents: input.prompt,
        config: {
          systemInstruction: input.systemInstruction,
          temperature: 0.2,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
        },
      });
      const text = response.text?.trim();
      if (!text) throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
      return text;
    } catch (error) {
      // AppError exposes a `status` getter (503), so it must be rethrown before the retry check.
      if (error instanceof AppError) throw error;
      if (attempt === 1 && isRetryable(error)) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      console.error('[ai] generateContent failed', { attempt, status: statusOf(error) });
      throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
    }
  }
  throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
}
