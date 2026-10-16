import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { chunkText, normalizeText, prepareChunks } from '@/lib/ingest/chunk-text';
import { CHUNK_SIZE, MAX_CHUNKS, MAX_TEXT_CHARS } from '@/lib/rag-config';

function sentences(count: number): string {
  return Array.from({ length: count }, (_, i) => `Sentence number ${i} talks about topic${i} in some detail.`).join(' ');
}

describe('normalizeText', () => {
  it('should collapse whitespace and strip NUL when text is messy', () => {
    expect(normalizeText('a\r\n\r\n\r\n\tb  c\u0000')).toBe('a\n\nb c');
  });

  it('should replace lone surrogates with U+FFFD', () => {
    expect(normalizeText('a\ud800b\udc00c')).toBe('a\ufffdb\ufffdc');
  });

  it('should keep valid surrogate pairs', () => {
    expect(normalizeText('hi \u{1F600}')).toBe('hi \u{1F600}');
  });
});

describe('chunkText', () => {
  it('should return no chunks when text is empty or whitespace', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('  \n\t ')).toEqual([]);
  });

  it('should return the text as a single chunk when it is short', () => {
    expect(chunkText('Short text.')).toEqual(['Short text.']);
  });

  it('should bound every chunk and cover all words when text is long', () => {
    const text = sentences(120).replace(/(topic5\d)\./g, '$1.\n\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= CHUNK_SIZE)).toBe(true);
    const joined = chunks.join(' ');
    for (const word of text.split(/\s+/)) expect(joined).toContain(word);
  });

  it('should overlap consecutive chunks when text is long', () => {
    const chunks = chunkText(sentences(120));
    const first = chunks[0] ?? '';
    const secondStart = (chunks[1] ?? '').split(' ').slice(0, 3).join(' ');
    expect(first.endsWith(secondStart) || first.includes(secondStart)).toBe(true);
  });

  it('should split a single huge word when it has no spaces', () => {
    const word = 'x'.repeat(5000);
    const chunks = chunkText(word);
    expect(chunks.every((chunk) => chunk.length <= CHUNK_SIZE)).toBe(true);
    expect(chunks.join('').replace(/ /g, '').length).toBeGreaterThanOrEqual(5000);
  });
});

describe('prepareChunks', () => {
  it('should throw INGESTION_FAILED when text is too short', () => {
    expect(() => prepareChunks('tiny')).toThrow(AppError);
    expect(() => prepareChunks('tiny')).toThrow("We couldn't find readable text in this file. Scanned PDFs are not supported.");
  });

  it('should cap chunks at MAX_CHUNKS when text is huge', () => {
    const chunks = prepareChunks(sentences(10_000));
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS);
  });

  it('should cap the text at MAX_TEXT_CHARS when text is huge', () => {
    const chunks = prepareChunks('word '.repeat(MAX_TEXT_CHARS));
    expect(chunks.join('').length).toBeLessThanOrEqual(MAX_CHUNKS * CHUNK_SIZE);
  });
});
