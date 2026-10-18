export const MAX_SOURCES = 3;

export interface ChatSource {
  readonly documentId: string;
  readonly fileName: string;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates the `sources` field of a `/api/chat` response. A missing or malformed value (an older backend) is
 * treated as "no sources": malformed entries and duplicate documents are dropped, extra properties are stripped.
 */
export function parseSources(value: unknown): readonly ChatSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: ChatSource[] = [];
  for (const entry of value as readonly unknown[]) {
    if (sources.length >= MAX_SOURCES) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const { documentId, fileName } = entry as Record<string, unknown>;
    if (!isNonBlankString(documentId) || !isNonBlankString(fileName) || seen.has(documentId)) continue;
    seen.add(documentId);
    sources.push({ documentId, fileName });
  }
  return sources;
}

export function sourcesLabel(count: number): string {
  return count === 1 ? 'Source' : 'Sources';
}
