export const TEST_TOKENS = ['tok_visa', 'tok_mastercard', 'tok_chargeDeclined', 'tok_chargeDeclinedInsufficientFunds'] as const;
export type TestToken = (typeof TEST_TOKENS)[number];

export interface ChargeRequest {
  readonly token: string;
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
