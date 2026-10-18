import { describe, expect, it } from 'vitest';
import { MAX_ALPHA, MAX_RADIUS, MIN_ALPHA, MIN_RADIUS, TONE_COUNT, clampOffset, createRng, easeToward, generateStars, starCountForArea, trailLength, wrapUnit } from './starfield';

describe('createRng', () => {
  it('should return the same sequence when seeded identically', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('should return values in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('generateStars', () => {
  it('should be deterministic when the seed is the same', () => {
    expect(generateStars(50, 1)).toEqual(generateStars(50, 1));
  });

  it('should differ when the seed differs', () => {
    expect(generateStars(50, 1)).not.toEqual(generateStars(50, 2));
  });

  it('should keep every star within its documented ranges', () => {
    for (const star of generateStars(150, 3)) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(1);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(1);
      expect(star.z).toBeGreaterThanOrEqual(0.15);
      expect(star.z).toBeLessThanOrEqual(1);
      expect(star.radius).toBeGreaterThanOrEqual(MIN_RADIUS);
      expect(star.radius).toBeLessThanOrEqual(MAX_RADIUS);
      expect(star.alpha).toBeGreaterThanOrEqual(MIN_ALPHA);
      expect(star.alpha).toBeLessThanOrEqual(MAX_ALPHA);
      expect(star.tone).toBeLessThan(TONE_COUNT);
    }
  });

  it('should return exactly the requested count', () => {
    expect(generateStars(0, 1)).toHaveLength(0);
    expect(generateStars(123, 1)).toHaveLength(123);
  });
});

describe('starCountForArea', () => {
  it('should scale with the viewport area', () => {
    expect(starCountForArea(1920, 1080, 1)).toBeGreaterThan(starCountForArea(600, 800, 1));
  });

  it('should stay between 120 and 220 at full density', () => {
    expect(starCountForArea(100, 100, 1)).toBe(120);
    expect(starCountForArea(8000, 6000, 1)).toBe(220);
  });

  it('should reduce the count when density is lowered', () => {
    expect(starCountForArea(1920, 1080, 0.5)).toBeLessThan(starCountForArea(1920, 1080, 1));
  });
});

describe('clampOffset', () => {
  it('should clamp values above the maximum', () => {
    expect(clampOffset(500, 40)).toBe(40);
  });

  it('should clamp values below the negative maximum', () => {
    expect(clampOffset(-500, 40)).toBe(-40);
  });

  it('should leave values inside the range unchanged', () => {
    expect(clampOffset(12, 40)).toBe(12);
  });
});

describe('easeToward', () => {
  it('should move part of the way to the target', () => {
    expect(easeToward(0, 10, 0.5)).toBe(5);
  });

  it('should not move when the factor is zero', () => {
    expect(easeToward(3, 10, 0)).toBe(3);
  });

  it('should reach the target when the factor is one', () => {
    expect(easeToward(3, 10, 1)).toBe(10);
  });
});

describe('wrapUnit', () => {
  it('should wrap values past 1 back into [0, 1)', () => {
    expect(wrapUnit(1.25)).toBeCloseTo(0.25);
  });

  it('should wrap negative values into [0, 1)', () => {
    expect(wrapUnit(-0.25)).toBeCloseTo(0.75);
  });
});

describe('generateStars variety', () => {
  const stars = generateStars(200, 5);

  it('should include a few hero stars but not many', () => {
    const heroes = stars.filter((star) => star.isHero).length;
    expect(heroes).toBeGreaterThan(0);
    expect(heroes).toBeLessThan(40);
  });

  it('should use every tint in the palette', () => {
    expect(new Set(stars.map((star) => star.tone)).size).toBe(TONE_COUNT);
  });
});

describe('trailLength', () => {
  it('should be zero when the cursor is slow', () => {
    expect(trailLength(0.3, 1)).toBe(0);
  });

  it('should grow with speed and be capped', () => {
    expect(trailLength(1.5, 1)).toBeGreaterThan(0);
    expect(trailLength(50, 1)).toBe(14);
  });

  it('should be shorter for far stars', () => {
    expect(trailLength(5, 0.2)).toBeLessThan(trailLength(5, 1));
  });
});
