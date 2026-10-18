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
    <div className="space-ui flex h-dvh flex-col text-zinc-100">
      <header className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#05070f]/40 px-4 py-2.5 backdrop-blur-xl">
        <h1 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white">
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-gradient-to-br from-indigo-300 to-violet-400 shadow-[0_0_12px_2px_rgba(129,140,248,0.7)]" />
          <span className="truncate">{botName}</span>
        </h1>
        <EmbedClose />
      </header>
      <main className="min-h-0 flex-1">
        <ChatWindow
          botId={botId}
          botName={botName}
          welcomeMessage={welcomeMessage}
          mode="public"
          className="h-full min-h-0 rounded-none border-0 bg-[rgb(8_11_29/0.18)] shadow-none backdrop-blur-none"
        />
      </main>
    </div>
  );
}
