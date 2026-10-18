'use client';

import { SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { parseSources } from '@/lib/chat-sources';
import { MAX_MESSAGE_CHARS } from '@/lib/rag-config';
import { cn } from '@/lib/utils';
import { ChatMessage, type ChatMessageData } from './chat-message';

export interface ChatWindowProps {
  readonly botId: string;
  readonly botName: string;
  readonly welcomeMessage: string;
  readonly mode: 'owner' | 'public';
  readonly initialUsage?: { readonly used: number; readonly limit: number };
  readonly className?: string;
}

interface ApiError {
  readonly error?: { readonly code?: string; readonly message?: string; readonly upgrade?: boolean };
}

interface ApiAnswer {
  readonly answer: string;
  readonly isGrounded: boolean;
  readonly usage: { readonly used: number; readonly limit: number } | null;
  /** Owner mode: documents the answer came from. Absent from older backends, which means none. */
  readonly sources?: unknown;
}

function subscribeNever(): () => void {
  return () => undefined;
}

const FALLBACK_ERROR = 'Something went wrong. Please try again.';

export function ChatWindow({ botId, botName, welcomeMessage, mode, initialUsage, className }: ChatWindowProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessageData[]>([{ id: 'welcome', role: 'assistant', content: welcomeMessage }]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [usage, setUsage] = useState(initialUsage ?? null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  // false on the server and during hydration, true once mounted: inputs stay disabled until React is interactive.
  const ready = useSyncExternalStore(subscribeNever, () => true, () => false);
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
        const sources = mode === 'owner' && body.isGrounded ? parseSources(body.sources) : [];
        setMessages((current) => [...current, { id: nextId(), role: 'assistant', content: body.answer, kind: body.isGrounded ? 'normal' : 'muted', sources }]);
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
  const canSend = ready && !pending && input.trim().length > 0 && !tooLong;

  return (
    <section aria-label={`Chat with ${botName}`} className={cn('flex h-[min(70dvh,640px)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[rgb(8_11_29/0.6)] text-zinc-100 shadow-[0_0_90px_-34px_rgba(99,102,241,0.75)] backdrop-blur-md', className)}>
      {mode === 'owner' && usage ? (
        <p data-testid="chat-usage" className="border-b border-white/10 px-4 py-2 text-xs text-zinc-300">
          {usage.used} / {usage.limit} messages this month
        </p>
      ) : null}
      <div className="flex-1 overflow-y-auto px-4 py-4 [scrollbar-color:rgba(255,255,255,0.25)_transparent] [scrollbar-width:thin]">
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
              <div className="flex items-center gap-2.5 rounded-2xl rounded-bl-md border border-white/12 bg-[rgb(14_17_42/0.78)] px-3.5 py-2 text-sm text-zinc-300">
                <span aria-hidden="true" className="relative flex size-4 items-center justify-center">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-indigo-400/50 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-2.5 animate-pulse rounded-full bg-gradient-to-br from-indigo-200 to-violet-400 shadow-[0_0_12px_3px_rgba(129,140,248,0.75)] motion-reduce:animate-none" />
                </span>
                <span>Thinking…</span>
              </div>
            </li>
          ) : null}
        </ul>
        <div ref={endRef} />
      </div>
      <form
        data-ready={ready ? 'true' : undefined}
        className="space-y-1 border-t border-white/10 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            aria-label="Your question"
            aria-invalid={tooLong}
            disabled={!ready}
            data-ready={ready ? 'true' : undefined}
            placeholder="Ask a question…"
            rows={2}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setValidation(null);
            }}
            onKeyDown={handleKeyDown}
            className="max-h-32 min-h-10 resize-none border-white/40 bg-white/[0.05] text-base text-zinc-100 placeholder:text-zinc-400 focus-visible:border-indigo-300 focus-visible:ring-indigo-300/40 aria-invalid:border-red-300 aria-invalid:ring-red-300/30 md:text-sm"
          />
          <Button type="submit" disabled={!canSend} aria-label="Send" className="h-10 bg-gradient-to-br from-indigo-600 to-violet-600 px-3 text-white shadow-[0_0_24px_-6px_rgba(129,140,248,0.9)] hover:brightness-110 focus-visible:border-indigo-300 focus-visible:ring-indigo-300/60 disabled:opacity-40 disabled:shadow-none">
            <SendHorizontal className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span role={tooLong || validation ? 'alert' : undefined} className="text-red-300">{tooLong ? `Questions can be up to ${MAX_MESSAGE_CHARS} characters.` : validation}</span>
          <span data-testid="char-counter" className={tooLong ? 'text-red-300' : 'text-zinc-400'}>{input.length} / {MAX_MESSAGE_CHARS}</span>
        </div>
      </form>
    </section>
  );
}
