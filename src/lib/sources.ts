export const MAX_SOURCES = 3;

export interface AnswerSource {
  readonly documentId: string;
  readonly fileName: string;
}

export interface ExtractedSources {
  readonly answer: string;
  readonly indices: readonly number[];
}

export interface SourceChunk {
  readonly documentId: string;
  readonly similarity: number;
}

// Last line only: "SOURCES: 1, 3" in any case, optionally bold/bracketed, with ":" or a dash as separator.
const SOURCES_LINE = /(?:^|\n)[ \t>*_#`[(]*sources?[ \t*_`\])]*[:\-–—][^\n]*$/i;

// Strips a trailing SOURCES line from the model reply and returns the valid 1-based indices it listed.
export function extractSources(text: string, chunkCount: number): ExtractedSources {
  const trimmed = text.trim();
  const match = SOURCES_LINE.exec(trimmed);
  if (!match) return { answer: trimmed, indices: [] };
  const listed = (match[0].match(/\d+/g) ?? []).map(Number);
  const valid = listed.filter((index) => Number.isSafeInteger(index) && index >= 1 && index <= chunkCount);
  return { answer: trimmed.slice(0, match.index).trim(), indices: [...new Set(valid)] };
}

// Maps 1-based chunk indices to unique documents (first use wins, at most MAX_SOURCES).
// Without indices it falls back to the document of the most similar chunk.
export function selectSources(indices: readonly number[], chunks: readonly SourceChunk[], fileNames: ReadonlyMap<string, string>): AnswerSource[] {
  const documentIds = indices.length > 0 ? indices.map((index) => chunks[index - 1]?.documentId) : [mostSimilarDocumentId(chunks)];
  const sources: AnswerSource[] = [];
  for (const documentId of documentIds) {
    const fileName = documentId === undefined ? undefined : fileNames.get(documentId);
    if (documentId === undefined || fileName === undefined) continue;
    if (sources.some((source) => source.documentId === documentId)) continue;
    sources.push({ documentId, fileName });
    if (sources.length === MAX_SOURCES) break;
  }
  return sources;
}

function mostSimilarDocumentId(chunks: readonly SourceChunk[]): string | undefined {
  let best: SourceChunk | undefined;
  for (const chunk of chunks) if (best === undefined || chunk.similarity > best.similarity) best = chunk;
  return best?.documentId;
}
