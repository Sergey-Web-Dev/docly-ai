import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { CheckoutForm } from '@/components/billing/checkout-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/require-user';
import { getOwnPlan } from '@/lib/chatbots';
import { PLANS } from '@/lib/plans';

const PRICE_LABEL = `$${PLANS.pro.priceUsd.toFixed(2)}`;

export default async function CheckoutPage(): Promise<React.ReactElement> {
  const { user, supabase } = await requireUser();
  const plan = await getOwnPlan(supabase, user.id);

  return (
    <div className="space-y-6">
      <Link href="/dashboard/billing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Back to billing
      </Link>
      <h2 className="text-xl font-semibold">Checkout</h2>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit bg-white">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle as="h3">Order summary</CardTitle>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Test mode</span>
            </div>
            <CardDescription>Billed monthly · cancel anytime</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt>Docly AI Pro — monthly</dt><dd>{PRICE_LABEL}</dd></div>
              <div className="flex justify-between gap-4 border-t pt-3 text-muted-foreground"><dt>Subtotal</dt><dd>{PRICE_LABEL}</dd></div>
              <div className="flex justify-between gap-4 border-t pt-3 text-base font-semibold"><dt>Total due today</dt><dd data-testid="checkout-total">{PRICE_LABEL}</dd></div>
            </dl>
          </CardContent>
        </Card>

        <Card className="bg-white">
          <CardHeader>
            <CardTitle as="h3">Payment details</CardTitle>
          </CardHeader>
          <CardContent>
            <CheckoutForm email={user.email ?? ''} priceLabel={PRICE_LABEL} isAlreadyPro={plan.id === 'pro'} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
