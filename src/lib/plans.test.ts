import { describe, expect, it } from 'vitest';
import { getPlan, PLANS } from '@/lib/plans';

describe('plans', () => {
  it('should define Free limits from the SDD when reading free plan', () => {
    expect(PLANS.free).toMatchObject({ priceUsd: 0, bots: 1, documents: 2, messagesPerMonth: 30, hasWidget: true, hasBranding: false });
  });

  it('should define Pro limits from the SDD when reading pro plan', () => {
    expect(PLANS.pro).toMatchObject({ priceUsd: 19, bots: 1, documents: 10, messagesPerMonth: 300, hasWidget: true, hasBranding: true });
  });

  it('should return pro when plan id is pro', () => {
    expect(getPlan('pro').id).toBe('pro');
  });

  it('should fall back to free when plan id is unknown or missing', () => {
    expect(getPlan('enterprise').id).toBe('free');
    expect(getPlan(null).id).toBe('free');
  });
});
