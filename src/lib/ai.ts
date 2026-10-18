import 'server-only';
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { serverEnv } from '@/lib/env-server';
import { AppError } from '@/lib/errors';
import {
  EMBED_BATCH_SIZE,
  EMBEDDING_DIMENSIONS,
  GENERATION_TIMEOUT_MS,
  MAX_OUTPUT_TOKENS,
  MIN_RETRY_ATTEMPT_MS,
  QUERY_EMBED_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
} from '@/lib/rag-config';

const INGEST_EMBED_TIMEOUT_MS = 20_000;
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
  const results = await Promise.all(batches.map((batch) => embedBatch(batch, 'RETRIEVAL_DOCUMENT', INGEST_EMBED_TIMEOUT_MS)));
  return results.flat();
}

async function embedBatch(batch: readonly string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY', timeoutMs: number): Promise<number[][]> {
  let values: number[][];
  try {
    const response = await getClient().models.embedContent({
      model: serverEnv('GEMINI_EMBEDDING_MODEL'),
      contents: [...batch],
      config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS, abortSignal: AbortSignal.timeout(timeoutMs) },
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
  const [vector] = await embedBatch([text], 'RETRIEVAL_QUERY', QUERY_EMBED_TIMEOUT_MS);
  if (!vector) throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
  return vector;
}

export interface GenerateInput {
  readonly systemInstruction: string;
  readonly prompt: string;
}

export interface GenerateResult {
  readonly kind: 'answer' | 'blocked';
  readonly text: string; // empty when blocked
  readonly finishReason: string | undefined;
}

const RETRYABLE_STATUSES: readonly number[] = [429, 503];
const BLOCKING_FINISH_REASONS: readonly string[] = ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'];

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const { status } = error;
  return typeof status === 'number' ? status : undefined;
}

function isTimeoutOrAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function isRetryable(error: unknown): boolean {
  const status = statusOf(error);
  return !isTimeoutOrAbort(error) && status !== undefined && RETRYABLE_STATUSES.includes(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `deadline` is an absolute epoch-ms time shared by the whole request. Each attempt is capped by what is left of it,
// and a retry (429/503 only, once) starts only if the backoff plus a useful attempt still fit.
// No thinkingConfig is sent: lite models may not support it and an unsupported field would error.
export async function generateAnswer(input: GenerateInput, deadline: number): Promise<GenerateResult> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
    const timeoutMs = Math.min(GENERATION_TIMEOUT_MS, remaining);
    const startedAt = Date.now();
    let response: GenerateContentResponse;
    try {
      response = await getClient().models.generateContent({
        model: serverEnv('GEMINI_CHAT_MODEL'),
        contents: input.prompt,
        config: {
          systemInstruction: input.systemInstruction,
          temperature: 0.2,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal: AbortSignal.timeout(timeoutMs),
        },
      });
    } catch (error) {
      if (attempt === 1 && isRetryable(error) && deadline - Date.now() > RETRY_BACKOFF_MS + MIN_RETRY_ATTEMPT_MS) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      console.error('[ai] generateContent failed', { attempt, status: statusOf(error), name: error instanceof Error ? error.name : 'unknown', elapsedMs: Date.now() - startedAt, timeoutMs });
      throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
    }
    return interpret(response);
  }
  throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
}

function interpret(response: GenerateContentResponse): GenerateResult {
  const rawReason = response.candidates?.[0]?.finishReason;
  const finishReason = rawReason === undefined ? undefined : String(rawReason);
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason !== undefined || (finishReason !== undefined && BLOCKING_FINISH_REASONS.includes(finishReason))) {
    console.warn('[ai] generation blocked', { finishReason, blockReason: blockReason === undefined ? undefined : String(blockReason) });
    return { kind: 'blocked', text: '', finishReason: finishReason ?? 'PROMPT_BLOCKED' };
  }
  const text = response.text?.trim();
  if (!text) {
    console.error('[ai] empty generation', { finishReason });
    throw new AppError('PROVIDER_UNAVAILABLE', PROVIDER_ERROR);
  }
  if (finishReason === 'MAX_TOKENS') console.warn('[ai] answer truncated by token limit', { finishReason });
  return { kind: 'answer', text, finishReason };
}
