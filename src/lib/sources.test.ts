import { describe, expect, it } from 'vitest';
import { extractSources, selectDocumentIds, toAnswerSources } from '@/lib/sources';

describe('extractSources', () => {
  it('should strip a trailing SOURCES line and return its indices', () => {
    expect(extractSources('You get 20 days.\nSOURCES: 1, 3', 5)).toEqual({ answer: 'You get 20 days.', indices: [1, 3] });
  });

  it.each([
    ['lowercase', 'sources: 2'],
    ['brackets', 'SOURCES: [2]'],
    ['dash separator', 'Sources - 2'],
    ['em dash separator', 'Sources — 2'],
    ['singular', 'Source: 2'],
    ['markdown bold', '**SOURCES:** 2'],
    ['blank lines and trailing spaces', '\n\nSOURCES: 2  \n\n'],
    ['indented', '   SOURCES: 2'],
    ['bracketed with parentheses', 'Sources: (2)'],
  ])('should strip a %s variant', (_name, tail) => {
    expect(extractSources(`Answer text.\n${tail}`, 5)).toEqual({ answer: 'Answer text.', indices: [2] });
  });

  it('should drop out-of-range, zero and duplicate indices and keep the order of first use', () => {
    expect(extractSources('A\nSOURCES: 3, 9, 0, 3, 1, 6', 5).indices).toEqual([3, 1]);
  });

  it('should return no indices and the full trimmed text when there is no SOURCES line', () => {
    expect(extractSources('  Plain answer.\n', 5)).toEqual({ answer: 'Plain answer.', indices: [] });
  });

  it.each([['Source: the HR team'], ['Sources - see the handbook'], ['Source: n/a']])('should keep a content line without digits after the separator: %s', (line) => {
    const text = `Answer.\n${line}`;
    expect(extractSources(text, 5)).toEqual({ answer: text, indices: [] });
  });

  it('should not strip the word sources when it is in the middle of the answer', () => {
    const text = 'Sources: see below.\nThe policy says 20 days.';
    expect(extractSources(text, 5)).toEqual({ answer: text, indices: [] });
  });

  it('should return an empty answer when the text is only a SOURCES line', () => {
    expect(extractSources('SOURCES: 1', 2)).toEqual({ answer: '', indices: [1] });
  });

  it('should ignore huge numbers instead of overflowing', () => {
    expect(extractSources('A\nSOURCES: 99999999999999999999, 2', 5).indices).toEqual([2]);
  });
});

describe('selectDocumentIds', () => {
  const chunks = [
    { documentId: 'd1', similarity: 0.6 },
    { documentId: 'd1', similarity: 0.9 },
    { documentId: 'd2', similarity: 0.7 },
    { documentId: 'd3', similarity: 0.65 },
    { documentId: 'd4', similarity: 0.58 },
  ];

  it('should map indices to unique documents in order of first use', () => {
    expect(selectDocumentIds([3, 1, 2], chunks)).toEqual(['d2', 'd1']);
  });

  it('should keep at most 3 documents', () => {
    expect(selectDocumentIds([1, 3, 4, 5], chunks)).toEqual(['d1', 'd2', 'd3']);
  });

  it('should fall back to the document of the most similar chunk when no indices are given', () => {
    expect(selectDocumentIds([], chunks)).toEqual(['d1']);
  });

  it('should return no documents when there are no chunks', () => {
    expect(selectDocumentIds([], [])).toEqual([]);
  });
});

describe('toAnswerSources', () => {
  const names = new Map([['d1', 'a.pdf'], ['d2', 'b.txt']]);

  it('should attach file names in order', () => {
    expect(toAnswerSources(['d2', 'd1'], names)).toEqual([
      { documentId: 'd2', fileName: 'b.txt' },
      { documentId: 'd1', fileName: 'a.pdf' },
    ]);
  });

  it('should skip documents whose file name is unknown', () => {
    expect(toAnswerSources(['d1', 'd9'], names)).toEqual([{ documentId: 'd1', fileName: 'a.pdf' }]);
  });
});
