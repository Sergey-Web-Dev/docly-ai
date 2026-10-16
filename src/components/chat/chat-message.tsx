import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from 'cn';

export interface ChatMessageData {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly kind?: 'normal' | 'muted' | 'error';
  readonly upgrade?: boolean;
  readonly retryable?: boolean;
}

interface ChatMessageProps {
  readonly message: ChatMessageData;
  readonly mode: 'owner' | 'public';
  readonly onRetry?: () => void;
  readonly retryDisabled?: boolean;
}

export function ChatMessage({ message, mode, onRetry, retryDisabled }: ChatMessageProps): React.ReactElement {
  const isUser = message.role === 'user';
  const isError = message.kind === 'error';
  return (
    <li className={cn('flex', isUser ? 'justify-end' : 'justify-start')} data-role={message.role} data-kind={message.kind ?? 'normal'}>
      <div
        className={cn(
          'max-w-[85%] space-y-2 whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          isUser && 'rounded-br-md bg-primary text-primary-foreground',
          !isUser && !isError && 'rounded-bl-md bg-muted text-foreground',
          message.kind === 'muted' && 'text-muted-foreground',
          isError && 'rounded-bl-md border border-destructive/30 bg-destructive/5 text-destructive',
        )}
      >
        <p>{message.content}</p>
        {isError && (message.retryable || (message.upgrade && mode === 'owner')) ? (
          <div className="flex flex-wrap gap-2">
            {message.retryable && onRetry ? (
              <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={retryDisabled}>Try again</Button>
            ) : null}
            {message.upgrade && mode === 'owner' ? (
              <Link href="/#pricing" className={buttonVariants({ size: 'sm' })}>Upgrade to Pro</Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
