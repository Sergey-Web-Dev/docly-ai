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
