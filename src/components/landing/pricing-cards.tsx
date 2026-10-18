import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PLANS, type Plan } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { CtaLink } from './cta-link';

type PricingTone = 'light' | 'dark';

interface PricingCardsProps {
  /** `dark` for the space landing page; billing keeps the default light look. */
  readonly tone?: PricingTone;
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

export function PricingCards({ renderAction = defaultAction, tone = 'light' }: PricingCardsProps): React.ReactElement {
  const isDark = tone === 'dark';
  const isPro = (plan: Plan): boolean => plan.id === 'pro';
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {Object.values(PLANS).map((plan) => (
        <li key={plan.id}>
          <Card
            className={cn(
              'h-full border shadow-none ring-0',
              isDark
                ? cn('text-zinc-100 backdrop-blur-xl', isPro(plan) ? 'border-indigo-400/60 bg-indigo-500/10 shadow-[0_0_48px_-14px_rgba(99,102,241,0.8)]' : 'border-white/10 bg-white/5')
                : cn('bg-white', isPro(plan) ? 'border-indigo-600' : 'border-zinc-200'),
            )}
          >
            <CardHeader>
              <CardTitle className={cn('text-base', isDark ? 'text-white' : 'text-zinc-950')}>{plan.name}</CardTitle>
              <CardDescription className={isDark ? 'text-zinc-400' : 'text-zinc-600'}>
                <span className={cn('text-3xl font-semibold', isDark ? 'text-white' : 'text-zinc-950')}>${plan.priceUsd}</span> / mo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className={cn('space-y-2 text-sm', isDark ? 'text-zinc-300' : 'text-zinc-700')}>
                {planFeatures(plan).map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <Check className={cn('size-4 shrink-0', isDark ? 'text-indigo-300' : 'text-indigo-600')} aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className={cn('flex-col items-stretch gap-2', isDark && 'border-white/10 bg-transparent')}>
              {renderAction(plan)}
              {plan.id === 'pro' && <p className={cn('text-center text-xs', isDark ? 'text-zinc-400' : 'text-zinc-500')}>Demo checkout — test cards only</p>}
            </CardFooter>
          </Card>
        </li>
      ))}
    </ul>
  );
}
