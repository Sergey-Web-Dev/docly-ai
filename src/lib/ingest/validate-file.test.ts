import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES } from '@/lib/rag-config';
import { validateFile } from '@/lib/ingest/validate-file';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 content');
const TXT_BYTES = new TextEncoder().encode('hello world');

describe('validateFile', () => {
  it('should accept a pdf when it has the PDF header and mime type', () => {
    expect(validateFile({ name: 'a.pdf', type: 'application/pdf', size: PDF_BYTES.length, bytes: PDF_BYTES })).toEqual({ ok: true, kind: 'pdf' });
  });

  it('should accept a txt when the extension is uppercase', () => {
    expect(validateFile({ name: 'A.TXT', type: 'text/plain', size: TXT_BYTES.length, bytes: TXT_BYTES })).toEqual({ ok: true, kind: 'txt' });
  });

  it('should accept a file without bytes when only metadata is checked', () => {
    expect(validateFile({ name: 'a.txt', type: 'text/plain', size: 10 })).toEqual({ ok: true, kind: 'txt' });
  });

  it('should reject an unsupported extension', () => {
    expect(validateFile({ name: 'a.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 10 }))
      .toEqual({ ok: false, error: 'Only PDF and TXT files are supported.' });
  });

  it('should reject an empty file', () => {
    expect(validateFile({ name: 'a.txt', type: 'text/plain', size: 0 })).toEqual({ ok: false, error: 'The file is empty.' });
  });

  it('should reject a NaN size', () => {
    expect(validateFile({ name: 'a.txt', type: 'text/plain', size: Number.NaN })).toEqual({ ok: false, error: 'The file is empty.' });
  });

  it('should reject a file larger than 5 MB', () => {
    expect(validateFile({ name: 'a.txt', type: 'text/plain', size: MAX_FILE_BYTES + 1 })).toEqual({ ok: false, error: 'Files must be 5 MB or smaller.' });
  });

  it('should reject a pdf without the magic bytes', () => {
    expect(validateFile({ name: 'a.pdf', type: 'application/pdf', size: 11, bytes: TXT_BYTES })).toEqual({ ok: false, error: 'This file is not a valid PDF.' });
  });

  it('should reject a txt containing a NUL byte', () => {
    const bytes = new Uint8Array([104, 105, 0, 33]);
    expect(validateFile({ name: 'a.txt', type: 'text/plain', size: 4, bytes })).toEqual({ ok: false, error: 'This file is not a valid text file.' });
  });

  it('should reject a name longer than 255 characters', () => {
    expect(validateFile({ name: `${'a'.repeat(252)}.txt`, type: 'text/plain', size: 10 })).toEqual({ ok: false, error: 'File name is too long.' });
  });

  it('should reject a mismatched mime type', () => {
    expect(validateFile({ name: 'a.pdf', type: 'image/png', size: 10 })).toEqual({ ok: false, error: 'Only PDF and TXT files are supported.' });
  });
});
