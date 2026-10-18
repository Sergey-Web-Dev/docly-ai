import { Info } from 'lucide-react';
import { PlanActions } from '@/components/billing/plan-actions';
import { PricingCards } from '@/components/landing/pricing-cards';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/require-user';
import { getBillingSummary } from '@/lib/billing';

export default async function BillingPage(): Promise<React.ReactElement> {
  const { user, supabase } = await requireUser();
  const summary = await getBillingSummary(supabase, user.id);
  const excess = summary.documents.used - summary.documents.limit;
  const messagesOver = summary.messages.used > summary.messages.limit;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Plan &amp; billing</h2>
        <p className="text-sm text-muted-foreground">You are on the {summary.plan.name} plan.</p>
      </div>

      <div role="note" className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>Billing is simulated for this demo. Upgrading uses a demo checkout that only accepts Stripe test cards; no real card is ever needed and no money is charged.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h3">Usage</CardTitle>
          <CardDescription>Limits of your current plan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Documents</dt>
              <dd data-testid="billing-documents" className="text-lg font-semibold">{summary.documents.used} / {summary.documents.limit}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Messages this month</dt>
              <dd data-testid="billing-messages" className="text-lg font-semibold">{summary.messages.used} / {summary.messages.limit}</dd>
            </div>
          </dl>
          {summary.isOverDocumentLimit ? (
            <p role="status" data-testid="billing-over-limit" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              You have {summary.documents.used} {summary.documents.used === 1 ? 'document' : 'documents'}; the {summary.plan.name} plan allows {summary.documents.limit}. Existing documents keep working, but new uploads are blocked until you delete {excess} {excess === 1 ? 'document' : 'documents'}.
            </p>
          ) : null}
          {messagesOver ? (
            <p role="status" data-testid="billing-messages-over" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              You have used {summary.messages.used} messages this month; the {summary.plan.name} plan includes {summary.messages.limit}. New messages are blocked until next month or until you upgrade.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <PricingCards renderAction={(plan) => <PlanActions plan={plan} currentPlanId={summary.plan.id} />} />
    </div>
  );
}
