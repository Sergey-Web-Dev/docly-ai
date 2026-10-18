import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PLANS, type Plan } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { CtaLink } from './cta-link';

interface PricingCardsProps {
  readonly renderAction?: (plan: Plan) => ReactNode;
}

function planFeatures(plan: Plan): readonly string[] {
  return [
    `${plan.bots} ${plan.bots === 1 ? 'bot' : 'bots'}`,
    `${plan.documents} documents`,
    `${plan.messagesPerMonth} messages / month`,
    plan.hasWidget ? 'Embeddable chat widget' : 'No embeddable widget',
    plan.hasBranding ? 'Accent color (coming soon)' : 'Default branding',
  ];
}

function defaultAction(plan: Plan): ReactNode {
  return (
    <CtaLink href="/signup" tone={plan.id === 'pro' ? 'accent' : 'outline'} className="w-full">
      Choose {plan.name}
    </CtaLink>
  );
}

export function PricingCards({ renderAction = defaultAction }: PricingCardsProps): React.ReactElement {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {Object.values(PLANS).map((plan) => (
        <li key={plan.id}>
          <Card className={cn('h-full border bg-white shadow-none ring-0', plan.id === 'pro' ? 'border-indigo-600' : 'border-zinc-200')}>
            <CardHeader>
              <CardTitle className="text-base text-zinc-950">{plan.name}</CardTitle>
              <CardDescription className="text-zinc-600">
                <span className="text-3xl font-semibold text-zinc-950">${plan.priceUsd}</span> / mo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-zinc-700">
                {planFeatures(plan).map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-indigo-600" aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-2">
              {renderAction(plan)}
              {plan.id === 'pro' && <p className="text-center text-xs text-zinc-500">Demo checkout — test cards only</p>}
            </CardFooter>
          </Card>
        </li>
      ))}
    </ul>
  );
}
