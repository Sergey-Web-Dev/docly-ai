import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const changePlan = vi.fn();
const revalidatePath = vi.fn();
const adminClient = { tag: 'admin' };
const select = vi.fn();
const eq = vi.fn();
const update = vi.fn();
const from = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) as unknown }));
vi.mock('@/lib/auth/require-user', () => ({ requireUser: () => requireUser() as unknown }));
vi.mock('@/lib/billing', () => ({ changePlan: (...args: unknown[]) => changePlan(...args) as unknown }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient }));

import { setPlan, setPublished } from '@/app/dashboard/actions';

const REDIRECT = new Error('NEXT_REDIRECT');

describe('dashboard actions', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    revalidatePath.mockReset();
    changePlan.mockReset().mockResolvedValue(undefined);
    select.mockReset().mockResolvedValue({ data: [{ id: 'bot-1' }], error: null });
    eq.mockReset().mockReturnValue({ select });
    update.mockReset().mockReturnValue({ eq });
    from.mockReset().mockReturnValue({ update });
    requireUser.mockReset().mockResolvedValue({ user: { id: 'user-1' }, supabase: { from } });
  });

  describe('setPublished', () => {
    it('should redirect and write nothing when signed out', async () => {
      requireUser.mockRejectedValue(REDIRECT);
      await expect(setPublished(true)).rejects.toBe(REDIRECT);
      expect(from).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('should reject a non-boolean value', async () => {
      await expect(setPublished('yes' as unknown as boolean)).resolves.toEqual({ ok: false, error: 'Invalid request.' });
      expect(from).not.toHaveBeenCalled();
    });

    it('should update only the bot of the session user and revalidate the dashboard', async () => {
      await expect(setPublished(true)).resolves.toEqual({ ok: true, isPublished: true });
      expect(from).toHaveBeenCalledWith('chatbots');
      expect(update).toHaveBeenCalledWith({ is_published: true });
      expect(eq).toHaveBeenCalledWith('owner_id', 'user-1');
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard');
    });

    it('should ask to create the bot first when no row was updated', async () => {
      select.mockResolvedValue({ data: [], error: null });
      await expect(setPublished(false)).resolves.toEqual({ ok: false, error: 'Create your bot first.' });
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('should return a generic error when the update fails', async () => {
      select.mockResolvedValue({ data: null, error: { code: 'XX000' } });
      await expect(setPublished(true)).resolves.toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe('setPlan', () => {
    it('should redirect and change nothing when signed out', async () => {
      requireUser.mockRejectedValue(REDIRECT);
      await expect(setPlan('pro')).rejects.toBe(REDIRECT);
      expect(changePlan).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('should reject an unknown plan id', async () => {
      await expect(setPlan('enterprise' as never)).resolves.toEqual({ ok: false, error: 'Invalid plan.' });
      expect(changePlan).not.toHaveBeenCalled();
    });

    it('should pass the session user id to changePlan with the admin client', async () => {
      await expect(setPlan('pro')).resolves.toEqual({ ok: true, plan: 'pro' });
      expect(changePlan).toHaveBeenCalledWith(adminClient, 'user-1', 'pro');
    });

    it('should revalidate the dashboard layout after a change', async () => {
      await setPlan('free');
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard', 'layout');
    });

    it('should return a generic error and not revalidate when changePlan throws', async () => {
      changePlan.mockRejectedValue(new Error('Profile not found'));
      await expect(setPlan('pro')).resolves.toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });
});
