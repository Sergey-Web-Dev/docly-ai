import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers';

describe('profiles RLS', () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
  });

  afterAll(async () => {
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  it('should create a free profile when a user signs up', async () => {
    const { data } = await alice.client.from('profiles').select('plan').eq('id', alice.id).single();
    expect(data?.plan).toBe('free');
  });

  it('should hide other users profiles when querying by their id', async () => {
    const { data } = await alice.client.from('profiles').select('id').eq('id', bob.id);
    expect(data).toEqual([]);
  });

  it('should not let a user upgrade their own plan when updating from the client', async () => {
    await alice.client.from('profiles').update({ plan: 'pro' }).eq('id', alice.id);
    const { data } = await adminClient().from('profiles').select('plan').eq('id', alice.id).single();
    expect(data?.plan).toBe('free');
  });
});
