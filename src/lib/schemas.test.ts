import { describe, expect, it } from 'vitest';
import { parseBotSettings, parseCredentials } from '@/lib/schemas';

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

function botForm(name: string, welcomeMessage: string): FormData {
  const data = new FormData();
  data.set('name', name);
  data.set('welcomeMessage', welcomeMessage);
  return data;
}

describe('parseBotSettings', () => {
  it('should return trimmed values when input is valid', () => {
    expect(parseBotSettings(botForm('  Acme Helper ', ' Hi there! '))).toEqual({ ok: true, name: 'Acme Helper', welcomeMessage: 'Hi there!' });
  });

  it('should return an error and keep values when name is blank', () => {
    expect(parseBotSettings(botForm('   ', 'Hi'))).toEqual({ ok: false, error: 'Name is required.', values: { name: '', welcomeMessage: 'Hi' } });
  });

  it('should return an error when name is longer than 60 characters', () => {
    expect(parseBotSettings(botForm('a'.repeat(61), 'Hi'))).toMatchObject({ ok: false, error: 'Name must be 60 characters or fewer.' });
  });

  it('should return an error when welcome message is blank', () => {
    expect(parseBotSettings(botForm('Bot', ''))).toMatchObject({ ok: false, error: 'Welcome message is required.' });
  });

  it('should return an error when welcome message is longer than 300 characters', () => {
    expect(parseBotSettings(botForm('Bot', 'a'.repeat(301)))).toMatchObject({ ok: false, error: 'Welcome message must be 300 characters or fewer.' });
  });

  it('should accept boundary lengths when name is 60 and welcome is 300 characters', () => {
    expect(parseBotSettings(botForm('a'.repeat(60), 'b'.repeat(300)))).toMatchObject({ ok: true });
  });
});
