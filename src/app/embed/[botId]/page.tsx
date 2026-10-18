import type { Metadata } from 'next';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { EmbedChat } from './embed-chat';
import { EmbedClose } from './embed-close';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Chat',
  robots: { index: false, follow: false },
};

function Unavailable(): React.ReactElement {
  return (
    <main className="space-ui relative flex h-dvh items-center justify-center p-6">
      <div className="absolute right-3 top-3">
        <EmbedClose />
      </div>
      <div role="status" className="max-w-xs space-y-1 rounded-2xl border border-white/15 bg-white/5 p-6 text-center backdrop-blur-xl">
        <h1 className="text-base font-semibold">This assistant is unavailable</h1>
        <p className="text-sm text-zinc-300">Please check back later.</p>
      </div>
    </main>
  );
}

export default async function EmbedPage({ params }: PageProps<'/embed/[botId]'>): Promise<React.ReactElement> {
  const { botId } = await params;
  if (!z.uuid().safeParse(botId).success) return <Unavailable />;

  // Public page: only these three columns are read, with the admin client, and nothing else is exposed.
  const { data: bot, error } = await createAdminClient().from('chatbots').select('name, welcome_message, is_published').eq('id', botId).maybeSingle();
  if (error) console.error('[embed] bot lookup failed', { botId, code: error.code });
  if (!bot?.is_published) return <Unavailable />;

  return <EmbedChat botId={botId} botName={bot.name} welcomeMessage={bot.welcome_message} />;
}
