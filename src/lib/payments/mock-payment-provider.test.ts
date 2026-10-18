import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { createMockPaymentProvider } from '@/lib/payments/mock-payment-provider';

const BASE = { amountUsd: 19, description: 'Docly AI Pro (demo)', customerId: 'user-1' } as const;

describe('createMockPaymentProvider', () => {
  it('should succeed with a demo charge id when the token is tok_visa', async () => {
    const provider = createMockPaymentProvider({ delayMs: 0 });
    const result = await provider.charge({ ...BASE, token: 'tok_visa' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.chargeId).toMatch(/^ch_demo_[a-z0-9]{10,}$/);
  });

  it('should succeed when the token is tok_mastercard', async () => {
    const provider = createMockPaymentProvider({ delayMs: 0 });
    await expect(provider.charge({ ...BASE, token: 'tok_mastercard' })).resolves.toMatchObject({ ok: true });
  });

  it('should decline with card_declined for tok_chargeDeclined', async () => {
    const provider = createMockPaymentProvider({ delayMs: 0 });
    await expect(provider.charge({ ...BASE, token: 'tok_chargeDeclined' })).resolves.toEqual({
      ok: false,
      code: 'card_declined',
      message: 'Your card was declined.',
    });
  });

  it('should decline with insufficient_funds for tok_chargeDeclinedInsufficientFunds', async () => {
    const provider = createMockPaymentProvider({ delayMs: 0 });
    await expect(provider.charge({ ...BASE, token: 'tok_chargeDeclinedInsufficientFunds' })).resolves.toEqual({
      ok: false,
      code: 'insufficient_funds',
      message: 'Your card has insufficient funds.',
    });
  });

  it('should reject an unknown token as invalid_token', async () => {
    const provider = createMockPaymentProvider({ delayMs: 0 });
    const result = await provider.charge({ ...BASE, token: '4242424242424242' });
    expect(result).toMatchObject({ ok: false, code: 'invalid_token' });
  });

  it('should wait for the injected delay before answering', async () => {
    const delay = vi.fn().mockResolvedValue(undefined);
    const provider = createMockPaymentProvider({ delay });
    await provider.charge({ ...BASE, token: 'tok_visa' });
    expect(delay).toHaveBeenCalledWith(1200);
  });

  it('should return unique charge ids', async () => {
    const provider = createMockPaymentProvider({ delayMs: 0 });
    const [a, b] = await Promise.all([provider.charge({ ...BASE, token: 'tok_visa' }), provider.charge({ ...BASE, token: 'tok_visa' })]);
    expect(a).not.toEqual(b);
  });
});
