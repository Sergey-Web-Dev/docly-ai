import { Bot } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/require-user';

export default async function DashboardPage(): Promise<React.ReactElement> {
  await requireUser();
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <Bot className="size-10 text-primary" aria-hidden />
        <CardTitle>Create your bot</CardTitle>
        <CardDescription>Give your assistant a name and welcome message, then upload your documents.</CardDescription>
      </CardHeader>
    </Card>
  );
}
