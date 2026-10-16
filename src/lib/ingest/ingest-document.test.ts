import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/database.types';
import { AppError } from '@/lib/errors';

const embedTexts = vi.fn();
const extractText = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai', () => ({ embedTexts: (texts: string[]) => embedTexts(texts) }));
vi.mock('@/lib/ingest/extract-text', () => ({ extractText: (...args: unknown[]) => extractText(...args) }));

import { ingestDocument } from '@/lib/ingest/ingest-document';

const TARGET = { id: 'doc-1', chatbotId: 'bot-1', fileName: 'notes.txt', storagePath: 'user/doc-1' };
const LONG_TEXT = `${'Alpha beta gamma delta. '.repeat(10)}`;

interface Fake {
  readonly admin: SupabaseClient<Database>;
  readonly calls: string[];
  readonly rpc: ReturnType<typeof vi.fn>;
  readonly statusUpdate: ReturnType<typeof vi.fn>;
}

interface FakeOptions {
  readonly rpcError?: { code: string } | null;
  readonly failStep?: 'set_failed' | 'delete_chunks' | 'remove_object';
  readonly throwStep?: 'set_failed' | 'delete_chunks' | 'remove_object';
}

function fakeAdmin(options: FakeOptions = {}): Fake {
  const calls: string[] = [];
  const step = (name: 'set_failed' | 'delete_chunks' | 'remove_object'): Promise<{ error: { code: string } | null }> => {
    calls.push(name);
    if (options.throwStep === name) return Promise.reject(new Error('network'));
    return Promise.resolve({ error: options.failStep === name ? { code: 'XX000' } : null });
  };
  const rpc = vi.fn((name: string) => {
    calls.push(name);
    return Promise.resolve({ error: options.rpcError ?? null });
  });
  const statusUpdate = vi.fn();
  const admin = {
    rpc,
    storage: {
      from: () => ({
        download: () => Promise.resolve({ data: { arrayBuffer: () => Promise.resolve(new TextEncoder().encode('hello').buffer) }, error: null }),
        remove: () => step('remove_object'),
      }),
    },
    from: (table: string) =>
      table === 'documents'
        ? {
            update: (values: unknown) => {
              statusUpdate(values);
              return { eq: () => ({ eq: (column: string, value: string) => { statusUpdate(column, value); return step('set_failed'); } }) };
            },
          }
        : { delete: () => ({ eq: () => step('delete_chunks') }) },
  } as unknown as SupabaseClient<Database>;
  return { admin, calls, rpc, statusUpdate };
}

describe('ingestDocument', () => {
  beforeEach(() => {
    embedTexts.mockReset();
    extractText.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('should call complete_document with indexed chunk rows when ingestion succeeds', async () => {
    extractText.mockResolvedValue(LONG_TEXT);
    embedTexts.mockImplementation((texts: string[]) => Promise.resolve(texts.map((_, i) => [i, 0.5])));
    const fake = fakeAdmin();

    const result = await ingestDocument(fake.admin, TARGET);

    expect(result).toEqual({ status: 'ready' });
    expect(fake.calls).toEqual(['complete_document']);
    const [name, args] = fake.rpc.mock.calls[0] as [string, { p_document_id: string; p_size_bytes: number; p_chunks: { chunk_index: number; content: string; embedding: string }[] }];
    expect(name).toBe('complete_document');
    expect(args.p_document_id).toBe('doc-1');
    expect(args.p_size_bytes).toBe(5);
    const texts = embedTexts.mock.calls[0]?.[0] as string[];
    expect(args.p_chunks).toHaveLength(texts.length);
    args.p_chunks.forEach((row, index) => {
      expect(row).toEqual({ chunk_index: index, content: texts[index], embedding: JSON.stringify([index, 0.5]) });
    });
  });

  it('should fail without calling complete_document when the text is empty', async () => {
    extractText.mockResolvedValue('   ');
    const fake = fakeAdmin();

    const result = await ingestDocument(fake.admin, TARGET);

    expect(result.status).toBe('failed');
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.calls).toEqual(['set_failed', 'delete_chunks', 'remove_object']);
    expect(fake.statusUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(fake.statusUpdate).toHaveBeenCalledWith('status', 'processing');
  });

  it('should fail with the provider message when embedding fails', async () => {
    extractText.mockResolvedValue(LONG_TEXT);
    embedTexts.mockRejectedValue(new AppError('PROVIDER_UNAVAILABLE', 'AI down'));
    const fake = fakeAdmin();

    const result = await ingestDocument(fake.admin, TARGET);

    expect(result).toEqual({ status: 'failed', errorMessage: 'AI down' });
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.calls).toEqual(['set_failed', 'delete_chunks', 'remove_object']);
  });

  it('should fail with a generic message and log the code when complete_document errors', async () => {
    extractText.mockResolvedValue(LONG_TEXT);
    embedTexts.mockImplementation((texts: string[]) => Promise.resolve(texts.map(() => [0.1])));
    const fake = fakeAdmin({ rpcError: { code: 'DQ003' } });

    const result = await ingestDocument(fake.admin, TARGET);

    expect(result).toEqual({ status: 'failed', errorMessage: 'Processing failed. Please delete the file and try again.' });
    expect(console.error).toHaveBeenCalledWith('[ingest] failed', { documentId: 'doc-1', code: 'DQ003' });
    expect(fake.calls).toEqual(['complete_document', 'set_failed', 'delete_chunks', 'remove_object']);
  });

  it.each(['set_failed', 'delete_chunks', 'remove_object'] as const)('should not throw and keep cleaning up when %s returns an error', async (failStep) => {
    extractText.mockResolvedValue('   ');
    const fake = fakeAdmin({ failStep });

    await expect(ingestDocument(fake.admin, TARGET)).resolves.toMatchObject({ status: 'failed' });
    expect(fake.calls).toEqual(['set_failed', 'delete_chunks', 'remove_object']);
    expect(console.error).toHaveBeenCalledWith('[ingest] cleanup step failed', { documentId: 'doc-1', step: failStep, code: 'XX000' });
  });

  it.each(['set_failed', 'delete_chunks', 'remove_object'] as const)('should not throw when %s rejects', async (throwStep) => {
    extractText.mockResolvedValue('   ');
    const fake = fakeAdmin({ throwStep });

    await expect(ingestDocument(fake.admin, TARGET)).resolves.toMatchObject({ status: 'failed' });
    expect(fake.calls).toEqual(['set_failed', 'delete_chunks', 'remove_object']);
  });
});
