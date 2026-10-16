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
});

describe('generateAnswer', () => {
  const input = { systemInstruction: 'sys', prompt: 'question' };

  function httpError(status: number): Error {
    return Object.assign(new Error('provider failure'), { status });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    generateContent.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_CHAT_MODEL = 'test-chat-model';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should pass model, system instruction, temperature, token limit and abort signal when generating', async () => {
    generateContent.mockResolvedValue({ text: '  Answer.  ' });
    await expect(generateAnswer(input)).resolves.toBe('Answer.');
    const call = generateContent.mock.calls[0]?.[0] as { model: string; contents: string; config: Record<string, unknown> };
    expect(call).toMatchObject({
      model: 'test-chat-model',
      contents: 'question',
      config: { systemInstruction: 'sys', temperature: 0.2, maxOutputTokens: 512 },
    });
    expect(call.config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('should retry once and succeed when the first call returns 503', async () => {
    generateContent.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce({ text: 'ok' });
    const result = generateAnswer(input);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toBe('ok');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('should retry once when the first call returns 429', async () => {
    generateContent.mockRejectedValueOnce(httpError(429)).mockResolvedValueOnce({ text: 'ok' });
    const result = generateAnswer(input);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toBe('ok');
  });

  it('should throw PROVIDER_UNAVAILABLE when the retry also returns 503', async () => {
    generateContent.mockRejectedValue(httpError(503));
    const result = generateAnswer(input);
    const assertion = expect(result).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: PROVIDER_ERROR });
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('should not retry when the error is a 400', async () => {
    generateContent.mockRejectedValue(httpError(400));
    await expect(generateAnswer(input)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('should throw PROVIDER_UNAVAILABLE when the response text is empty', async () => {
    generateContent.mockResolvedValue({ text: '   ' });
    await expect(generateAnswer(input)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', message: PROVIDER_ERROR });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
