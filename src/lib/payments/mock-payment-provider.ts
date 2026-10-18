import 'server-only';
import { randomBytes } from 'node:crypto';
import type { ChargeRequest, ChargeResult, PaymentProvider } from '@/lib/payments/payment-provider';

const PROCESSING_MS = 1200;

export interface MockProviderOptions {
  readonly delayMs?: number;
  readonly delay?: (ms: number) => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newChargeId(): string {
  return `ch_demo_${randomBytes(9).toString('hex')}`;
}

function resolveCharge(token: string): ChargeResult {
  switch (token) {
    case 'tok_visa':
    case 'tok_mastercard':
      return { ok: true, chargeId: newChargeId() };
    case 'tok_chargeDeclined':
      return { ok: false, code: 'card_declined', message: 'Your card was declined.' };
    case 'tok_chargeDeclinedInsufficientFunds':
      return { ok: false, code: 'insufficient_funds', message: 'Your card has insufficient funds.' };
    default:
      return { ok: false, code: 'invalid_token', message: 'Invalid payment details.' };
  }
}

// Mock acquirer: accepts only the Stripe test tokens and simulates processing time. It never sees card numbers.
export function createMockPaymentProvider(options: MockProviderOptions = {}): PaymentProvider {
  const wait = options.delay ?? (options.delayMs === undefined ? sleep : () => sleep(options.delayMs ?? 0));
  // In-memory idempotency store (fine for a demo). It holds the promise, so concurrent calls with the same key share one charge.
  const charges = new Map<string, Promise<ChargeResult>>();
  return {
    charge(request: ChargeRequest): Promise<ChargeResult> {
      const existing = charges.get(request.idempotencyKey);
      if (existing) return existing;
      const created = wait(PROCESSING_MS).then(() => resolveCharge(request.token));
      charges.set(request.idempotencyKey, created);
      // Only successful charges are remembered: a declined card can be retried (with another card) under the same key.
      void created.then((result) => {
        if (!result.ok) charges.delete(request.idempotencyKey);
      });
      return created;
    },
  };
}
