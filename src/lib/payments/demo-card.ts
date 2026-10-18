import type { TestToken } from '@/lib/payments/payment-provider';

// Pure and browser-safe (no server-only). The card details typed by the user are only ever read here, in the browser.
// The result of tokenizeTestCard carries a token, the brand and the last four digits, never the number, expiry or CVC.

export const DEMO_ONLY_MESSAGE = 'This is a demo checkout. Use a test card such as 4242 4242 4242 4242 — never enter a real card.';

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'unknown';
export type CardField = 'number' | 'expiry' | 'cvc' | 'name';

export interface CardInput {
  readonly number: string;
  readonly expiry: string;
  readonly cvc: string;
  readonly name: string;
}

export type TokenizeResult =
  | { readonly ok: true; readonly token: TestToken; readonly brand: CardBrand; readonly last4: string }
  | { readonly ok: false; readonly field: CardField; readonly error: string };

const MAX_DIGITS = 19;
const EXPIRY_PATTERN = /^(\d{2})\/(\d{2})$/;

const TEST_CARDS: Readonly<Record<string, TestToken>> = {
  '4242424242424242': 'tok_visa',
  '5555555555554444': 'tok_mastercard',
  '4000000000000002': 'tok_chargeDeclined',
  '4000000000009995': 'tok_chargeDeclinedInsufficientFunds',
};

export function normalizeCardNumber(value: string): string {
  return value.replace(/\D/g, '').slice(0, MAX_DIGITS);
}

export function formatCardNumber(value: string): string {
  return normalizeCardNumber(value).replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function detectBrand(number: string): CardBrand {
  const digits = normalizeCardNumber(number);
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^4/.test(digits)) return 'visa';
  if (/^5[1-5]/.test(digits) || /^2(2[2-9]\d|[3-6]\d\d|7[01]\d|720)/.test(digits)) return 'mastercard';
  return 'unknown';
}

export function luhnValid(number: string): boolean {
  const digits = normalizeCardNumber(number);
  if (digits.length === 0) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function validateExpiry(value: string, now: Date = new Date()): string | null {
  const match = EXPIRY_PATTERN.exec(value.trim());
  const month = match ? Number(match[1]) : 0;
  if (!match || month < 1 || month > 12) return 'Enter a valid expiry date (MM/YY).';
  const year = 2000 + Number(match[2]);
  const isPast = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
  return isPast ? 'Your card has expired.' : null;
}

export function validateCvc(value: string, brand: CardBrand): string | null {
  const length = brand === 'amex' ? 4 : 3;
  return new RegExp(`^\\d{${length}}$`).test(value) ? null : 'Enter a valid CVC.';
}

export function tokenizeTestCard(input: CardInput, now: Date = new Date()): TokenizeResult {
  const digits = normalizeCardNumber(input.number);
  const token = TEST_CARDS[digits];
  if (!token) return { ok: false, field: 'number', error: DEMO_ONLY_MESSAGE };

  const brand = detectBrand(digits);
  const expiryError = validateExpiry(input.expiry, now);
  if (expiryError) return { ok: false, field: 'expiry', error: expiryError };
  const cvcError = validateCvc(input.cvc.trim(), brand);
  if (cvcError) return { ok: false, field: 'cvc', error: cvcError };
  if (input.name.trim().length === 0) return { ok: false, field: 'name', error: 'Enter the name on the card.' };

  return { ok: true, token, brand, last4: digits.slice(-4) };
}
