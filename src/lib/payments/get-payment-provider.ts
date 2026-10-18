import 'server-only';
import { createMockPaymentProvider } from '@/lib/payments/mock-payment-provider';
import type { PaymentProvider } from '@/lib/payments/payment-provider';

// Real Stripe would plug in here: read STRIPE_SECRET_KEY and return a provider whose charge() creates and confirms a
// PaymentIntent for the token. It is intentionally not added: this demo never moves money and has no Stripe dependency.
export function getPaymentProvider(): PaymentProvider {
  return createMockPaymentProvider();
}
