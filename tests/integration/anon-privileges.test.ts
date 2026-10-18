import { describe, expect, it } from 'vitest';
import { anonClient } from './helpers';

const INSUFFICIENT_PRIVILEGE = '42501';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// A signed-out visitor only holds the publishable key. Every server-only function must be closed to it.
describe('anon (publishable key, signed out) privileges', () => {
  it('should not allow rpc hit_rate_limit', async () => {
    const { data, error } = await anonClient().rpc('hit_rate_limit', { p_key: `it:${crypto.randomUUID()}`, p_window_seconds: 60, p_max: 3 });
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(data).toBeNull();
  });

  it.each(['rate_limits', 'usage_counters'] as const)('should not expose rows of %s', async (table) => {
    const { data, error } = await anonClient().from(table).select('*');
    if (error) expect(error.code).toBe(INSUFFICIENT_PRIVILEGE);
    else expect(data).toEqual([]);
  });

  it('should not allow rpc reserve_message', async () => {
    const { error } = await anonClient().rpc('reserve_message', { p_owner_id: ZERO_UUID, p_limit: 1000 });
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('should not allow rpc create_document', async () => {
    const { error } = await anonClient().rpc('create_document', { p_chatbot_id: ZERO_UUID, p_file_name: 'a.txt', p_size_bytes: 1, p_max_documents: 1000 });
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('should not allow rpc complete_document', async () => {
    const { error } = await anonClient().rpc('complete_document', { p_document_id: ZERO_UUID, p_size_bytes: 1, p_chunks: [] });
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('should not allow rpc match_chunks', async () => {
    const embedding = `[${Array<number>(768).fill(0).join(',')}]`;
    const { error } = await anonClient().rpc('match_chunks', { p_chatbot_id: ZERO_UUID, p_embedding: embedding, p_match_count: 1, p_min_similarity: 0 });
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
