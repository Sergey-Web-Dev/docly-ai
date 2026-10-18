import { describe, expect, it } from 'vitest';
import {
  DEMO_ONLY_MESSAGE,
  detectBrand,
  formatCardNumber,
  luhnValid,
  normalizeCardNumber,
  tokenizeTestCard,
  validateCvc,
  validateExpiry,
} from '@/lib/payments/demo-card';

const NOW = new Date('2026-10-18T12:00:00Z');
const VALID = { number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123', name: 'Ada Lovelace' } as const;

describe('normalizeCardNumber', () => {
  it('should strip spaces, dashes and letters', () => {
    expect(normalizeCardNumber('4242-4242 4242abc4242')).toBe('4242424242424242');
  });

  it('should cap at 19 digits', () => {
    expect(normalizeCardNumber('1'.repeat(30))).toHaveLength(19);
  });
});

describe('formatCardNumber', () => {
  it('should group digits in blocks of four', () => {
    expect(formatCardNumber('42424242424242')).toBe('4242 4242 4242 42');
  });

  it('should return an empty string for no digits', () => {
    expect(formatCardNumber('')).toBe('');
  });
});

describe('detectBrand', () => {
  it.each([
    ['4242424242424242', 'visa'],
    ['5555555555554444', 'mastercard'],
    ['2221000000000009', 'mastercard'],
    ['378282246310005', 'amex'],
    ['6011000000000004', 'unknown'],
    ['', 'unknown'],
  ])('should detect %s as %s', (number, brand) => {
    expect(detectBrand(number)).toBe(brand);
  });
});

describe('luhnValid', () => {
  it('should accept a Luhn-valid number', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
  });

  it('should reject a number with a wrong check digit', () => {
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('should reject an empty string', () => {
    expect(luhnValid('')).toBe(false);
  });
});

describe('validateExpiry', () => {
  it('should accept a future month', () => {
    expect(validateExpiry('12/30', NOW)).toBeNull();
  });

  it('should accept the current month', () => {
    expect(validateExpiry('10/26', NOW)).toBeNull();
  });

  it('should reject a past month', () => {
    expect(validateExpiry('09/26', NOW)).toBe('Your card has expired.');
  });

  it.each(['13/30', '00/30', '1230', '1/30', 'ab/cd', ''])('should reject malformed %j', (value) => {
    expect(validateExpiry(value, NOW)).toBe('Enter a valid expiry date (MM/YY).');
  });
});

describe('validateCvc', () => {
  it('should accept three digits', () => {
    expect(validateCvc('123', 'visa')).toBeNull();
  });

  it('should reject two or four digits for non-amex', () => {
    expect(validateCvc('12', 'visa')).toBe('Enter a valid CVC.');
    expect(validateCvc('1234', 'visa')).toBe('Enter a valid CVC.');
  });

  it('should require four digits for amex', () => {
    expect(validateCvc('1234', 'amex')).toBeNull();
    expect(validateCvc('123', 'amex')).toBe('Enter a valid CVC.');
  });

  it('should reject non-digits', () => {
    expect(validateCvc('12a', 'visa')).toBe('Enter a valid CVC.');
  });
});

describe('tokenizeTestCard', () => {
  it.each([
    ['4242 4242 4242 4242', 'tok_visa', 'visa', '4242'],
    ['5555 5555 5555 4444', 'tok_mastercard', 'mastercard', '4444'],
    ['4000 0000 0000 0002', 'tok_chargeDeclined', 'visa', '0002'],
    ['4000 0000 0000 9995', 'tok_chargeDeclinedInsufficientFunds', 'visa', '9995'],
  ])('should tokenize the test card %s', (number, token, brand, last4) => {
    expect(tokenizeTestCard({ ...VALID, number }, NOW)).toEqual({ ok: true, token, brand, last4 });
  });

  it('should return only token, brand and last4 on success', () => {
    const result = tokenizeTestCard(VALID, NOW);
    expect(Object.keys(result).sort()).toEqual(['brand', 'last4', 'ok', 'token']);
    expect(JSON.stringify(result)).not.toContain('4242424242424242');
    expect(JSON.stringify(result)).not.toContain('123');
  });

  it('should reject a Luhn-valid real-looking number with the demo-only message', () => {
    expect(tokenizeTestCard({ ...VALID, number: '4111 1111 1111 1111' }, NOW)).toEqual({ ok: false, field: 'number', error: DEMO_ONLY_MESSAGE });
  });

  it('should reject a random number with the demo-only message', () => {
    expect(tokenizeTestCard({ ...VALID, number: '1234 5678 9012 3456' }, NOW)).toMatchObject({ ok: false, field: 'number', error: DEMO_ONLY_MESSAGE });
  });

  it('should reject an empty number', () => {
    expect(tokenizeTestCard({ ...VALID, number: '' }, NOW)).toMatchObject({ ok: false, field: 'number' });
  });

  it('should report an expired card on the expiry field', () => {
    expect(tokenizeTestCard({ ...VALID, expiry: '01/20' }, NOW)).toEqual({ ok: false, field: 'expiry', error: 'Your card has expired.' });
  });

  it('should report an invalid cvc on the cvc field', () => {
    expect(tokenizeTestCard({ ...VALID, cvc: '1' }, NOW)).toEqual({ ok: false, field: 'cvc', error: 'Enter a valid CVC.' });
  });

  it('should require a cardholder name', () => {
    expect(tokenizeTestCard({ ...VALID, name: '   ' }, NOW)).toEqual({ ok: false, field: 'name', error: 'Enter the name on the card.' });
  });

  it('should report the first failing field in form order', () => {
    expect(tokenizeTestCard({ number: '4111111111111111', expiry: '01/20', cvc: '1', name: '' }, NOW)).toMatchObject({ field: 'number' });
  });
});
