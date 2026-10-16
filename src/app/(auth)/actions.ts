'use server';

import { redirect } from 'next/navigation';
import { parseCredentials } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

export interface AuthFormState {
  readonly error: string | null;
  readonly notice: string | null;
  readonly email: string;
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = parseCredentials(formData);
  if (!input.ok) return { error: input.error, notice: null, email: input.email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email: input.email, password: input.password });
  if (error) return { error: toSignUpError(error), notice: null, email: input.email };
  if (!data.session) return { error: null, notice: 'Account created. Please confirm your email, then sign in.', email: input.email };
  redirect('/dashboard');
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = parseCredentials(formData);
  if (!input.ok) return { error: input.error, notice: null, email: input.email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
  if (error) return { error: toSignInError(error), notice: null, email: input.email };
  redirect('/dashboard');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}

interface AuthErrorLike {
  readonly code?: string;
  readonly message: string;
}

function toSignUpError(error: AuthErrorLike): string {
  if (error.code === 'user_already_exists' || error.code === 'email_exists' || (!error.code && /already registered|already exists/i.test(error.message))) {
    return 'An account with this email already exists. Sign in instead.';
  }
  return 'Could not create the account. Please try again.';
}

function toSignInError(error: AuthErrorLike): string {
  if (error.code === 'email_not_confirmed' || (!error.code && /email not confirmed/i.test(error.message))) {
    return 'Please confirm your email before signing in.';
  }
  if (error.code === 'invalid_credentials' || (!error.code && /invalid login credentials/i.test(error.message))) {
    return 'Invalid email or password.';
  }
  return 'Could not sign in. Please try again.';
}
