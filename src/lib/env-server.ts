import 'server-only';

type ServerEnvName = 'SUPABASE_SECRET_KEY' | 'GEMINI_API_KEY' | 'GEMINI_EMBEDDING_MODEL' | 'GEMINI_CHAT_MODEL' | 'RATE_LIMIT_SALT';

export function serverEnv(name: ServerEnvName): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
