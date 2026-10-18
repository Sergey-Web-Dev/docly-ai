import Link from 'next/link';
import { signOut } from '@/app/(auth)/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/require-user';
import { getPlan } from '@/lib/plans';

const NAV_FOCUS = 'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70';

export default async function DashboardLayout({ children }: { readonly children: React.ReactNode }): Promise<React.ReactElement> {
  const { user, supabase } = await requireUser();

  const { data: profile, error: profileError } = await supabase.from('profiles').select('plan').eq('id', user.id).single();
  if (profileError) console.error('[dashboard/layout] profiles select failed', { operation: 'select profiles.plan', userId: user.id, code: profileError.code, message: profileError.message });
  const plan = getPlan(profile?.plan);

  return (
    <div className="space-ui min-h-dvh">
      <header className="border-b border-white/10 bg-[#05070f]/55 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <nav aria-label="Main" className="flex items-center gap-4">
            <Link href="/dashboard" className={`${NAV_FOCUS} flex items-center gap-2 font-semibold text-white`}>
              <span aria-hidden="true" className="size-2.5 rounded-full bg-gradient-to-br from-indigo-300 to-violet-400 shadow-[0_0_12px_2px_rgba(129,140,248,0.7)]" />
              Docly AI
            </Link>
            <Link href="/dashboard/chat" className={`${NAV_FOCUS} text-sm text-muted-foreground hover:text-white`}>Chat</Link>
            <Link href="/dashboard/billing" className={`${NAV_FOCUS} text-sm text-muted-foreground hover:text-white`}>Plan</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/billing" className={`${NAV_FOCUS} rounded-full`}><Badge variant="secondary" data-testid="plan-badge">{plan.name} plan</Badge></Link>
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
