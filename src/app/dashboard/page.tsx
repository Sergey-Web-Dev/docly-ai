import Link from 'next/link';
import { BotSettingsForm } from '@/components/dashboard/bot-settings-form';
import { CreateBotForm } from '@/components/dashboard/create-bot-form';
import { DocumentsPanel } from '@/components/dashboard/documents-panel';
import { buttonVariants } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/require-user';
import { getOwnChatbot, getOwnPlan, listDocuments } from '@/lib/chatbots';

export default async function DashboardPage(): Promise<React.ReactElement> {
  const { user, supabase } = await requireUser();
  const chatbot = await getOwnChatbot(supabase, user.id);
  if (!chatbot) return <CreateBotForm />;

  const [documents, plan] = await Promise.all([listDocuments(supabase, chatbot.id), getOwnPlan(supabase, user.id)]);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Link href="/dashboard/chat" className={buttonVariants({ variant: 'outline' })}>Open chat playground</Link>
      </div>
      <BotSettingsForm name={chatbot.name} welcomeMessage={chatbot.welcome_message} />
      <DocumentsPanel documents={documents} planName={plan.name} planLimit={plan.documents} />
    </div>
  );
}
