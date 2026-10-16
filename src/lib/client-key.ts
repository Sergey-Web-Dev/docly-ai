import 'server-only';
import { createHash } from 'node:crypto';
import { serverEnv } from '@/lib/env-server';

export function clientIp(headers: Headers): string {
  const candidate = headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip') ?? headers.get('x-forwarded-for') ?? '';
  return candidate.split(',')[0]?.trim() || 'unknown';
}

// Hashed with a server-side salt, so raw IPs are never stored.
export function rateLimitKey(headers: Headers, botId: string): string {
  const digest = createHash('sha256').update(`${clientIp(headers)}|${serverEnv('RATE_LIMIT_SALT')}`).digest('hex').slice(0, 32);
  return `chat:${botId}:${digest}`;
}
