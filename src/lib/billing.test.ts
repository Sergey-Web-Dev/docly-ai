import { beforeEach, describe, expect, it, vi } from 'vitest';

const getOwnChatbot = vi.fn();
const listDocuments = vi.fn();
const getOwnPlan = vi.fn();
const getMonthlyUsage = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('@/lib/chatbots', () => ({
  getOwnChatbot: (...args: unknown[]) => getOwnChatbot(...args) as unknown,
  listDocuments: (...args: unknown[]) => listDocuments(...args) as unknown,
  getOwnPlan: (...args: unknown[]) => getOwnPlan(...args) as unknown,
}));
vi.mock('@/lib/usage', () => ({ getMonthlyUsage: (...args: unknown[]) => getMonthlyUsage(...args) as unknown }));

import { changePlan, getBillingSummary } from '@/lib/billing';
import { PLANS } from '@/lib/plans';

const supabase = { tag: 'user' } as never;

describe('getBillingSummary', () => {
  beforeEach(() => {
    getOwnChatbot.mockReset().mockResolvedValue({ id: 'bot-1' });
    listDocuments.mockReset().mockResolvedValue([{}, {}]);
    getOwnPlan.mockReset().mockResolvedValue(PLANS.free);
    getMonthlyUsage.mockReset().mockResolvedValue(7);
  });

  it('should report usage and limits of the current plan', async () => {
    await expect(getBillingSummary(supabase, 'u1')).resolves.toEqual({
      plan: PLANS.free,
      documents: { used: 2, limit: 2 },
      messages: { used: 7, limit: 30 },
      isOverDocumentLimit: false,
    });
  });

  it('should flag isOverDocumentLimit when a downgraded user keeps more documents than the plan allows', async () => {
    listDocuments.mockResolvedValue([{}, {}, {}]);
    await expect(getBillingSummary(supabase, 'u1')).resolves.toMatchObject({ documents: { used: 3, limit: 2 }, isOverDocumentLimit: true });
  });

  it('should report zero documents when the user has no bot yet', async () => {
    getOwnChatbot.mockResolvedValue(null);
    await expect(getBillingSummary(supabase, 'u1')).resolves.toMatchObject({ documents: { used: 0, limit: 2 }, isOverDocumentLimit: false });
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it('should use Pro limits for a Pro plan', async () => {
    getOwnPlan.mockResolvedValue(PLANS.pro);
    await expect(getBillingSummary(supabase, 'u1')).resolves.toMatchObject({ documents: { limit: 10 }, messages: { limit: 300 } });
  });
});

describe('changePlan', () => {
  function adminWith(result: { data: unknown[] | null; error: { code: string } | null }) {
    const select = vi.fn().mockResolvedValue(result);
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    return { client: { from: vi.fn().mockReturnValue({ update }) } as never, update, eq };
  }

  it('should update profiles.plan for the given user', async () => {
    const { client, update, eq } = adminWith({ data: [{ id: 'u1' }], error: null });
    await changePlan(client, 'u1', 'pro');
    expect(update).toHaveBeenCalledWith({ plan: 'pro' });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('should throw when the update fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = adminWith({ data: null, error: { code: 'XX000' } });
    await expect(changePlan(client, 'u1', 'free')).rejects.toBeDefined();
  });

  it('should throw when no profile row was updated', async () => {
    const { client } = adminWith({ data: [], error: null });
    await expect(changePlan(client, 'u1', 'free')).rejects.toThrow();
  });
});
