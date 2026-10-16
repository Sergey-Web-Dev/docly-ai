'use client';

import { Bot } from 'lucide-react';
import { useActionState } from 'react';
import { createBot, type ActionState } from '@/app/dashboard/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { BotFields } from './bot-fields';

const INITIAL: ActionState = { error: null };
const ERROR_ID = 'create-bot-error';

export function CreateBotForm(): React.ReactElement {
  const [state, formAction, isPending] = useActionState(createBot, INITIAL);

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <Bot className="mb-1 size-8 text-primary" aria-hidden />
        <CardTitle as="h2">Create your bot</CardTitle>
        <CardDescription>Give your assistant a name and a welcome message, then upload your documents.</CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          <BotFields idPrefix="create" defaultName="" defaultWelcome="" errorId={ERROR_ID} invalid={Boolean(state.error)} />
          {state.error ? <p id={ERROR_ID} role="alert" className="text-sm text-destructive">{state.error}</p> : null}
        </CardContent>
        <CardFooter className="mt-4">
          <Button type="submit" disabled={isPending}>{isPending ? 'Creating…' : 'Create bot'}</Button>
        </CardFooter>
      </form>
    </Card>
  );
}
