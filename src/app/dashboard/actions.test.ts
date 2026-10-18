import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUser = vi.fn();
const changePlan = vi.fn();
const revalidatePath = vi.fn();
const adminClient = { tag: 'admin' };
const getOwnPlan = vi.fn();
const charge = vi.fn();
const select = vi.fn();
const eq = vi.fn();
const update = vi.fn();
const from = vi.fn();

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) as unknown }));
vi.mock('@/lib/auth/require-user', () => ({ requireUser: () => requireUser() as unknown }));
vi.mock('@/lib/billing', () => ({ changePlan: (...args: unknown[]) => changePlan(...args) as unknown }));
vi.mock('@/lib/chatbots', () => ({ getOwnChatbot: vi.fn(), getOwnPlan: (...args: unknown[]) => getOwnPlan(...args) as unknown }));
vi.mock('@/lib/payments/get-payment-provider', () => ({ getPaymentProvider: () => ({ charge: (...args: unknown[]) => charge(...args) as unknown }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminClient }));

import { completeDemoCheckout, setPlan, setPublished } from '@/app/dashboard/actions';

const REDIRECT = new Error('NEXT_REDIRECT');

describe('dashboard actions', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    revalidatePath.mockReset();
    changePlan.mockReset().mockResolvedValue(undefined);
    getOwnPlan.mockReset().mockResolvedValue({ id: 'free', name: 'Free' });
    charge.mockReset().mockResolvedValue({ ok: true, chargeId: 'ch_demo_abc' });
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
      await expect(setPlan('free')).rejects.toBe(REDIRECT);
      expect(changePlan).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('should reject pro and tell the user to use checkout', async () => {
      await expect(setPlan('pro' as never)).resolves.toEqual({ ok: false, error: 'Use checkout to upgrade.' });
      expect(changePlan).not.toHaveBeenCalled();
    });

    it('should reject an unknown plan id', async () => {
      await expect(setPlan('enterprise' as never)).resolves.toEqual({ ok: false, error: 'Invalid plan.' });
      expect(changePlan).not.toHaveBeenCalled();
    });

    it('should pass the session user id to changePlan with the admin client when downgrading', async () => {
      await expect(setPlan('free')).resolves.toEqual({ ok: true, plan: 'free' });
      expect(changePlan).toHaveBeenCalledWith(adminClient, 'user-1', 'free');
    });

    it('should revalidate the dashboard layout after a change', async () => {
      await setPlan('free');
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard', 'layout');
    });

    it('should return a generic error and not revalidate when changePlan throws', async () => {
      changePlan.mockRejectedValue(new Error('Profile not found'));
      await expect(setPlan('free')).resolves.toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  describe('completeDemoCheckout', () => {
    it('should redirect and charge nothing when signed out', async () => {
      requireUser.mockRejectedValue(REDIRECT);
      await expect(completeDemoCheckout({ token: 'tok_visa' })).rejects.toBe(REDIRECT);
      expect(charge).not.toHaveBeenCalled();
    });

    it.each([{ token: '4242424242424242' }, { token: 'tok_unknown' }, {}, { token: 'tok_visa', number: '4242424242424242' }, { token: 'tok_visa', last4: '42' }])(
      'should reject invalid input %j without charging',
      async (input) => {
        await expect(completeDemoCheckout(input as never)).resolves.toEqual({ ok: false, error: 'Invalid payment details.' });
        expect(charge).not.toHaveBeenCalled();
        expect(changePlan).not.toHaveBeenCalled();
      },
    );

    it('should not charge when the owner is already on Pro', async () => {
      getOwnPlan.mockResolvedValue({ id: 'pro', name: 'Pro' });
      await expect(completeDemoCheckout({ token: 'tok_visa' })).resolves.toEqual({ ok: false, error: "You're already on Pro." });
      expect(charge).not.toHaveBeenCalled();
    });

    it('should charge the Pro price for the session user and upgrade on success', async () => {
      const result = await completeDemoCheckout({ token: 'tok_visa', last4: '4242', brand: 'visa' });
      expect(result).toEqual({ ok: true, chargeId: 'ch_demo_abc', last4: '4242' });
      expect(charge).toHaveBeenCalledWith({ token: 'tok_visa', amountUsd: 19, description: 'Docly AI Pro (demo)', customerId: 'user-1' });
      expect(changePlan).toHaveBeenCalledWith(adminClient, 'user-1', 'pro');
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard', 'layout');
    });

    it('should return the decline message and keep the plan when the card is declined', async () => {
      charge.mockResolvedValue({ ok: false, code: 'card_declined', message: 'Your card was declined.' });
      await expect(completeDemoCheckout({ token: 'tok_chargeDeclined' })).resolves.toEqual({ ok: false, error: 'Your card was declined.' });
      expect(changePlan).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('should return a generic error when the provider throws', async () => {
      charge.mockRejectedValue(new Error('network'));
      await expect(completeDemoCheckout({ token: 'tok_visa' })).resolves.toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
      expect(changePlan).not.toHaveBeenCalled();
    });

    it('should return a generic error when the plan update fails after the charge', async () => {
      changePlan.mockRejectedValue(new Error('db'));
      await expect(completeDemoCheckout({ token: 'tok_visa' })).resolves.toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('should log only ids and the token type', async () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      await completeDemoCheckout({ token: 'tok_visa', last4: '4242', brand: 'visa' });
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain('user-1');
      expect(logged).toContain('tok_visa');
      expect(logged).not.toContain('4242');
    });
  });
});
