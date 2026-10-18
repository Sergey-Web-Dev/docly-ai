'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { setPlan } from '@/app/dashboard/actions';
import { Button, buttonVariants } from '@/components/ui/button';
import type { Plan, PlanId } from '@/lib/plans';
import { cn } from '@/lib/utils';

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const restoreTrigger = useRef(false);

  // Focus follows the step: Confirm when it appears, the trigger after Cancel.
  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
    } else if (restoreTrigger.current) {
      restoreTrigger.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  // The Confirm button unmounts on success, so move focus to the (always mounted) status message.
  useEffect(() => {
    if (notice) statusRef.current?.focus();
  }, [notice]);

  const isCurrent = plan.id === currentPlanId;

  function confirm(): void {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setPlan('free');
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

  function cancel(): void {
    restoreTrigger.current = true;
    setConfirming(false);
  }

  // Upgrading is only possible through the demo checkout; this component only handles the downgrade.
  if (plan.id === 'pro' && !isCurrent) {
    return (
      <Link href="/dashboard/billing/checkout" className={cn(buttonVariants({ variant: 'default' }), 'w-full bg-indigo-600 text-white hover:bg-indigo-700')}>
        Upgrade to Pro
      </Link>
    );
  }

  return (
    <div>
      {isCurrent ? (
        <Button type="button" variant="outline" className="w-full" disabled>Current plan</Button>
      ) : confirming ? (
        <div role="group" aria-label={`Switch to ${plan.name}`} className="space-y-2 rounded-lg border bg-muted/40 p-3">
          <p className="text-sm">
            Cancel your subscription and switch to Free? Your documents are kept, but new uploads follow the Free limit. No card is needed.
          </p>
          <div className="flex gap-2">
            <Button ref={confirmRef} type="button" size="sm" onClick={confirm} focusableWhenDisabled disabled={pending} aria-label={pending ? undefined : `Confirm switch to ${plan.name}`}>
              {pending ? 'Switching…' : 'Confirm'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={cancel} disabled={pending}>Cancel</Button>
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : (
        <Button ref={triggerRef} type="button" className="w-full" variant="outline" onClick={() => { setNotice(null); setConfirming(true); }}>Cancel subscription (demo)</Button>
      )}
      <p ref={statusRef} role="status" tabIndex={-1} className={notice ? 'mt-2 text-center text-sm text-emerald-700' : undefined}>{notice}</p>
    </div>
  );
}
