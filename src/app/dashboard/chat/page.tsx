import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChatWindow } from '@/components/chat/chat-window';
import { buttonVariants } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/require-user';
import { getOwnChatbot, getOwnPlan, listDocuments } from '@/lib/chatbots';
import { getMonthlyUsage } from '@/lib/usage';

export default async function ChatPlaygroundPage(): Promise<React.ReactElement> {
  const { user, supabase } = await requireUser();
  const chatbot = await getOwnChatbot(supabase, user.id);
  if (!chatbot) redirect('/dashboard');

  const [documents, plan, used] = await Promise.all([
    listDocuments(supabase, chatbot.id),
    getOwnPlan(supabase, user.id),
    getMonthlyUsage(supabase, user.id),
  ]);
  const hasReadyDocument = documents.some((document) => document.status === 'ready');

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{chatbot.name}</h2>
        <p className="text-sm text-muted-foreground">Test your bot</p>
      </div>
      {hasReadyDocument ? null : (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed bg-background p-3 text-sm">
          <span>Upload at least one document to get answers</span>
          <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Go to documents</Link>
        </div>
      )}
      <ChatWindow
        botId={chatbot.id}
        botName={chatbot.name}
        welcomeMessage={chatbot.welcome_message}
        mode="owner"
        initialUsage={{ used, limit: plan.messagesPerMonth }}
      />
    </div>
  );
}
