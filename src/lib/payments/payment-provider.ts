export const TEST_TOKENS = ['tok_visa', 'tok_mastercard', 'tok_chargeDeclined', 'tok_chargeDeclinedInsufficientFunds'] as const;
export type TestToken = (typeof TEST_TOKENS)[number];

export type TestCardBrand = 'visa' | 'mastercard';

// Display data for each test token. The server derives the brand and last four digits from the token, never from the client.
export const TEST_TOKEN_CARDS: Readonly<Record<TestToken, { readonly brand: TestCardBrand; readonly last4: string }>> = {
  tok_visa: { brand: 'visa', last4: '4242' },
  tok_mastercard: { brand: 'mastercard', last4: '4444' },
  tok_chargeDeclined: { brand: 'visa', last4: '0002' },
  tok_chargeDeclinedInsufficientFunds: { brand: 'visa', last4: '9995' },
};

export interface ChargeRequest {
  readonly token: string;
  /**
   * Required. Repeating a charge with the same key must return the original result instead of charging again
   * (a double click, a retry after a timeout). Real Stripe: send it as the `Idempotency-Key` request header
   * (`stripe.paymentIntents.create(params, { idempotencyKey })`).
   */
  readonly idempotencyKey: string;
  readonly amountUsd: number;
  readonly description: string;
  readonly customerId: string;
}

export type ChargeResult =
  | { readonly ok: true; readonly chargeId: string }
  | { readonly ok: false; readonly code: 'card_declined' | 'insufficient_funds' | 'invalid_token'; readonly message: string };

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}
