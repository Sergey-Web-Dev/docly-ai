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

const botSettingsSchema = z.object({
  name: z.string().min(1, 'Name is required.').max(60, 'Name must be 60 characters or fewer.'),
  welcomeMessage: z.string().min(1, 'Welcome message is required.').max(300, 'Welcome message must be 300 characters or fewer.'),
});

export interface BotSettingsValues {
  readonly name: string;
  readonly welcomeMessage: string;
}

export type BotSettingsResult =
  | ({ readonly ok: true } & BotSettingsValues)
  | { readonly ok: false; readonly error: string; readonly values: BotSettingsValues };

export function parseBotSettings(formData: FormData): BotSettingsResult {
  const values: BotSettingsValues = {
    name: String(formData.get('name') ?? '').trim(),
    welcomeMessage: String(formData.get('welcomeMessage') ?? '').trim(),
  };
  const parsed = botSettingsSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.', values };
  }
  return { ok: true, ...parsed.data };
}
