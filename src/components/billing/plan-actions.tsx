'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setPlan } from '@/app/dashboard/actions';
import { Button } from '@/components/ui/button';
import type { Plan, PlanId } from '@/lib/plans';

interface PlanActionsProps {
  readonly plan: Plan;
  readonly currentPlanId: PlanId;
}

export function PlanActions({ plan, currentPlanId }: PlanActionsProps): React.ReactElement {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (plan.id === currentPlanId) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="outline" className="w-full" disabled>Current plan</Button>
        {notice ? <p role="status" className="text-center text-sm text-emerald-700">{notice}</p> : null}
      </div>
    );
  }

  const label = plan.id === 'pro' ? 'Demo upgrade — no payment' : 'Downgrade to Free';

  function confirm(): void {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setPlan(plan.id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotice(`You are now on the ${plan.name} plan.`);
        setConfirming(false);
        router.refresh();
      } catch {
        setError('Something went wrong. Please try again.');
      }
    });
  }

  if (!confirming) {
    return <Button type="button" className="w-full" variant={plan.id === 'pro' ? 'default' : 'outline'} onClick={() => setConfirming(true)}>{label}</Button>;
  }

  return (
    <div role="group" aria-label={`Confirm switch to ${plan.name}`} className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <p className="text-sm">
        {plan.id === 'pro' ? 'Switch to Pro? This is a demo — nothing is charged.' : 'Switch to Free? Your documents are kept, but new uploads follow the Free limit.'}
      </p>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={confirm} disabled={pending}>{pending ? 'Switching…' : 'Confirm'}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>Cancel</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
