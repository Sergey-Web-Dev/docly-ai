import { describe, expect, it } from 'vitest';
import { parseCredentials } from '@/lib/schemas';

function form(email: string, password: string): FormData {
  const data = new FormData();
  data.set('email', email);
  data.set('password', password);
  return data;
}

describe('parseCredentials', () => {
  it('should return trimmed credentials when input is valid', () => {
    expect(parseCredentials(form('  owner@example.com ', 'secret123'))).toEqual({ ok: true, email: 'owner@example.com', password: 'secret123' });
  });

  it('should return an error and keep the email when email is invalid', () => {
    expect(parseCredentials(form('nope', 'secret123'))).toEqual({ ok: false, email: 'nope', error: 'Enter a valid email address.' });
  });

  it('should return an error when password is shorter than 8 characters', () => {
    expect(parseCredentials(form('owner@example.com', 'short'))).toMatchObject({ ok: false, error: 'Password must be at least 8 characters.' });
  });
});
