import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { clientIp, ipHash, normalizeIp, rateLimitKey } from '@/lib/client-key';

const BOT_ID = '8f14e45f-ceea-4a67-9b53-2f1a3c0d4e5a';

describe('clientIp', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('on Vercel', () => {
    beforeEach(() => {
      vi.stubEnv('VERCEL', '1');
    });

    it('should prefer x-vercel-forwarded-for over the other headers', () => {
      const headers = new Headers({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' });
      expect(clientIp(headers)).toBe('1.1.1.1');
    });

    it('should prefer x-real-ip over x-forwarded-for', () => {
      expect(clientIp(new Headers({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' }))).toBe('2.2.2.2');
    });

    it('should use the left-most entry of x-forwarded-for', () => {
      expect(clientIp(new Headers({ 'x-forwarded-for': ' 3.3.3.3 , 4.4.4.4' }))).toBe('3.3.3.3');
    });
  });

  describe('outside Vercel', () => {
    beforeEach(() => {
      vi.stubEnv('VERCEL', '');
    });

    it('should ignore x-vercel-forwarded-for', () => {
      expect(clientIp(new Headers({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2' }))).toBe('2.2.2.2');
    });

    it('should use the right-most x-forwarded-for hop, which a client cannot spoof', () => {
      expect(clientIp(new Headers({ 'x-forwarded-for': '9.9.9.9, 3.3.3.3 , 4.4.4.4' }))).toBe('4.4.4.4');
    });

    it('should fall back to x-real-ip when x-forwarded-for is absent', () => {
      expect(clientIp(new Headers({ 'x-real-ip': '2.2.2.2' }))).toBe('2.2.2.2');
    });
  });

  it('should return "unknown" when no header is present', () => {
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('clientIp unknown logging', () => {
  it('should log only once when falling back to unknown', async () => {
    vi.resetModules();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fresh = await import('@/lib/client-key');
    fresh.clientIp(new Headers());
    fresh.clientIp(new Headers());
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe('normalizeIp', () => {
  it('should leave IPv4 unchanged', () => {
    expect(normalizeIp('203.0.113.9')).toBe('203.0.113.9');
  });

  it('should strip a port from IPv4', () => {
    expect(normalizeIp('203.0.113.9:5050')).toBe('203.0.113.9');
  });

  it('should reduce IPv6 to its /64 prefix', () => {
    expect(normalizeIp('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64');
  });

  it('should map different hosts of the same /64 to the same value', () => {
    expect(normalizeIp('2001:db8:1:2::1')).toBe(normalizeIp('2001:0db8:0001:0002:ffff:eeee:dddd:cccc'));
  });

  it('should differ across /64 prefixes', () => {
    expect(normalizeIp('2001:db8:1:2::1')).not.toBe(normalizeIp('2001:db8:1:3::1'));
  });

  it('should expand :: compression', () => {
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(normalizeIp('::1')).toBe('0:0:0:0::/64');
    expect(normalizeIp('::')).toBe('0:0:0:0::/64');
    expect(normalizeIp('2001:db8:1:2:3::')).toBe('2001:db8:1:2::/64');
  });

  it('should be case-insensitive for IPv6', () => {
    expect(normalizeIp('2001:DB8:1:2::1')).toBe(normalizeIp('2001:db8:1:2::1'));
  });

  it('should handle brackets and ports', () => {
    expect(normalizeIp('[2001:db8:1:2::1]:443')).toBe('2001:db8:1:2::/64');
    expect(normalizeIp('[2001:db8:1:2::1]')).toBe('2001:db8:1:2::/64');
  });

  it('should drop zone ids', () => {
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('should treat IPv4-mapped IPv6 as IPv4', () => {
    expect(normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp('::FFFF:cb00:7109')).toBe('203.0.113.9');
    expect(normalizeIp('[::ffff:203.0.113.9]:80')).toBe('203.0.113.9');
  });

  it('should stay deterministic for malformed input', () => {
    for (const input of ['not-an-ip', '1.2.3', '999.1.1.1', '1:2:3', '1::2::3', 'gggg::1', '2001:db8:1:2:3:4:5:6:7', 'UNKNOWN', '']) {
      expect(normalizeIp(input)).toBe(normalizeIp(input));
    }
    expect(normalizeIp('Not-An-IP')).toBe('not-an-ip');
    expect(normalizeIp('unknown')).toBe('unknown');
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

  it('should hash all addresses of one IPv6 /64 to the same key', () => {
    const a = rateLimitKey(new Headers({ 'x-real-ip': '2001:db8:1:2::1' }), BOT_ID);
    expect(rateLimitKey(new Headers({ 'x-real-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }), BOT_ID)).toBe(a);
    expect(rateLimitKey(new Headers({ 'x-real-ip': '2001:db8:1:3::1' }), BOT_ID)).not.toBe(a);
  });

  it('should hash an IPv4-mapped address like the plain IPv4', () => {
    expect(ipHash(new Headers({ 'x-real-ip': '::ffff:1.1.1.1' }))).toBe(ipHash(new Headers({ 'x-real-ip': '1.1.1.1' })));
  });

  it('should depend on the salt', () => {
    const headers = new Headers({ 'x-real-ip': '1.1.1.1' });
    const before = rateLimitKey(headers, BOT_ID);
    vi.stubEnv('RATE_LIMIT_SALT', 'other-salt');
    expect(rateLimitKey(headers, BOT_ID)).not.toBe(before);
  });
});
