'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthFormState } from '@/app/(auth)/actions';

interface AuthFormProps {
  readonly mode: 'login' | 'signup';
  readonly action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
}

const AUTH_INPUT = 'h-10 border-white/40 bg-white/5 text-zinc-100 placeholder:text-zinc-400 focus-visible:border-indigo-300 focus-visible:ring-indigo-300/40 aria-invalid:border-red-400 aria-invalid:ring-red-400/30';
const AUTH_BUTTON =
  'h-10 w-full bg-indigo-600 text-white shadow-[0_0_28px_-6px_rgba(99,102,241,0.8)] hover:bg-indigo-500 focus-visible:border-indigo-300 focus-visible:ring-indigo-300/60';
const ERROR_ID = 'auth-form-error';

const COPY = {
  login: { title: 'Sign in', description: 'Welcome back to Docly AI.', submit: 'Sign in', switchText: 'No account?', switchHref: '/signup', switchLabel: 'Create one' },
  signup: { title: 'Create your account', description: 'Start free. No card required.', submit: 'Create account', switchText: 'Already have an account?', switchHref: '/login', switchLabel: 'Sign in' },
} as const;

export function AuthForm({ mode, action }: AuthFormProps): React.ReactElement {
  const [state, formAction, isPending] = useActionState(action, { error: null, notice: null, email: '' });
  const copy = COPY[mode];
  const describedBy = state.error ? ERROR_ID : undefined;

  return (
    <Card className="w-full max-w-sm border border-white/10 bg-white/5 text-zinc-100 shadow-[0_0_80px_-24px_rgba(99,102,241,0.6)] ring-0 backdrop-blur-xl">
      <CardHeader>
        <CardTitle className="text-lg text-white">{copy.title}</CardTitle>
        <CardDescription className="text-zinc-400">{copy.description}</CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-zinc-200">Email</Label>
            <Input id="email" className={AUTH_INPUT} name="email" type="email" autoComplete="email" defaultValue={state.email} aria-invalid={state.error ? true : undefined} aria-describedby={describedBy} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-zinc-200">Password</Label>
            <Input id="password" className={AUTH_INPUT} name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} aria-invalid={state.error ? true : undefined} aria-describedby={describedBy} required />
          </div>
          {state.error ? <p id={ERROR_ID} role="alert" className="text-sm text-red-300">{state.error}</p> : null}
          {state.notice ? <p role="status" className="text-sm text-zinc-300">{state.notice}</p> : null}
        </CardContent>
        <CardFooter className="mt-4 flex flex-col gap-3 border-white/10 bg-transparent">
          <Button type="submit" className={AUTH_BUTTON} disabled={isPending}>{isPending ? 'Please wait…' : copy.submit}</Button>
          <p className="text-sm text-zinc-400">
            {copy.switchText} <Link href={copy.switchHref} className="rounded-sm font-medium text-white underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-indigo-300/60">{copy.switchLabel}</Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
