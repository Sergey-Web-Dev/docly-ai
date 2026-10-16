export type PlanId = 'free' | 'pro';

export interface Plan {
  readonly id: PlanId;
  readonly name: string;
  readonly priceUsd: number;
  readonly bots: number;
  readonly documents: number;
  readonly messagesPerMonth: number;
  readonly hasWidget: boolean;
  readonly hasBranding: boolean;
}

export const PLANS: Readonly<Record<PlanId, Plan>> = {
  free: { id: 'free', name: 'Free', priceUsd: 0, bots: 1, documents: 2, messagesPerMonth: 30, hasWidget: true, hasBranding: false },
  pro: { id: 'pro', name: 'Pro', priceUsd: 19, bots: 1, documents: 10, messagesPerMonth: 300, hasWidget: true, hasBranding: true },
};

export function getPlan(planId: string | null | undefined): Plan {
  return planId === 'pro' ? PLANS.pro : PLANS.free;
}
