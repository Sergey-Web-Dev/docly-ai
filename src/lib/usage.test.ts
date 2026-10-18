import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

vi.mock('server-only', () => ({}));

import { currentMonth, getMonthlyUsage, refundMessage, reserveMessage } from '@/lib/usage';

type Client = SupabaseClient<Database>;

describe('currentMonth', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return the first day of the current UTC month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T23:59:59Z'));
    expect(currentMonth()).toBe('2026-10-01');
  });

  it('should use UTC when the local date is already in the next month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-01T00:00:01Z'));
    expect(currentMonth()).toBe('2026-12-01');
  });
});

describe('reserveMessage', () => {
  it('should call reserve_message with the owner and limit and return the reserved month', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '2026-10-01', error: null });
    await expect(reserveMessage({ rpc } as unknown as Client, 'owner-1', 30)).resolves.toBe('2026-10-01');
    expect(rpc).toHaveBeenCalledWith('reserve_message', { p_owner_id: 'owner-1', p_limit: 30 });
  });

  it('should return null when the quota is exhausted', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(reserveMessage({ rpc } as unknown as Client, 'o', 30)).resolves.toBeNull();
  });

  it('should throw when the rpc fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(reserveMessage({ rpc } as unknown as Client, 'o', 30)).rejects.toBeDefined();
  });
});

describe('refundMessage', () => {
  it('should pass the reserved month to refund_message', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await refundMessage({ rpc } as unknown as Client, 'owner-1', '2026-09-01');
    expect(rpc).toHaveBeenCalledWith('refund_message', { p_owner_id: 'owner-1', p_month: '2026-09-01' });
  });

  it('should log and not throw when the rpc fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(refundMessage({ rpc } as unknown as Client, 'o', '2026-10-01')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should log and not throw when the rpc rejects', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rpc = vi.fn().mockRejectedValue(new Error('network'));
    await expect(refundMessage({ rpc } as unknown as Client, 'o', '2026-10-01')).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('getMonthlyUsage', () => {
  function clientReturning(result: { data: { message_count: number } | null; error: unknown }): Client {
    const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result) };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    return { from: vi.fn().mockReturnValue(chain) } as unknown as Client;
  }

  it('should return the counter value when a row exists', async () => {
    await expect(getMonthlyUsage(clientReturning({ data: { message_count: 7 }, error: null }), 'o')).resolves.toBe(7);
  });

  it('should return 0 when no row exists yet', async () => {
    await expect(getMonthlyUsage(clientReturning({ data: null, error: null }), 'o')).resolves.toBe(0);
  });
});
