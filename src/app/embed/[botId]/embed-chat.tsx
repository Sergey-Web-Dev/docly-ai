'use client';

import { ChatWindow } from '@/components/chat/chat-window';
import { EmbedClose } from './embed-close';

interface EmbedChatProps {
  readonly botId: string;
  readonly botName: string;
  readonly welcomeMessage: string;
}

export function EmbedChat({ botId, botName, welcomeMessage }: EmbedChatProps): React.ReactElement {
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h1 className="truncate text-sm font-semibold">{botName}</h1>
        <EmbedClose />
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
