import 'server-only';
import { createHash } from 'node:crypto';
import { serverEnv } from '@/lib/env-server';

let warnedUnknown = false;

function firstHop(value: string | null): string {
  return value?.split(',')[0]?.trim() ?? '';
}

function lastHop(value: string | null): string {
  const hops = value?.split(',') ?? [];
  return hops[hops.length - 1]?.trim() ?? '';
}

// Forwarding headers are only trustworthy behind Vercel's edge, which sets/overwrites them. Anywhere else a client can
// send any value, so the right-most x-forwarded-for hop (the one appended by our own proxy) is used instead.
export function clientIp(headers: Headers): string {
  const candidate = process.env.VERCEL
    ? firstHop(headers.get('x-vercel-forwarded-for')) || firstHop(headers.get('x-real-ip')) || firstHop(headers.get('x-forwarded-for'))
    : lastHop(headers.get('x-forwarded-for')) || firstHop(headers.get('x-real-ip'));
  if (!candidate) {
    if (!warnedUnknown) {
      warnedUnknown = true;
      console.error('[client-key] no client IP found in request headers; all such visitors share one rate limit bucket');
    }
    return 'unknown';
  }
  return candidate;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(value: string): number[] | null {
  const match = IPV4.exec(value);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function parseIpv6Groups(value: string): number[] | null {
  let text = value;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null;
    return groups.map((group) => parseInt(group, 16));
  };
  const head = parse(halves[0]!);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = parse(halves[1]!);
  if (!rest || head.length + rest.length > 7) return null;
  return [...head, ...Array<number>(8 - head.length - rest.length).fill(0), ...rest];
}

// Reduces an address to the unit a single client controls: IPv4 as is, IPv6 as its /64 prefix (a host can pick any
// address inside its /64, so hashing the full address would let it dodge the limit). Unparseable input is returned
// trimmed and lower-cased so the result stays deterministic.
export function normalizeIp(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    value = end === -1 ? value.slice(1) : value.slice(1, end);
  } else if (/^[^:]+:\d+$/.test(value) && value.includes('.')) {
    value = value.slice(0, value.lastIndexOf(':'));
  }
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);

  const v4 = parseIpv4(value);
  if (v4) return v4.join('.');
  if (value.includes(':')) {
    const groups = parseIpv6Groups(value);
    if (groups) {
      if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
        return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join('.');
      }
      return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
    }
  }
  return value.toLowerCase();
}

export function ipHash(headers: Headers): string {
  return createHash('sha256').update(`${normalizeIp(clientIp(headers))}|${serverEnv('RATE_LIMIT_SALT')}`).digest('hex').slice(0, 32);
}

// Hashed with a server-side salt, so raw IPs are never stored.
export function rateLimitKey(headers: Headers, botId: string): string {
  return `chat:${botId}:${ipHash(headers)}`;
}
