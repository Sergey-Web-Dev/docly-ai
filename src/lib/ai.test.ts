import { beforeEach, describe, expect, it, vi } from 'vitest';

const embedContent = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { embedContent };
  },
}));

import { embedTexts } from '@/lib/ai';

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
});
