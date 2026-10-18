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
import { createMockPaymentProvider } from '@/lib/payments/mock-payment-provider';
import type { ChargeRequest } from '@/lib/payments/payment-provider';

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
    const KEY = '3f2b8c1e-7a4d-4e6f-9b0a-1c2d3e4f5a6b';
    const OK = { token: 'tok_visa', idempotencyKey: KEY } as const;

    it('should redirect and charge nothing when signed out', async () => {
      requireUser.mockRejectedValue(REDIRECT);
      await expect(completeDemoCheckout(OK)).rejects.toBe(REDIRECT);
      expect(charge).not.toHaveBeenCalled();
    });

    it.each([
      { token: '4242424242424242', idempotencyKey: KEY },
      { token: 'tok_unknown', idempotencyKey: KEY },
      { token: 'tok_visa' },
      { token: 'tok_visa', idempotencyKey: 'nope' },
      {},
      { ...OK, number: '4242424242424242' },
      { ...OK, last4: '4242' },
    ])('should reject invalid input %j without charging', async (input) => {
      await expect(completeDemoCheckout(input as never)).resolves.toEqual({ ok: false, error: 'Invalid payment details.' });
      expect(charge).not.toHaveBeenCalled();
      expect(changePlan).not.toHaveBeenCalled();
    });

    it('should not charge when the owner is already on Pro', async () => {
      getOwnPlan.mockResolvedValue({ id: 'pro', name: 'Pro' });
      await expect(completeDemoCheckout(OK)).resolves.toEqual({ ok: false, error: "You're already on Pro." });
      expect(charge).not.toHaveBeenCalled();
    });

    it('should charge the Pro price with the idempotency key and derive brand and last4 from the token', async () => {
      const result = await completeDemoCheckout(OK);
      expect(result).toEqual({ ok: true, chargeId: 'ch_demo_abc', brand: 'visa', last4: '4242' });
      expect(charge).toHaveBeenCalledWith({ token: 'tok_visa', idempotencyKey: KEY, amountUsd: 19, description: 'Docly AI Pro (demo)', customerId: 'user-1' });
      expect(changePlan).toHaveBeenCalledWith(adminClient, 'user-1', 'pro');
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard', 'layout');
    });

    it('should return the Mastercard display data for tok_mastercard', async () => {
      await expect(completeDemoCheckout({ token: 'tok_mastercard', idempotencyKey: KEY })).resolves.toMatchObject({ ok: true, brand: 'mastercard', last4: '4444' });
    });

    it('should return the decline message and keep the plan when the card is declined', async () => {
      charge.mockResolvedValue({ ok: false, code: 'card_declined', message: 'Your card was declined.' });
      await expect(completeDemoCheckout({ token: 'tok_chargeDeclined', idempotencyKey: KEY })).resolves.toEqual({ ok: false, error: 'Your card was declined.' });
      expect(changePlan).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('should return a generic error when the provider throws', async () => {
      charge.mockRejectedValue(new Error('network'));
      await expect(completeDemoCheckout(OK)).resolves.toEqual({ ok: false, error: 'Something went wrong. Please try again.' });
      expect(changePlan).not.toHaveBeenCalled();
    });

    it('should log and return the receipt id when the plan update fails after the charge', async () => {
      changePlan.mockRejectedValue(new Error('db'));
      await expect(completeDemoCheckout(OK)).resolves.toEqual({
        ok: false,
        error: 'Payment received but the plan update failed. Contact support with receipt ch_demo_abc.',
      });
      expect(console.error).toHaveBeenCalledWith('[checkout] charged but plan update failed', expect.objectContaining({ userId: 'user-1', chargeId: 'ch_demo_abc' }));
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('should charge only once when two calls with the same key run concurrently', async () => {
      const provider = createMockPaymentProvider({ delayMs: 5 });
      charge.mockImplementation((request: ChargeRequest) => provider.charge(request));
      const [first, second] = await Promise.all([completeDemoCheckout(OK), completeDemoCheckout(OK)]);
      expect(charge).toHaveBeenCalledTimes(1);
      expect(changePlan).toHaveBeenCalledTimes(1);
      expect([first.ok, second.ok].sort()).toEqual([false, true]);
    });

    it('should accept a new checkout once the previous one has finished', async () => {
      await completeDemoCheckout(OK);
      charge.mockResolvedValue({ ok: false, code: 'card_declined', message: 'Your card was declined.' });
      await expect(completeDemoCheckout(OK)).resolves.toEqual({ ok: false, error: 'Your card was declined.' });
    });

    it('should log only ids and the token type', async () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      await completeDemoCheckout(OK);
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain('user-1');
      expect(logged).toContain('tok_visa');
      expect(logged).not.toContain('4242');
    });
  });
});
