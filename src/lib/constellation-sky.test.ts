import { describe, expect, it } from 'vitest';
import {
  CONSTELLATION_TONES,
  CONSTELLATION_TONE_CSS,
  MAX_CHAIN,
  MAX_LINK_PX,
  calmTwinkle,
  constellationEnvelope,
  constellationStarCount,
  cursorCloseness,
  findConstellation,
  generateCalmStars,
  linkAlpha,
  nextConstellationDelayMs,
} from './constellation-sky';
import { createRng } from './starfield';

describe('generateCalmStars', () => {
  it('should be deterministic when the seed is the same', () => {
    expect(generateCalmStars(150, 4)).toEqual(generateCalmStars(150, 4));
  });

  it('should return exactly the requested count', () => {
    expect(generateCalmStars(0, 1)).toHaveLength(0);
    expect(generateCalmStars(211, 1)).toHaveLength(211);
  });

  it('should keep every star small and inside the unit square', () => {
    for (const star of generateCalmStars(400, 8)) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(1);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(1);
      expect(star.radius).toBeGreaterThanOrEqual(0.3);
      expect(star.radius).toBeLessThanOrEqual(1.6);
      expect(star.brightness).toBeGreaterThanOrEqual(0);
      expect(star.brightness).toBeLessThanOrEqual(1);
      expect(star.tone).toBeLessThan(CONSTELLATION_TONES.length);
    }
  });

  it('should order stars by colour tone so a draw loop switches fillStyle once per tone', () => {
    const tones = generateCalmStars(300, 3).map((star) => star.tone);
    expect(tones).toEqual([...tones].sort((a, b) => a - b));
  });

  it('should scale radii down when a smaller scale is passed (galaxy dust)', () => {
    const normal = Math.max(...generateCalmStars(300, 2).map((s) => s.radius));
    const dust = Math.max(...generateCalmStars(300, 2, 0.6).map((s) => s.radius));
    expect(dust).toBeLessThan(normal);
  });

  it('should expose one CSS colour per tone', () => {
    expect(CONSTELLATION_TONE_CSS).toHaveLength(CONSTELLATION_TONES.length);
  });
});

describe('constellationStarCount', () => {
  it('should stay within the min and max for any viewport', () => {
    expect(constellationStarCount(200, 200, 1)).toBeGreaterThanOrEqual(90);
    expect(constellationStarCount(4000, 3000, 1)).toBeLessThanOrEqual(380);
  });

  it('should return fewer stars when density is lower', () => {
    expect(constellationStarCount(1280, 800, 0.5)).toBeLessThan(constellationStarCount(1280, 800, 1));
  });
});

describe('linkAlpha', () => {
  it('should be 1 at distance 0 and 0 at or beyond the max distance', () => {
    expect(linkAlpha(0, 100)).toBe(1);
    expect(linkAlpha(100, 100)).toBe(0);
    expect(linkAlpha(250, 100)).toBe(0);
  });

  it('should fade monotonically with distance', () => {
    expect(linkAlpha(20, 100)).toBeGreaterThan(linkAlpha(60, 100));
  });
});

describe('cursorCloseness', () => {
  it('should be 0 outside the radius and rise towards the cursor', () => {
    expect(cursorCloseness(200, 140)).toBe(0);
    expect(cursorCloseness(0, 140)).toBe(1);
    expect(cursorCloseness(30, 140)).toBeGreaterThan(cursorCloseness(100, 140));
  });
});

describe('calmTwinkle', () => {
  it('should stay within a gentle band around 1', () => {
    const star = generateCalmStars(1, 1)[0];
    if (!star) throw new Error('no star');
    for (let t = 0; t < 20000; t += 700) {
      const value = calmTwinkle(star, t);
      expect(value).toBeGreaterThan(0.7);
      expect(value).toBeLessThan(1.3);
    }
  });
});

describe('constellationEnvelope', () => {
  it('should fade in from 0, hold, and fade out to 0', () => {
    expect(constellationEnvelope(0, 10000)).toBe(0);
    expect(constellationEnvelope(5000, 10000)).toBe(1);
    expect(constellationEnvelope(10000, 10000)).toBe(0);
  });

  it('should be 0 outside the lifetime', () => {
    expect(constellationEnvelope(-5, 1000)).toBe(0);
    expect(constellationEnvelope(1500, 1000)).toBe(0);
  });

  it('should rise during the first quarter', () => {
    expect(constellationEnvelope(1000, 10000)).toBeGreaterThan(constellationEnvelope(300, 10000));
  });
});

describe('nextConstellationDelayMs', () => {
  it('should stay within 2.5 to 6 seconds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 50; i += 1) {
      const delay = nextConstellationDelayMs(rng);
      expect(delay).toBeGreaterThanOrEqual(2500);
      expect(delay).toBeLessThanOrEqual(6000);
    }
  });
});

describe('findConstellation', () => {
  const width = 1280;
  const height = 800;
  const stars = generateCalmStars(300, 11);

  it('should return a chain of unique stars starting at the seed', () => {
    const out = new Int16Array(MAX_CHAIN);
    const count = findConstellation(stars, 5, 5, width, height, out);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(5);
    expect(out[0]).toBe(5);
    const used = Array.from(out.slice(0, count));
    expect(new Set(used).size).toBe(count);
  });

  it('should only chain stars of the same depth layer so they drift together', () => {
    const out = new Int16Array(MAX_CHAIN);
    const count = findConstellation(stars, 9, 5, width, height, out);
    const layer = stars[9]?.layer;
    for (let i = 0; i < count; i += 1) expect(stars[out[i] ?? 0]?.layer).toBe(layer);
  });

  it('should keep consecutive stars within the link distance', () => {
    const out = new Int16Array(MAX_CHAIN);
    const count = findConstellation(stars, 20, 5, width, height, out);
    for (let i = 1; i < count; i += 1) {
      const a = stars[out[i - 1] ?? 0];
      const b = stars[out[i] ?? 0];
      if (!a || !b) throw new Error('missing star');
      expect(Math.hypot((a.x - b.x) * width, (a.y - b.y) * height)).toBeLessThanOrEqual(MAX_LINK_PX);
    }
  });

  it('should return 0 when the seed index does not exist', () => {
    expect(findConstellation(stars, 9999, 5, width, height, new Int16Array(MAX_CHAIN))).toBe(0);
  });

  it('should never write more than the requested size', () => {
    const out = new Int16Array(MAX_CHAIN).fill(-1);
    const count = findConstellation(stars, 3, 3, width, height, out);
    expect(count).toBeLessThanOrEqual(3);
    expect(out[3]).toBe(-1);
  });
});
