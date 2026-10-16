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

const COPY = {
  login: { title: 'Sign in', description: 'Welcome back to Docly AI.', submit: 'Sign in', switchText: 'No account?', switchHref: '/signup', switchLabel: 'Create one' },
  signup: { title: 'Create your account', description: 'Start free. No card required.', submit: 'Create account', switchText: 'Already have an account?', switchHref: '/login', switchLabel: 'Sign in' },
} as const;

export function AuthForm({ mode, action }: AuthFormProps): React.ReactElement {
  const [state, formAction, isPending] = useActionState(action, { error: null, email: '' });
  const copy = COPY[mode];

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" defaultValue={state.email} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required />
          </div>
          {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
        </CardContent>
        <CardFooter className="mt-4 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={isPending}>{isPending ? 'Please wait…' : copy.submit}</Button>
          <p className="text-sm text-muted-foreground">
            {copy.switchText} <Link href={copy.switchHref} className="font-medium text-foreground underline-offset-4 hover:underline">{copy.switchLabel}</Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
