'use server';

import { redirect } from 'next/navigation';
import { parseCredentials } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

export interface AuthFormState {
  readonly error: string | null;
  readonly email: string;
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = parseCredentials(formData);
  if (!input.ok) return { error: input.error, email: input.email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email: input.email, password: input.password });
  if (error) return { error: toFriendlyAuthError(error.message), email: input.email };
  if (!data.session) return { error: 'Account created. Please confirm your email, then sign in.', email: input.email };
  redirect('/dashboard');
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = parseCredentials(formData);
  if (!input.ok) return { error: input.error, email: input.email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
  if (error) return { error: 'Invalid email or password.', email: input.email };
  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}

function toFriendlyAuthError(message: string): string {
  if (/already registered|already exists/i.test(message)) return 'An account with this email already exists. Sign in instead.';
  return 'Could not create the account. Please try again.';
}
