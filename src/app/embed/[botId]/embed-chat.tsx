'use client';

import { X } from 'lucide-react';
import { useEffect } from 'react';
import { ChatWindow } from '@/components/chat/chat-window';
import { Button } from '@/components/ui/button';

interface EmbedChatProps {
  readonly botId: string;
  readonly botName: string;
  readonly welcomeMessage: string;
}

export function EmbedChat({ botId, botName, welcomeMessage }: EmbedChatProps): React.ReactElement {
  useEffect(() => {
    // Esc inside the iframe never reaches the host page, so ask the loader to close.
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') window.parent.postMessage({ type: 'docly:close' }, '*');
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h1 className="truncate text-sm font-semibold">{botName}</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close chat"
          onClick={() => window.parent.postMessage({ type: 'docly:close' }, '*')}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>
      <main className="min-h-0 flex-1">
        <ChatWindow
          botId={botId}
          botName={botName}
          welcomeMessage={welcomeMessage}
          mode="public"
          className="h-full min-h-0 rounded-none ring-0"
        />
      </main>
    </div>
  );
}
