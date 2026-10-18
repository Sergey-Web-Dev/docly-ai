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
  return {
    async charge(request: ChargeRequest): Promise<ChargeResult> {
      await wait(PROCESSING_MS);
      return resolveCharge(request.token);
    },
  };
}
