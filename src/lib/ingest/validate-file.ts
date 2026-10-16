import { MAX_FILE_BYTES } from '@/lib/rag-config';

export type FileKind = 'pdf' | 'txt';
export interface FileCandidate {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly bytes?: Uint8Array; // omitted in the browser pre-check
}
export type FileValidation = { readonly ok: true; readonly kind: FileKind } | { readonly ok: false; readonly error: string };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const MIME_BY_KIND: Readonly<Record<FileKind, readonly string[]>> = {
  pdf: ['application/pdf', ''],
  txt: ['text/plain', ''],
};

export function validateFile(file: FileCandidate): FileValidation {
  const kind = kindFromName(file.name);
  if (!kind) return { ok: false, error: 'Only PDF and TXT files are supported.' };
  if (file.name.length > 255) return { ok: false, error: 'File name is too long.' };
  if (file.size <= 0) return { ok: false, error: 'The file is empty.' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: 'Files must be 5 MB or smaller.' };
  if (!MIME_BY_KIND[kind].includes(file.type.split(';')[0]?.trim() ?? '')) return { ok: false, error: 'Only PDF and TXT files are supported.' };
  if (!file.bytes) return { ok: true, kind };
  if (kind === 'pdf' && !startsWith(file.bytes, PDF_MAGIC)) return { ok: false, error: 'This file is not a valid PDF.' };
  if (kind === 'txt' && file.bytes.subarray(0, 4096).includes(0)) return { ok: false, error: 'This file is not a valid text file.' };
  return { ok: true, kind };
}

function kindFromName(name: string): FileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.txt')) return 'txt';
  return null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}
