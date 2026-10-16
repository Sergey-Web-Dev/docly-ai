import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { AppError } from '@/lib/errors';
import type { FileKind } from '@/lib/ingest/validate-file';

export async function extractText(bytes: Uint8Array, kind: FileKind): Promise<string> {
  return kind === 'pdf' ? extractFromPdf(bytes) : extractFromTxt(bytes);
}

async function extractFromPdf(bytes: Uint8Array): Promise<string> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  } catch {
    throw new AppError('INGESTION_FAILED', "We couldn't read this PDF. It may be damaged or password-protected.");
  } finally {
    await pdf?.loadingTask.destroy();
  }
}

function extractFromTxt(bytes: Uint8Array): string {
  try {
    // ignoreBOM: false strips the BOM from the output
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new AppError('INGESTION_FAILED', 'This text file is not UTF-8 encoded.');
  }
}
