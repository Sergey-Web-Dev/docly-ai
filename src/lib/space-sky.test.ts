import { describe, expect, it } from 'vitest';
import {
  SPACE_TONES,
  SPARKLE_FRACTION,
  createShootingStar,
  generateSpaceStars,
  nextShootingDelayMs,
  shootingStarProgress,
  spaceStarCount,
  twinkle,
} from './space-sky';
import { createRng } from './starfield';

describe('generateSpaceStars', () => {
  it('should be deterministic when the seed is the same', () => {
    expect(generateSpaceStars(120, 5)).toEqual(generateSpaceStars(120, 5));
  });

  it('should return exactly the requested count', () => {
    expect(generateSpaceStars(0, 1)).toHaveLength(0);
    expect(generateSpaceStars(333, 1)).toHaveLength(333);
  });

  it('should keep every star within its documented ranges', () => {
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

  it('should follow a power law with many faint stars and few bright ones', () => {
    const stars = generateSpaceStars(2000, 11);
    const faint = stars.filter((s) => s.brightness < 0.25).length;
    const bright = stars.filter((s) => s.brightness > 0.75).length;
    expect(faint).toBeGreaterThan(stars.length * 0.5);
    expect(bright).toBeLessThan(stars.length * 0.08);
  });

  it('should mark roughly the brightest 3% as sparkles', () => {
    const stars = generateSpaceStars(1000, 3);
    const sparkles = stars.filter((s) => s.isSparkle);
    expect(sparkles.length).toBe(Math.ceil(stars.length * SPARKLE_FRACTION));
    const minSparkle = Math.min(...sparkles.map((s) => s.brightness));
    const maxPlain = Math.max(...stars.filter((s) => !s.isSparkle).map((s) => s.brightness));
    expect(minSparkle).toBeGreaterThanOrEqual(maxPlain);
  });

  it('should include every colour temperature with orange the rarest', () => {
    const stars = generateSpaceStars(3000, 21);
    const counts = SPACE_TONES.map((_, tone) => stars.filter((s) => s.tone === tone).length);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(counts[3]).toBe(Math.min(...counts));
  });

  it('should give bigger, brighter stars larger radius', () => {
    const stars = [...generateSpaceStars(500, 4)].sort((a, b) => a.brightness - b.brightness);
    const first = stars[0];
    const last = stars[stars.length - 1];
    expect(last && first && last.radius > first.radius).toBe(true);
  });
});

describe('spaceStarCount', () => {
  it('should scale with area and density within bounds', () => {
    expect(spaceStarCount(1280, 800, 1)).toBeGreaterThan(spaceStarCount(375, 812, 1));
    expect(spaceStarCount(1280, 800, 0.5)).toBeLessThan(spaceStarCount(1280, 800, 1));
    expect(spaceStarCount(5000, 3000, 1)).toBeLessThanOrEqual(900);
    expect(spaceStarCount(100, 100, 1)).toBeGreaterThanOrEqual(120);
  });
});

describe('twinkle', () => {
  const [star] = generateSpaceStars(1, 2);

  it('should stay within sane bounds over time', () => {
    if (!star) throw new Error('no star');
    for (let t = 0; t < 20000; t += 137) {
      const { alpha, scale } = twinkle(star, t);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(1.3);
      expect(scale).toBeGreaterThan(0.7);
      expect(scale).toBeLessThan(1.3);
    }
  });

  it('should de-synchronise stars with different phases', () => {
    const stars = generateSpaceStars(30, 8);
    const values = new Set(stars.map((s) => twinkle(s, 1234).alpha.toFixed(3)));
    expect(values.size).toBeGreaterThan(10);
  });
});

describe('shooting stars', () => {
  it('should schedule the next one 4 to 9 seconds out', () => {
    const rng = createRng(1);
    for (let i = 0; i < 100; i += 1) {
      const delay = nextShootingDelayMs(rng);
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(9000);
    }
  });

  it('should spawn a diagonal streak with random direction and speed', () => {
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

  it('should report progress 0..1 and expire after its duration', () => {
    const shot = createShootingStar(createRng(3), 1000, 700, 1000);
    expect(shootingStarProgress(shot, 1000)).toBe(0);
    expect(shootingStarProgress(shot, 1000 + shot.durationMs / 2)).toBeCloseTo(0.5, 5);
    expect(shootingStarProgress(shot, 1000 + shot.durationMs + 1)).toBeNull();
  });
});
