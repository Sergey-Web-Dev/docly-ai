import { describe, expect, it } from 'vitest';
import { parseSources, sourcesLabel } from './chat-sources';
import { MAX_SOURCES } from './sources';

describe('parseSources', () => {
  it('should return an empty list when the value is missing or not an array', () => {
    expect(parseSources(undefined)).toEqual([]);
    expect(parseSources(null)).toEqual([]);
    expect(parseSources('handbook.pdf')).toEqual([]);
    expect(parseSources({ documentId: 'a', fileName: 'b' })).toEqual([]);
  });

  it('should keep valid entries in order', () => {
    const input = [
      { documentId: 'd1', fileName: 'employee-handbook.pdf' },
      { documentId: 'd2', fileName: 'faq.txt' },
    ];
    expect(parseSources(input)).toEqual(input);
  });

  it('should drop entries that are malformed or have blank values', () => {
    const input = [
      null,
      'x',
      { documentId: 'd1' },
      { fileName: 'a.pdf' },
      { documentId: 7, fileName: 'a.pdf' },
      { documentId: 'd2', fileName: '   ' },
      { documentId: 'd3', fileName: 'ok.pdf' },
    ];
    expect(parseSources(input)).toEqual([{ documentId: 'd3', fileName: 'ok.pdf' }]);
  });

  it('should drop duplicate documents and keep the first', () => {
    const input = [
      { documentId: 'd1', fileName: 'a.pdf' },
      { documentId: 'd1', fileName: 'a-again.pdf' },
    ];
    expect(parseSources(input)).toEqual([{ documentId: 'd1', fileName: 'a.pdf' }]);
  });

  it('should keep at most MAX_SOURCES entries', () => {
    const input = Array.from({ length: 6 }, (_, i) => ({ documentId: `d${i}`, fileName: `f${i}.pdf` }));
    expect(parseSources(input)).toHaveLength(MAX_SOURCES);
  });

  it('should strip extra properties so nothing else reaches the UI', () => {
    const result = parseSources([{ documentId: 'd1', fileName: 'a.pdf', secret: 'x' }]);
    expect(result[0]).toEqual({ documentId: 'd1', fileName: 'a.pdf' });
  });
});

describe('sourcesLabel', () => {
  it('should be singular for one source and plural otherwise', () => {
    expect(sourcesLabel(1)).toBe('Source');
    expect(sourcesLabel(2)).toBe('Sources');
    expect(sourcesLabel(3)).toBe('Sources');
  });
});
