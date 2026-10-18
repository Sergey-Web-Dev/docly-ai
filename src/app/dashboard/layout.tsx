import Link from 'next/link';
import { signOut } from '@/app/(auth)/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/require-user';
import { getPlan } from '@/lib/plans';

export default async function DashboardLayout({ children }: { readonly children: React.ReactNode }): Promise<React.ReactElement> {
  const { user, supabase } = await requireUser();

  const { data: profile, error: profileError } = await supabase.from('profiles').select('plan').eq('id', user.id).single();
  if (profileError) console.error('[dashboard/layout] profiles select failed', { operation: 'select profiles.plan', userId: user.id, code: profileError.code, message: profileError.message });
  const plan = getPlan(profile?.plan);

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <nav aria-label="Main" className="flex items-center gap-4">
            <Link href="/dashboard" className="font-semibold">Docly AI</Link>
            <Link href="/dashboard/chat" className="text-sm text-muted-foreground hover:text-foreground">Chat</Link>
            <Link href="/dashboard/billing" className="text-sm text-muted-foreground hover:text-foreground">Plan</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/billing"><Badge variant="secondary" data-testid="plan-badge">{plan.name} plan</Badge></Link>
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <form action={signOut}><Button variant="ghost" size="sm" type="submit">Sign out</Button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="sr-only">Dashboard</h1>
        {children}
      </main>
    </div>
  );
}
