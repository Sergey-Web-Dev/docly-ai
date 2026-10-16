import { headers } from 'next/headers';
import Link from 'next/link';
import { BotSettingsForm } from '@/components/dashboard/bot-settings-form';
import { CreateBotForm } from '@/components/dashboard/create-bot-form';
import { DocumentsPanel } from '@/components/dashboard/documents-panel';
import { EmbedPanel } from '@/components/dashboard/embed-panel';
import { buttonVariants } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/require-user';
import { getOwnChatbot, getOwnPlan, listDocuments } from '@/lib/chatbots';

async function getAppOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const requestHeaders = await headers();
  // Proxies may append values ("a.com, b.com"); the first one is the original.
  const first = (name: string): string | undefined => requestHeaders.get(name)?.split(',')[0]?.trim() || undefined;
  const host = first('x-forwarded-host') ?? first('host') ?? 'localhost:3000';
  const protocol = first('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

export default async function DashboardPage(): Promise<React.ReactElement> {
  const { user, supabase } = await requireUser();
  const chatbot = await getOwnChatbot(supabase, user.id);
  if (!chatbot) return <CreateBotForm />;

  const [documents, plan, appOrigin] = await Promise.all([listDocuments(supabase, chatbot.id), getOwnPlan(supabase, user.id), getAppOrigin()]);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Link href="/dashboard/chat" className={buttonVariants({ variant: 'outline' })}>Open chat playground</Link>
      </div>
      <BotSettingsForm name={chatbot.name} welcomeMessage={chatbot.welcome_message} />
      <EmbedPanel botId={chatbot.id} isPublished={chatbot.is_published} appOrigin={appOrigin} />
      <DocumentsPanel documents={documents} planName={plan.name} planLimit={plan.documents} />
    </div>
  );
}
