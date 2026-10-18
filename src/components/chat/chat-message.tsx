import { FileText } from 'lucide-react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { sourcesLabel, type ChatSource } from '@/lib/chat-sources';
import { cn } from '@/lib/utils';

export interface ChatMessageData {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly kind?: 'normal' | 'muted' | 'error';
  readonly upgrade?: boolean;
  readonly retryable?: boolean;
  /** Documents the answer came from. Only ever rendered in owner mode. */
  readonly sources?: readonly ChatSource[];
}

interface ChatMessageProps {
  readonly message: ChatMessageData;
  readonly mode: 'owner' | 'public';
  readonly onRetry?: () => void;
  readonly retryDisabled?: boolean;
}

function SourceChips({ sources }: { readonly sources: readonly ChatSource[] }): React.ReactElement {
  const label = sourcesLabel(sources.length);
  return (
    <div data-testid="chat-sources" className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-white/10 pt-2">
      <span className="text-xs font-medium text-zinc-300">{label}</span>
      <ul aria-label={label} className="flex min-w-0 flex-wrap gap-1.5">
        {sources.map((source) => (
          <li key={source.documentId} data-testid="chat-source" title={source.fileName} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-indigo-300/30 bg-indigo-400/10 py-1 pl-2 pr-2.5 text-xs text-indigo-100">
            <FileText className="size-3.5 shrink-0 text-indigo-200" aria-hidden />
            <span className="truncate">{source.fileName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChatMessage({ message, mode, onRetry, retryDisabled }: ChatMessageProps): React.ReactElement {
  const isUser = message.role === 'user';
  const isError = message.kind === 'error';
  // The public widget never shows file names, even if a response carried them.
  const sources = mode === 'owner' && !isUser && !isError ? (message.sources ?? []) : [];
  return (
    <li className={cn('flex', isUser ? 'justify-end' : 'justify-start')} data-role={message.role} data-kind={message.kind ?? 'normal'}>
      <div
        className={cn(
          'max-w-[85%] space-y-2 whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          isUser && 'rounded-br-md bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-[0_8px_26px_-12px_rgba(124,106,255,0.95)]',
          !isUser && !isError && 'rounded-bl-md border border-white/12 bg-[rgb(14_17_42/0.78)] text-zinc-100 shadow-[0_0_30px_-16px_rgba(129,140,248,0.9)]',
          message.kind === 'muted' && 'border-white/10 bg-[rgb(14_17_42/0.6)] text-zinc-300 shadow-none',
          isError && 'rounded-bl-md border border-red-300/40 bg-red-400/10 text-red-100',
        )}
      >
        <p>{message.content}</p>
        {sources.length > 0 ? <SourceChips sources={sources} /> : null}
        {isError && (message.retryable || (message.upgrade && mode === 'owner')) ? (
          <div className="flex flex-wrap gap-2">
            {message.retryable && onRetry ? (
              <Button type="button" size="sm" variant="outline" className="border-white/30 bg-white/5 text-zinc-100 hover:bg-white/10 hover:text-white" onClick={onRetry} disabled={retryDisabled}>Try again</Button>
            ) : null}
            {message.upgrade && mode === 'owner' ? (
              <Link href="/dashboard/billing" className={cn(buttonVariants({ size: 'sm' }), 'bg-indigo-600 text-white hover:bg-indigo-500')}>Upgrade to Pro</Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
