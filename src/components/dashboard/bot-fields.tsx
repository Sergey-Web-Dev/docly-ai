'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export const NAME_MAX = 60;
export const WELCOME_MAX = 300;

interface BotFieldsProps {
  readonly idPrefix: string;
  readonly defaultName: string;
  readonly defaultWelcome: string;
  readonly errorId?: string;
  readonly invalid: boolean;
}

export function BotFields({ idPrefix, defaultName, defaultWelcome, errorId, invalid }: BotFieldsProps): React.ReactElement {
  const [name, setName] = useState(defaultName);
  const [welcome, setWelcome] = useState(defaultWelcome);
  const describedBy = invalid ? errorId : undefined;

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={`${idPrefix}-name`}>Bot name</Label>
          <span className="text-xs text-muted-foreground" aria-hidden>{name.length}/{NAME_MAX}</span>
        </div>
        <Input id={`${idPrefix}-name`} name="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={NAME_MAX} placeholder="Acme Helper" autoComplete="off" aria-invalid={invalid ? true : undefined} aria-describedby={describedBy} required />
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={`${idPrefix}-welcome`}>Welcome message</Label>
          <span className="text-xs text-muted-foreground" aria-hidden>{welcome.length}/{WELCOME_MAX}</span>
        </div>
        <Textarea id={`${idPrefix}-welcome`} name="welcomeMessage" value={welcome} onChange={(event) => setWelcome(event.target.value)} maxLength={WELCOME_MAX} rows={3} placeholder="Hi! Ask me anything about our company." aria-invalid={invalid ? true : undefined} aria-describedby={describedBy} required />
      </div>
    </>
  );
}
