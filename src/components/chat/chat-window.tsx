'use client';

import { Loader2, SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MAX_MESSAGE_CHARS } from '@/lib/rag-config';
import { ChatMessage, type ChatMessageData } from './chat-message';

export interface ChatWindowProps {
  readonly botId: string;
  readonly botName: string;
  readonly welcomeMessage: string;
  readonly mode: 'owner' | 'public';
  readonly initialUsage?: { readonly used: number; readonly limit: number };
}

interface ApiError {
  readonly error?: { readonly code?: string; readonly message?: string; readonly upgrade?: boolean };
}

interface ApiAnswer {
  readonly answer: string;
  readonly isGrounded: boolean;
  readonly usage: { readonly used: number; readonly limit: number } | null;
}

const FALLBACK_ERROR = 'Something went wrong. Please try again.';

export function ChatWindow({ botId, botName, welcomeMessage, mode, initialUsage }: ChatWindowProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessageData[]>([{ id: 'welcome', role: 'assistant', content: welcomeMessage }]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [usage, setUsage] = useState(initialUsage ?? null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, pending]);

  function nextId(): string {
    counter.current += 1;
    return `m${counter.current}`;
  }

  async function ask(question: string, isRetry: boolean): Promise<void> {
    setPending(true);
    setMessages((current) => {
      const base = isRetry ? current.filter((m) => m.kind !== 'error') : current;
      return isRetry ? base : [...base, { id: nextId(), role: 'user', content: question }];
    });
    setLastQuestion(question);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, message: question }),
      });
      if (response.ok) {
        const body = (await response.json()) as ApiAnswer;
        setMessages((current) => [...current, { id: nextId(), role: 'assistant', content: body.answer, kind: body.isGrounded ? 'normal' : 'muted' }]);
        if (body.usage) setUsage(body.usage);
      } else {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        const code = body.error?.code;
        setMessages((current) => [
          ...current,
          {
            id: nextId(),
            role: 'assistant',
            kind: 'error',
            content: body.error?.message ?? FALLBACK_ERROR,
            upgrade: body.error?.upgrade === true,
            retryable: code === 'PROVIDER_UNAVAILABLE',
          },
        ]);
      }
    } catch {
      setMessages((current) => [...current, { id: nextId(), role: 'assistant', kind: 'error', content: FALLBACK_ERROR, retryable: true }]);
    } finally {
      setPending(false);
    }
  }

  function submit(): void {
    const question = input.trim();
    if (pending) return;
    if (question.length === 0) return;
    if (input.length > MAX_MESSAGE_CHARS) {
      setValidation(`Questions can be up to ${MAX_MESSAGE_CHARS} characters.`);
      return;
    }
    setValidation(null);
    setInput('');
    void ask(question, false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  const tooLong = input.length > MAX_MESSAGE_CHARS;
  const canSend = !pending && input.trim().length > 0 && !tooLong;

  return (
    <section aria-label={`Chat with ${botName}`} className="flex h-[min(70dvh,640px)] min-h-[420px] flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {mode === 'owner' && usage ? (
        <p data-testid="chat-usage" className="border-b px-4 py-2 text-xs text-muted-foreground">
          {usage.used} / {usage.limit} messages this month
        </p>
      ) : null}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ul aria-live="polite" aria-label="Conversation" className="space-y-3">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              mode={mode}
              retryDisabled={pending}
              onRetry={lastQuestion ? () => void ask(lastQuestion, true) : undefined}
            />
          ))}
          {pending ? (
            <li className="flex justify-start" data-testid="typing-indicator">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                <span>Thinking…</span>
              </div>
            </li>
          ) : null}
        </ul>
        <div ref={endRef} />
      </div>
      <form
        className="space-y-1 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            aria-label="Your question"
            aria-invalid={tooLong}
            placeholder="Ask a question…"
            rows={2}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setValidation(null);
            }}
            onKeyDown={handleKeyDown}
            className="max-h-32 min-h-10 resize-none"
          />
          <Button type="submit" disabled={!canSend} aria-label="Send" className="h-10 px-3">
            <SendHorizontal className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span role={tooLong || validation ? 'alert' : undefined} className="text-destructive">{tooLong ? `Questions can be up to ${MAX_MESSAGE_CHARS} characters.` : validation}</span>
          <span data-testid="char-counter" className={tooLong ? 'text-destructive' : 'text-muted-foreground'}>{input.length} / {MAX_MESSAGE_CHARS}</span>
        </div>
      </form>
    </section>
  );
}
