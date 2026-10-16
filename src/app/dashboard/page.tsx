import { BotSettingsForm } from '@/components/dashboard/bot-settings-form';
import { CreateBotForm } from '@/components/dashboard/create-bot-form';
import { DocumentsPanel } from '@/components/dashboard/documents-panel';
import { requireUser } from '@/lib/auth/require-user';
import { getOwnChatbot, getOwnPlan, listDocuments } from '@/lib/chatbots';

export default async function DashboardPage(): Promise<React.ReactElement> {
  const { user, supabase } = await requireUser();
  const chatbot = await getOwnChatbot(supabase, user.id);
  if (!chatbot) return <CreateBotForm />;

  const [documents, plan] = await Promise.all([listDocuments(supabase, chatbot.id), getOwnPlan(supabase, user.id)]);

  return (
    <div className="space-y-6">
      <BotSettingsForm name={chatbot.name} welcomeMessage={chatbot.welcome_message} />
      <DocumentsPanel documents={documents} planName={plan.name} planLimit={plan.documents} />
    </div>
  );
}
