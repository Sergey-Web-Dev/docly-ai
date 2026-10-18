import { describe, expect, it } from 'vitest';
import {
  SPACE_TONES,
  SPACE_TONE_CSS,
  SPARKLE_FRACTION,
  createShootingStar,
  generateSpaceStars,
  groupByTone,
  isMinorResize,
  markSparkles,
  nextShootingDelayMs,
  shootingStarProgress,
  spaceStarCount,
  twinkle,
  type SpaceStar,
} from './space-sky';
import { createRng } from './starfield';

describe('generateSpaceStars', () => {
  it('should be deterministic when the seed is the same', () => {
    expect(generateSpaceStars(120, 5)).toEqual(generateSpaceStars(120, 5));
  });

  it('should return exactly the requested count when called with any count', () => {
    expect(generateSpaceStars(0, 1)).toHaveLength(0);
    expect(generateSpaceStars(333, 1)).toHaveLength(333);
  });

  it('should keep every star within its documented ranges when generated', () => {
    for (const star of generateSpaceStars(400, 9)) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(1);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(1);
      expect([0.25, 0.55, 1]).toContain(star.layer);
      expect(star.brightness).toBeGreaterThanOrEqual(0);
      expect(star.brightness).toBeLessThanOrEqual(1);
      expect(star.tone).toBeLessThan(SPACE_TONES.length);
    }
  });

  it('should have many faint and few bright stars when brightness follows a power law', () => {
    const stars = generateSpaceStars(2000, 11);
    const faint = stars.filter((s) => s.brightness < 0.25).length;
    const bright = stars.filter((s) => s.brightness > 0.75).length;
    expect(faint).toBeGreaterThan(stars.length * 0.5);
    expect(bright).toBeLessThan(stars.length * 0.08);
  });

  it('should mark the brightest 3% as sparkles when generating a field', () => {
    const stars = generateSpaceStars(1000, 3);
    const sparkles = stars.filter((s) => s.isSparkle);
    expect(sparkles.length).toBe(Math.ceil(stars.length * SPARKLE_FRACTION));
    const minSparkle = Math.min(...sparkles.map((s) => s.brightness));
    const maxPlain = Math.max(...stars.filter((s) => !s.isSparkle).map((s) => s.brightness));
    expect(minSparkle).toBeGreaterThanOrEqual(maxPlain);
  });

  it('should include every colour temperature with orange the rarest when the field is large', () => {
    const stars = generateSpaceStars(3000, 21);
    const counts = SPACE_TONES.map((_, tone) => stars.filter((s) => s.tone === tone).length);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(counts[3]).toBe(Math.min(...counts));
  });

  it('should give larger radius when a star is brighter', () => {
    const stars = [...generateSpaceStars(500, 4)].sort((a, b) => a.brightness - b.brightness);
    const first = stars[0];
    const last = stars[stars.length - 1];
    expect(last && first && last.radius > first.radius).toBe(true);
  });
});

describe('spaceStarCount', () => {
  it('should scale with area and density within bounds when the viewport changes', () => {
    expect(spaceStarCount(1280, 800, 1)).toBeGreaterThan(spaceStarCount(375, 812, 1));
    expect(spaceStarCount(1280, 800, 0.5)).toBeLessThan(spaceStarCount(1280, 800, 1));
    expect(spaceStarCount(5000, 3000, 1)).toBeLessThanOrEqual(1100);
    expect(spaceStarCount(100, 100, 1)).toBeGreaterThanOrEqual(120);
  });
});

describe('twinkle', () => {
  const [star] = generateSpaceStars(1, 2);

  it('should stay within sane bounds when time advances', () => {
    if (!star) throw new Error('no star');
    for (let t = 0; t < 20000; t += 137) {
      const { alpha, scale } = twinkle(star, t);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(1.3);
      expect(scale).toBeGreaterThan(0.7);
      expect(scale).toBeLessThan(1.3);
    }
  });

  it('should de-synchronise alpha when stars have different phases', () => {
    const stars = generateSpaceStars(30, 8);
    const values = new Set(stars.map((s) => twinkle(s, 1234).alpha.toFixed(3)));
    expect(values.size).toBeGreaterThan(10);
  });
});

describe('shooting stars', () => {
  it('should schedule the next one 4 to 9 seconds out when a delay is requested', () => {
    const rng = createRng(1);
    for (let i = 0; i < 100; i += 1) {
      const delay = nextShootingDelayMs(rng);
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(9000);
    }
  });

  it('should spawn a diagonal streak with random direction and speed when created', () => {
    const rng = createRng(2);
    const shots = Array.from({ length: 50 }, () => createShootingStar(rng, 1280, 800, 0));
    for (const s of shots) {
      expect(Math.abs(s.vx)).toBeGreaterThan(0.2);
      expect(Math.abs(s.vy)).toBeGreaterThan(0.05);
      expect(s.durationMs).toBeGreaterThan(500);
      expect(s.length).toBeGreaterThan(60);
    }
    expect(new Set(shots.map((s) => Math.sign(s.vx))).size).toBe(2);
    expect(new Set(shots.map((s) => s.vx.toFixed(2))).size).toBeGreaterThan(30);
  });

  it('should report progress 0..1 and expire when its duration has passed', () => {
    const shot = createShootingStar(createRng(3), 1000, 700, 1000);
    expect(shootingStarProgress(shot, 1000)).toBe(0);
    expect(shootingStarProgress(shot, 1000 + shot.durationMs / 2)).toBeCloseTo(0.5, 5);
    expect(shootingStarProgress(shot, 1000 + shot.durationMs + 1)).toBeNull();
  });
});

function makeStar(overrides: Partial<SpaceStar>): SpaceStar {
  return { x: 0.5, y: 0.5, layer: 1, brightness: 0.1, radius: 1, tone: 0, phase: 0, twinkleSpeed: 0.001, isSparkle: false, isBand: false, ...overrides };
}

describe('markSparkles', () => {
  const stars = [0.1, 0.9, 0.5, 0.7].map((brightness) => makeStar({ brightness }));

  it('should flag only the brightest stars when the fraction is 0.5', () => {
    const marked = markSparkles(stars, 0.5);
    expect(marked.map((s) => s.isSparkle)).toEqual([false, true, false, true]);
  });

  it('should round the sparkle count up when the fraction is not whole', () => {
    expect(markSparkles(stars, 0.1).filter((s) => s.isSparkle)).toHaveLength(1);
  });

  it('should flag nothing when the fraction is zero', () => {
    expect(markSparkles(stars, 0).some((s) => s.isSparkle)).toBe(false);
  });

  it('should break brightness ties by original order when ranking', () => {
    const tied = [makeStar({ brightness: 0.4 }), makeStar({ brightness: 0.4 }), makeStar({ brightness: 0.4 })];
    expect(markSparkles(tied, 0.34).map((s) => s.isSparkle)).toEqual([true, true, false]);
  });

  it('should enlarge small sparkles to at least 1.7px when flagged', () => {
    const [marked] = markSparkles([makeStar({ radius: 0.5, brightness: 1 })], 1);
    expect(marked?.radius).toBe(1.7);
  });

  it('should leave non-sparkle stars and the input untouched when marking', () => {
    const marked = markSparkles(stars, 0.25);
    expect(marked[0]).toBe(stars[0]);
    expect(stars.every((s) => !s.isSparkle)).toBe(true);
  });
});

describe('SPACE_TONE_CSS', () => {
  it('should hold one precomputed rgb string per tone when read', () => {
    expect(SPACE_TONE_CSS).toHaveLength(SPACE_TONES.length);
    expect(SPACE_TONE_CSS[0]).toBe('rgb(170,197,255)');
  });
});

describe('groupByTone', () => {
  it('should order stars by tone and keep relative order within a tone when grouping', () => {
    const input = [makeStar({ tone: 2, x: 0.1 }), makeStar({ tone: 0, x: 0.2 }), makeStar({ tone: 2, x: 0.3 }), makeStar({ tone: 0, x: 0.4 })];
    const grouped = groupByTone(input);
    expect(grouped.map((s) => [s.tone, s.x])).toEqual([[0, 0.2], [0, 0.4], [2, 0.1], [2, 0.3]]);
  });

  it('should not mutate the input when grouping', () => {
    const input = [makeStar({ tone: 3 }), makeStar({ tone: 1 })];
    groupByTone(input);
    expect(input.map((s) => s.tone)).toEqual([3, 1]);
  });
});

describe('isMinorResize', () => {
  const prev = { width: 390, height: 700, dpr: 2 };

  it('should be true when only the height changes by less than 120px', () => {
    expect(isMinorResize(prev, { ...prev, height: 780 })).toBe(true);
    expect(isMinorResize(prev, { ...prev, height: 620 })).toBe(true);
  });

  it('should be false when the height changes by 120px or more', () => {
    expect(isMinorResize(prev, { ...prev, height: 820 })).toBe(false);
  });

  it('should be false when the width or the pixel ratio changes', () => {
    expect(isMinorResize(prev, { ...prev, width: 391 })).toBe(false);
    expect(isMinorResize(prev, { ...prev, dpr: 1 })).toBe(false);
  });
});

describe('twinkle scratch output', () => {
  it('should write into and return the supplied object when one is given', () => {
    const out = { alpha: 0, scale: 0 };
    const result = twinkle(makeStar({}), 500, out);
    expect(result).toBe(out);
    expect(out.alpha).toBeGreaterThan(0);
    expect(out.scale).toBeGreaterThan(0.7);
  });
});
