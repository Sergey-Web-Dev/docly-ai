import 'server-only';
import { createMockPaymentProvider } from '@/lib/payments/mock-payment-provider';
import type { PaymentProvider } from '@/lib/payments/payment-provider';

// Real Stripe would plug in here: read STRIPE_SECRET_KEY and return a provider whose charge() creates and confirms a
// PaymentIntent for the token, passing request.idempotencyKey as Stripe's idempotency key. It is intentionally not added: this demo never moves money and has no Stripe dependency.
// A single instance, so the mock's idempotency store survives across requests.
const provider = createMockPaymentProvider();

export function getPaymentProvider(): PaymentProvider {
  return provider;
}
