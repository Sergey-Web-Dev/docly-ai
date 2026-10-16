import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signOut } from '@/app/(auth)/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getPlan } from '@/lib/plans';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardLayout({ children }: { readonly children: React.ReactNode }): Promise<React.ReactElement> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('plan').eq('id', user.id).single();
  const plan = getPlan(profile?.plan);

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/dashboard" className="font-semibold">Docly AI</Link>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" data-testid="plan-badge">{plan.name} plan</Badge>
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <form action={signOut}><Button variant="ghost" size="sm" type="submit">Sign out</Button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
