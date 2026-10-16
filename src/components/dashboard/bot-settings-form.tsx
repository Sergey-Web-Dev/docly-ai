'use client';

import { useActionState } from 'react';
import { updateBot, type ActionState } from '@/app/dashboard/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { BotFields } from './bot-fields';

interface BotSettingsFormProps {
  readonly name: string;
  readonly welcomeMessage: string;
}

const INITIAL: ActionState = { error: null };
const ERROR_ID = 'bot-settings-error';

export function BotSettingsForm({ name, welcomeMessage }: BotSettingsFormProps): React.ReactElement {
  const [state, formAction, isPending] = useActionState(updateBot, INITIAL);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Bot settings</CardTitle>
        <CardDescription>How your assistant introduces itself to visitors.</CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          <BotFields idPrefix="settings" defaultName={name} defaultWelcome={welcomeMessage} errorId={ERROR_ID} invalid={Boolean(state.error)} />
          {state.error ? <p id={ERROR_ID} role="alert" className="text-sm text-destructive">{state.error}</p> : null}
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{state.notice ?? ''}</p>
        </CardContent>
        <CardFooter className="mt-2">
          <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : 'Save changes'}</Button>
        </CardFooter>
      </form>
    </Card>
  );
}
