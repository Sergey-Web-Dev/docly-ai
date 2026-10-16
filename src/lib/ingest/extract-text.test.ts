import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { extractText } from '@/lib/ingest/extract-text';

async function buildPdf(text: string | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  if (text) page.drawText(text, { font: await doc.embedFont(StandardFonts.Helvetica), x: 50, y: 700, size: 14 });
  return doc.save();
}

describe('extractText', () => {
  it('should return the page text when the pdf has text', async () => {
    const text = await extractText(await buildPdf('Vacation policy: 20 days'), 'pdf');
    expect(text).toContain('Vacation policy: 20 days');
  });

  it('should return an empty string when the pdf page is empty', async () => {
    expect((await extractText(await buildPdf(null), 'pdf')).trim()).toBe('');
  });

  it('should throw INGESTION_FAILED when the pdf is corrupt', async () => {
    const bytes = new TextEncoder().encode('%PDF-garbage');
    const error = await extractText(bytes, 'pdf').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'INGESTION_FAILED', message: "We couldn't read this PDF. It may be damaged or password-protected." });
  });

  it('should strip the BOM when the txt is UTF-8 with BOM', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('hello')]);
    expect(await extractText(bytes, 'txt')).toBe('hello');
  });

  it('should throw INGESTION_FAILED when the txt is not UTF-8', async () => {
    const error = await extractText(new Uint8Array([0xff, 0xfe, 0xfd]), 'txt').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'INGESTION_FAILED', message: 'This text file is not UTF-8 encoded.' });
  });
});
