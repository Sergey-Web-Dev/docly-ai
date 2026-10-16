import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers';

vi.mock('server-only', () => ({}));

import { changePlan } from '@/lib/billing';
import { PLANS } from '@/lib/plans';

const INVALID_ARGUMENT = '22023';
const INSUFFICIENT_PRIVILEGE = '42501';
const QUOTA_EXCEEDED = 'DQ001';

function currentMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

async function createBot(user: TestUser): Promise<string> {
  const { data, error } = await user.client.from('chatbots').insert({ owner_id: user.id, name: 'Bot', welcome_message: 'Hi' }).select('id').single();
  if (error || !data) throw error ?? new Error('createBot failed');
  return data.id;
}

async function addDocument(botId: string, maxDocuments: number): Promise<{ code: string | null }> {
  const { error } = await adminClient().rpc('create_document', {
    p_chatbot_id: botId,
    p_file_name: `${crypto.randomUUID()}.txt`,
    p_size_bytes: 10,
    p_max_documents: maxDocuments,
  });
  return { code: error?.code ?? null };
}

async function documentCount(botId: string): Promise<number> {
  const { count, error } = await adminClient().from('documents').select('id', { count: 'exact', head: true }).eq('chatbot_id', botId);
  if (error) throw error;
  return count ?? 0;
}

async function planOf(userId: string): Promise<string | undefined> {
  const { data } = await adminClient().from('profiles').select('plan').eq('id', userId).single();
  return data?.plan;
}

describe('hit_rate_limit', () => {
  const keys: string[] = [];
  const newKey = (): string => {
    const key = `it:${crypto.randomUUID()}`;
    keys.push(key);
    return key;
  };
  const hit = async (key: string, max: number): Promise<boolean | null> => (await adminClient().rpc('hit_rate_limit', { p_key: key, p_window_seconds: 60, p_max: max })).data;

  afterAll(async () => {
    await adminClient().from('rate_limits').delete().in('key', keys);
  });

  it('should allow up to the max within a window and then refuse', async () => {
    const key = newKey();
    expect([await hit(key, 3), await hit(key, 3), await hit(key, 3), await hit(key, 3)]).toEqual([true, true, true, false]);
  });

  it('should keep different keys independent', async () => {
    const first = newKey();
    const second = newKey();
    await hit(first, 1);
    expect(await hit(first, 1)).toBe(false);
    expect(await hit(second, 1)).toBe(true);
  });

  it('should reject invalid arguments with 22023', async () => {
    const admin = adminClient();
    const key = newKey();
    const results = await Promise.all([
      admin.rpc('hit_rate_limit', { p_key: key, p_window_seconds: -1, p_max: 3 }),
      admin.rpc('hit_rate_limit', { p_key: key, p_window_seconds: 0, p_max: 3 }),
      admin.rpc('hit_rate_limit', { p_key: key, p_window_seconds: 60, p_max: 0 }),
      admin.rpc('hit_rate_limit', { p_key: 'x'.repeat(201), p_window_seconds: 60, p_max: 3 }),
    ]);
    expect(results.map((result) => result.error?.code)).toEqual([INVALID_ARGUMENT, INVALID_ARGUMENT, INVALID_ARGUMENT, INVALID_ARGUMENT]);
  });

  it('should hand out exactly the max when calls race', async () => {
    const key = newKey();
    const results = await Promise.all(Array.from({ length: 6 }, () => hit(key, 4)));
    expect(results.filter(Boolean)).toHaveLength(4);
  });
});

describe('rate limiter privileges', () => {
  let alice: TestUser;

  beforeAll(async () => {
    alice = await createTestUser('alice-rl');
  });

  afterAll(async () => {
    await deleteTestUser(alice);
  });

  it('should not allow an authenticated client to call hit_rate_limit', async () => {
    const { error } = await alice.client.rpc('hit_rate_limit', { p_key: `it:${crypto.randomUUID()}`, p_window_seconds: 60, p_max: 3 });
    expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('should not allow an authenticated client to read or write rate_limits', async () => {
    const read = await alice.client.from('rate_limits').select('*');
    const write = await alice.client.from('rate_limits').insert({ key: `it:${crypto.randomUUID()}`, window_start: new Date().toISOString(), count: 1 });
    expect(read.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(write.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('publish grant and column privileges', () => {
  let alice: TestUser;
  let bob: TestUser;
  let aliceBot: string;

  beforeAll(async () => {
    alice = await createTestUser('alice-pub');
    bob = await createTestUser('bob-pub');
    aliceBot = await createBot(alice);
  });

  afterAll(async () => {
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  it('should let the owner publish and unpublish her own bot', async () => {
    const publish = await alice.client.from('chatbots').update({ is_published: true }).eq('id', aliceBot).select('id, is_published');
    expect(publish.error).toBeNull();
    expect(publish.data).toEqual([{ id: aliceBot, is_published: true }]);
    const unpublish = await alice.client.from('chatbots').update({ is_published: false }).eq('id', aliceBot).select('is_published');
    expect(unpublish.data).toEqual([{ is_published: false }]);
  });

  it("should affect 0 rows when another user updates the owner's bot", async () => {
    const result = await bob.client.from('chatbots').update({ is_published: true }).eq('id', aliceBot).select('id');
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    const row = await adminClient().from('chatbots').select('is_published').eq('id', aliceBot).single();
    expect(row.data?.is_published).toBe(false);
  });

  it('should not let the owner change accent_color or owner_id', async () => {
    const accent = await alice.client.from('chatbots').update({ accent_color: '#ff0000' }).eq('id', aliceBot);
    const owner = await alice.client.from('chatbots').update({ owner_id: bob.id }).eq('id', aliceBot);
    expect(accent.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    expect(owner.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('should not let a user update profiles.plan', async () => {
    const result = await alice.client.from('profiles').update({ plan: 'pro' }).eq('id', alice.id).select('id');
    expect(result.error?.code === INSUFFICIENT_PRIVILEGE || result.data?.length === 0).toBe(true);
    expect(await planOf(alice.id)).toBe('free');
  });
});

describe('plan changes', () => {
  it('should accept a 3rd document after an upgrade and block new uploads, without deleting, after a downgrade', async () => {
    const user = await createTestUser('plan');
    try {
      const botId = await createBot(user);
      expect((await addDocument(botId, PLANS.free.documents)).code).toBeNull();
      expect((await addDocument(botId, PLANS.free.documents)).code).toBeNull();
      expect((await addDocument(botId, PLANS.free.documents)).code).toBe(QUOTA_EXCEEDED);

      await changePlan(adminClient(), user.id, 'pro');
      expect(await planOf(user.id)).toBe('pro');
      expect((await addDocument(botId, PLANS.pro.documents)).code).toBeNull();
      expect(await documentCount(botId)).toBe(3);

      await changePlan(adminClient(), user.id, 'free');
      expect(await planOf(user.id)).toBe('free');
      expect(await documentCount(botId)).toBe(3);
      expect((await addDocument(botId, PLANS.free.documents)).code).toBe(QUOTA_EXCEEDED);
      expect(await documentCount(botId)).toBe(3);
    } finally {
      await deleteTestUser(user);
    }
  });

  it('should refuse reserve_message at the Free limit even when the counter was filled on Pro', async () => {
    const user = await createTestUser('downgrade');
    try {
      const admin = adminClient();
      await changePlan(admin, user.id, 'pro');
      const seeded = await admin.from('usage_counters').insert({ owner_id: user.id, month: currentMonth(), message_count: PLANS.free.messagesPerMonth });
      expect(seeded.error).toBeNull();

      await changePlan(admin, user.id, 'free');
      const blocked = await admin.rpc('reserve_message', { p_owner_id: user.id, p_limit: PLANS.free.messagesPerMonth });
      expect(blocked.error).toBeNull();
      expect(blocked.data).toBeNull();

      const allowedOnPro = await admin.rpc('reserve_message', { p_owner_id: user.id, p_limit: PLANS.pro.messagesPerMonth });
      expect(allowedOnPro.data).toBe(currentMonth());
    } finally {
      await deleteTestUser(user);
    }
  });
});
