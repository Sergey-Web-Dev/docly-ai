import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { clientIp, rateLimitKey } from '@/lib/client-key';

const BOT_ID = '8f14e45f-ceea-4a67-9b53-2f1a3c0d4e5a';

describe('clientIp', () => {
  it('should prefer x-vercel-forwarded-for over the other headers', () => {
    const headers = new Headers({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' });
    expect(clientIp(headers)).toBe('1.1.1.1');
  });

  it('should prefer x-real-ip over x-forwarded-for', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' }))).toBe('2.2.2.2');
  });

  it('should use the first entry of x-forwarded-for', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': ' 3.3.3.3 , 4.4.4.4' }))).toBe('3.3.3.3');
  });

  it('should return "unknown" when no header is present', () => {
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('rateLimitKey', () => {
  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_SALT', 'test-salt');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should not contain the raw IP', () => {
    expect(rateLimitKey(new Headers({ 'x-real-ip': '203.0.113.9' }), BOT_ID)).not.toContain('203.0.113.9');
  });

  it('should be stable for the same ip and bot', () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.9' });
    expect(rateLimitKey(headers, BOT_ID)).toBe(rateLimitKey(headers, BOT_ID));
  });

  it('should start with chat:{botId}: and stay within the 200 char key limit', () => {
    const key = rateLimitKey(new Headers(), BOT_ID);
    expect(key.startsWith(`chat:${BOT_ID}:`)).toBe(true);
    expect(key.length).toBeLessThan(200);
  });

  it('should differ between ips and between bots', () => {
    const a = rateLimitKey(new Headers({ 'x-real-ip': '1.1.1.1' }), BOT_ID);
    expect(rateLimitKey(new Headers({ 'x-real-ip': '1.1.1.2' }), BOT_ID)).not.toBe(a);
    expect(rateLimitKey(new Headers({ 'x-real-ip': '1.1.1.1' }), 'other-bot')).not.toBe(a);
  });

  it('should depend on the salt', () => {
    const headers = new Headers({ 'x-real-ip': '1.1.1.1' });
    const before = rateLimitKey(headers, BOT_ID);
    vi.stubEnv('RATE_LIMIT_SALT', 'other-salt');
    expect(rateLimitKey(headers, BOT_ID)).not.toBe(before);
  });
});
