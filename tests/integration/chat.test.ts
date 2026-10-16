import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers';

const DIMENSIONS = 768;

// One-hot vector: unit length, so cosine similarity between different axes is exactly 0.
function axisVector(axis: number): number[] {
  const vector = Array<number>(DIMENSIONS).fill(0);
  vector[axis] = 1;
  return vector;
}

function asParam(vector: number[]): string {
  return JSON.stringify(vector);
}

async function createBot(user: TestUser, name: string): Promise<string> {
  const { data, error } = await user.client.from('chatbots').insert({ owner_id: user.id, name, welcome_message: 'Hi' }).select('id').single();
  if (error || !data) throw error ?? new Error('createBot failed');
  return data.id;
}

async function addDocument(botId: string, status: 'ready' | 'processing' | 'failed', chunks: { content: string; axis: number }[]): Promise<string> {
  const admin = adminClient();
  const path = `it/${botId}/${crypto.randomUUID()}.txt`;
  const doc = await admin.from('documents').insert({ chatbot_id: botId, file_name: `${crypto.randomUUID()}.txt`, size_bytes: 10, status, storage_path: path }).select('id').single();
  if (doc.error || !doc.data) throw doc.error ?? new Error('addDocument failed');
  const rows = chunks.map((chunk, index) => ({
    document_id: doc.data.id,
    chatbot_id: botId,
    chunk_index: index,
    content: chunk.content,
    embedding: asParam(axisVector(chunk.axis)),
  }));
  const inserted = await admin.from('document_chunks').insert(rows);
  if (inserted.error) throw inserted.error;
  return doc.data.id;
}

function currentMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

function previousMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
}

async function counter(ownerId: string): Promise<number | undefined> {
  const { data } = await adminClient().from('usage_counters').select('message_count').eq('owner_id', ownerId).eq('month', currentMonth()).maybeSingle();
  return data?.message_count;
}

describe('message quota functions', () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    alice = await createTestUser('alice-quota');
    bob = await createTestUser('bob-quota');
  });

  afterAll(async () => {
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  it('should not allow an authenticated client to call reserve_message, refund_message or match_chunks', async () => {
    const reserve = await alice.client.rpc('reserve_message', { p_owner_id: alice.id, p_limit: 5 });
    const refund = await alice.client.rpc('refund_message', { p_owner_id: alice.id, p_month: currentMonth() });
    const match = await alice.client.rpc('match_chunks', {
      p_chatbot_id: crypto.randomUUID(),
      p_embedding: asParam(axisVector(0)),
      p_match_count: 5,
      p_min_similarity: 0.5,
    });
    expect(reserve.error?.code).toBe('42501');
    expect(refund.error?.code).toBe('42501');
    expect(match.error?.code).toBe('42501');
  });

  it('should allow exactly the limit and then refuse until a refund frees a slot', async () => {
    const user = await createTestUser('limit');
    try {
      const admin = adminClient();
      const reserve = async (): Promise<string | null> => (await admin.rpc('reserve_message', { p_owner_id: user.id, p_limit: 2 })).data;
      const month = currentMonth();
      expect([await reserve(), await reserve(), await reserve()]).toEqual([month, month, null]);
      expect(await counter(user.id)).toBe(2);
      await admin.rpc('refund_message', { p_owner_id: user.id, p_month: month });
      expect(await reserve()).toBe(month);
    } finally {
      await deleteTestUser(user);
    }
  });

  it('should hand out exactly the limit when reservations race', async () => {
    const user = await createTestUser('race');
    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => adminClient().rpc('reserve_message', { p_owner_id: user.id, p_limit: 3 })),
      );
      expect(results.every((result) => result.error === null)).toBe(true);
      expect(results.filter((result) => result.data !== null)).toHaveLength(3);
      expect(await counter(user.id)).toBe(3);
    } finally {
      await deleteTestUser(user);
    }
  });

  it('should never take the counter below zero when refunding repeatedly', async () => {
    const user = await createTestUser('refund');
    try {
      const admin = adminClient();
      await admin.rpc('reserve_message', { p_owner_id: user.id, p_limit: 5 });
      await admin.rpc('refund_message', { p_owner_id: user.id, p_month: currentMonth() });
      const extra = await admin.rpc('refund_message', { p_owner_id: user.id, p_month: currentMonth() });
      expect(extra.error).toBeNull();
      expect(await counter(user.id)).toBe(0);
    } finally {
      await deleteTestUser(user);
    }
  });

  it('should return the reserved month and refund only the month it is given', async () => {
    const user = await createTestUser('month');
    try {
      const admin = adminClient();
      const previous = previousMonth();
      const seeded = await admin.from('usage_counters').insert({ owner_id: user.id, month: previous, message_count: 4 });
      expect(seeded.error).toBeNull();
      const reserved = await admin.rpc('reserve_message', { p_owner_id: user.id, p_limit: 5 });
      expect(reserved.data).toBe(currentMonth());
      await admin.rpc('refund_message', { p_owner_id: user.id, p_month: previous });
      const rows = await admin.from('usage_counters').select('month, message_count').eq('owner_id', user.id).order('month');
      expect(rows.data).toEqual([{ month: previous, message_count: 3 }, { month: currentMonth(), message_count: 1 }]);
    } finally {
      await deleteTestUser(user);
    }
  });

  it('should reject a usage counter whose month is not the first day of a month', async () => {
    const { error } = await adminClient().from('usage_counters').insert({ owner_id: alice.id, month: '2026-01-15', message_count: 0 });
    expect(error?.code).toBe('23514');
  });

  it('should reject a negative limit', async () => {
    const { error } = await adminClient().rpc('reserve_message', { p_owner_id: alice.id, p_limit: -1 });
    expect(error?.code).toBe('22023');
  });

  it('should let an owner read only their own usage counter', async () => {
    await adminClient().rpc('reserve_message', { p_owner_id: alice.id, p_limit: 5 });
    const own = await alice.client.from('usage_counters').select('message_count').eq('owner_id', alice.id);
    expect(own.error).toBeNull();
    expect(own.data?.[0]?.message_count).toBeGreaterThanOrEqual(1);
    const other = await bob.client.from('usage_counters').select('message_count').eq('owner_id', alice.id);
    expect(other.data).toEqual([]);
  });

  it('should not let an owner write their own usage counter', async () => {
    const update = await alice.client.from('usage_counters').update({ message_count: 0 }).eq('owner_id', alice.id).select('owner_id');
    expect(update.data ?? []).toEqual([]);
    const insert = await alice.client.from('usage_counters').insert({ owner_id: alice.id, month: '2000-01-01', message_count: 0 });
    expect(insert.error).not.toBeNull();
  });
});

describe('match_chunks retrieval', () => {
  let alice: TestUser;
  let bob: TestUser;
  let aliceBotId: string;
  let bobBotId: string;

  async function search(botId: string, vector: number[], minSimilarity = 0.55) {
    return adminClient().rpc('match_chunks', {
      p_chatbot_id: botId,
      p_embedding: asParam(vector),
      p_match_count: 5,
      p_min_similarity: minSimilarity,
    });
  }

  beforeAll(async () => {
    alice = await createTestUser('alice-match');
    bob = await createTestUser('bob-match');
    aliceBotId = await createBot(alice, 'Alice Bot');
    bobBotId = await createBot(bob, 'Bob Bot');
    await addDocument(aliceBotId, 'ready', [{ content: 'alice-axis0', axis: 0 }, { content: 'alice-axis2', axis: 2 }]);
    await addDocument(bobBotId, 'ready', [{ content: 'bob-axis1', axis: 1 }, { content: 'bob-axis0', axis: 0 }]);
    await addDocument(aliceBotId, 'processing', [{ content: 'alice-processing', axis: 3 }]);
    await addDocument(aliceBotId, 'failed', [{ content: 'alice-failed', axis: 3 }]);
  });

  afterAll(async () => {
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  it('should never return another bot chunks even when their vector matches best', async () => {
    const { data, error } = await search(aliceBotId, axisVector(1));
    expect(error).toBeNull();
    expect(data).toEqual([]);
    const own = await search(aliceBotId, axisVector(0));
    expect(own.data?.map((row) => row.content)).toEqual(['alice-axis0']);
  });

  it('should not return chunks of processing or failed documents', async () => {
    const { data, error } = await search(aliceBotId, axisVector(3), 0.1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('should return the similar chunk first with similarity near 1 and filter orthogonal ones', async () => {
    const mixed = axisVector(0).map((value, index) => (index === 2 ? 0.3 : value));
    const { data, error } = await search(aliceBotId, mixed, 0.2);
    expect(error).toBeNull();
    expect(data?.map((row) => row.content)).toEqual(['alice-axis0', 'alice-axis2']);
    expect(data?.[0]?.similarity).toBeGreaterThan(0.95);
    const strict = await search(aliceBotId, mixed, 0.55);
    expect(strict.data?.map((row) => row.content)).toEqual(['alice-axis0']);
  });

  it('should return nothing when every chunk is below the threshold', async () => {
    const { data } = await search(aliceBotId, axisVector(10), 0.55);
    expect(data).toEqual([]);
  });
});
