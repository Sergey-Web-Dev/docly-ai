import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const embedContent = vi.fn();
const generateContent = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { embedContent, generateContent };
  },
}));

import { embedQuery, embedTexts, generateAnswer } from '@/lib/ai';
import { GENERATION_TIMEOUT_MS } from '@/lib/rag-config';

const PROVIDER_ERROR = 'The AI service is unavailable right now. Please try again in a minute.';

function vectorsFor(count: number, length = 768): { embeddings: { values: number[] }[] } {
  return { embeddings: Array.from({ length: count }, (_, i) => ({ values: Array<number>(length).fill(i) })) };
}

describe('embedTexts', () => {
  beforeEach(() => {
    embedContent.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_EMBEDDING_MODEL = 'test-embedding-model';
  });

  it('should batch 100 texts per call and keep order when embedding 150 texts', async () => {
    embedContent.mockImplementation(({ contents }: { contents: string[] }) => Promise.resolve(vectorsFor(contents.length)));
    const result = await embedTexts(Array.from({ length: 150 }, (_, i) => `text ${i}`));
    expect(result).toHaveLength(150);
    expect(embedContent).toHaveBeenCalledTimes(2);
    expect(embedContent.mock.calls[0]?.[0]).toMatchObject({
      model: 'test-embedding-model',
      config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 },
    });
    expect((embedContent.mock.calls[0]?.[0] as { contents: string[] }).contents).toHaveLength(100);
    expect((embedContent.mock.calls[1]?.[0] as { contents: string[] }).contents).toHaveLength(50);
    expect(result[100]?.[0]).toBe(0);
  });

  it('should throw PROVIDER_UNAVAILABLE when a vector has the wrong length', async () => {
    embedContent.mockResolvedValue(vectorsFor(1, 10));
    await expect(embedTexts(['a'])).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: PROVIDER_ERROR });
  });

  it('should throw PROVIDER_UNAVAILABLE when the vector count mismatches', async () => {
    embedContent.mockResolvedValue(vectorsFor(1));
    await expect(embedTexts(['a', 'b'])).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('should throw PROVIDER_UNAVAILABLE when the SDK throws', async () => {
    embedContent.mockRejectedValue(new Error('quota'));
    await expect(embedTexts(['a'])).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: PROVIDER_ERROR });
  });

  it('should pass an abort signal so a hung call is bounded', async () => {
    embedContent.mockResolvedValue(vectorsFor(1));
    await embedTexts(['a']);
    const config = (embedContent.mock.calls[0]?.[0] as { config: { abortSignal: AbortSignal } }).config;
    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('should throw PROVIDER_UNAVAILABLE when one of several batches fails', async () => {
    embedContent.mockImplementation(({ contents }: { contents: string[] }) =>
      contents.length === 100 ? Promise.resolve(vectorsFor(100)) : Promise.reject(new Error('timeout')));
    await expect(embedTexts(Array.from({ length: 150 }, (_, i) => `t${i}`))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('embedQuery', () => {
  beforeEach(() => {
    embedContent.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_EMBEDDING_MODEL = 'test-embedding-model';
  });

  it('should embed one text with the RETRIEVAL_QUERY task type', async () => {
    embedContent.mockResolvedValue(vectorsFor(1));
    const vector = await embedQuery('hello');
    expect(vector).toHaveLength(768);
    expect(embedContent.mock.calls[0]?.[0]).toMatchObject({ contents: ['hello'], config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 } });
  });

  it('should bound the query embedding to about 5 s and ingestion batches to 20 s', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    embedContent.mockImplementation(({ contents }: { contents: string[] }) => Promise.resolve(vectorsFor(contents.length)));
    await embedQuery('hello');
    await embedTexts(['a']);
    expect(spy.mock.calls.map((call) => call[0])).toEqual([5_000, 20_000]);
    spy.mockRestore();
  });
});

describe('generateAnswer', () => {
  const input = { systemInstruction: 'sys', prompt: 'question' };
  const deadline = (): number => Date.now() + 25_000;

  function httpError(status: number): Error {
    return Object.assign(new Error('provider failure'), { status });
  }

  function reply(text: string | undefined, finishReason = 'STOP', extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { text, candidates: [{ finishReason }], ...extra };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    generateContent.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_CHAT_MODEL = 'test-chat-model';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should pass model, system instruction, temperature, token limit and abort signal when generating', async () => {
    generateContent.mockResolvedValue(reply('  Answer.  '));
    await expect(generateAnswer(input, deadline())).resolves.toEqual({ kind: 'answer', text: 'Answer.', finishReason: 'STOP' });
    const call = generateContent.mock.calls[0]?.[0] as { model: string; contents: string; config: Record<string, unknown> };
    expect(call).toMatchObject({
      model: 'test-chat-model',
      contents: 'question',
      config: { systemInstruction: 'sys', temperature: 0.2, maxOutputTokens: 1024 },
    });
    expect(call.config).not.toHaveProperty('thinkingConfig');
    expect(call.config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('should cap the attempt timeout at GENERATION_TIMEOUT_MS and at the time left before the deadline', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    generateContent.mockResolvedValue(reply('ok'));
    await generateAnswer(input, deadline());
    await generateAnswer(input, Date.now() + 3_000);
    expect(spy.mock.calls.map((call) => call[0])).toEqual([GENERATION_TIMEOUT_MS, 3_000]);
    spy.mockRestore();
  });

  it('should retry once and succeed when the first call returns 503', async () => {
    generateContent.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce(reply('ok'));
    const result = generateAnswer(input, deadline());
    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toMatchObject({ text: 'ok' });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('should retry once when the first call returns 429', async () => {
    generateContent.mockRejectedValueOnce(httpError(429)).mockResolvedValueOnce(reply('ok'));
    const result = generateAnswer(input, deadline());
    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toMatchObject({ text: 'ok' });
  });

  it('should throw PROVIDER_UNAVAILABLE when the retry also returns 503', async () => {
    generateContent.mockRejectedValue(httpError(503));
    const result = generateAnswer(input, deadline());
    const assertion = expect(result).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: PROVIDER_ERROR });
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('should not retry when the error is a 400', async () => {
    generateContent.mockRejectedValue(httpError(400));
    await expect(generateAnswer(input, deadline())).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it.each(['AbortError', 'TimeoutError'])('should not retry a %s even when it carries a retryable status', async (name) => {
    generateContent.mockRejectedValue(Object.assign(new Error('aborted'), { name, status: 503 }));
    await expect(generateAnswer(input, deadline())).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('should not retry a 503 when the time left is too short for backoff plus an attempt', async () => {
    generateContent.mockRejectedValue(httpError(503));
    await expect(generateAnswer(input, Date.now() + 7_000)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('should throw without calling the provider when the deadline already passed', async () => {
    await expect(generateAnswer(input, Date.now() - 1)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('should throw PROVIDER_UNAVAILABLE when the response text is empty', async () => {
    generateContent.mockResolvedValue(reply('   '));
    await expect(generateAnswer(input, deadline())).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: PROVIDER_ERROR });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it.each(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'])('should return blocked when finishReason is %s', async (reason) => {
    generateContent.mockResolvedValue(reply('partial text', reason));
    await expect(generateAnswer(input, deadline())).resolves.toEqual({ kind: 'blocked', text: '', finishReason: reason });
  });

  it('should return blocked when the prompt feedback has a block reason', async () => {
    generateContent.mockResolvedValue({ text: undefined, candidates: undefined, promptFeedback: { blockReason: 'SAFETY' } });
    await expect(generateAnswer(input, deadline())).resolves.toMatchObject({ kind: 'blocked', text: '' });
  });

  it('should throw PROVIDER_UNAVAILABLE when MAX_TOKENS produced no text', async () => {
    generateContent.mockResolvedValue(reply('', 'MAX_TOKENS'));
    await expect(generateAnswer(input, deadline())).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('should return the text when MAX_TOKENS produced partial text', async () => {
    generateContent.mockResolvedValue(reply('Partial answer', 'MAX_TOKENS'));
    await expect(generateAnswer(input, deadline())).resolves.toEqual({ kind: 'answer', text: 'Partial answer', finishReason: 'MAX_TOKENS' });
  });
});
