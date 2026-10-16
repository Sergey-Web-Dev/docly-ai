import { z } from 'zod';

const credentialsSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(72, 'Password is too long.'),
});

export type CredentialsResult =
  | { readonly ok: true; readonly email: string; readonly password: string }
  | { readonly ok: false; readonly email: string; readonly error: string };

export function parseCredentials(formData: FormData): CredentialsResult {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const parsed = credentialsSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, email, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  return { ok: true, ...parsed.data };
}
