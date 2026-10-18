import { describe, expect, it } from 'vitest';
import {
  GALAXY_TONES,
  GALAXY_TONE_CSS,
  galaxyLayout,
  galaxyParticleCount,
  galaxyRotation,
  generateGalaxyParticles,
  projectParticle,
  type Projection,
} from './galaxy-sky';

describe('generateGalaxyParticles', () => {
  it('should be deterministic when the seed is the same', () => {
    expect(generateGalaxyParticles(300, 6)).toEqual(generateGalaxyParticles(300, 6));
  });

  it('should return exactly the requested count', () => {
    expect(generateGalaxyParticles(0, 1)).toHaveLength(0);
    expect(generateGalaxyParticles(417, 1)).toHaveLength(417);
  });

  it('should keep every particle inside the unit disc with sane size and brightness', () => {
    for (const p of generateGalaxyParticles(800, 3)) {
      expect(Math.hypot(p.lx, p.ly)).toBeLessThanOrEqual(1);
      expect(p.size).toBeGreaterThanOrEqual(0.5);
      expect(p.size).toBeLessThanOrEqual(2);
      expect(p.brightness).toBeGreaterThanOrEqual(0);
      expect(p.brightness).toBeLessThanOrEqual(1);
      expect(p.tone).toBeLessThan(GALAXY_TONES.length);
    }
  });

  it('should concentrate particles towards the core', () => {
    const particles = generateGalaxyParticles(2000, 9);
    const inner = particles.filter((p) => Math.hypot(p.lx, p.ly) < 0.3).length;
    // A uniform disc would put ~9% inside r < 0.3.
    expect(inner / particles.length).toBeGreaterThan(0.25);
  });

  it('should colour the centre warm and the outskirts cool', () => {
    const particles = generateGalaxyParticles(2000, 4);
    const warmShare = (from: number, to: number): number => {
      const ring = particles.filter((p) => {
        const r = Math.hypot(p.lx, p.ly);
        return r >= from && r < to;
      });
      return ring.filter((p) => p.tone === 0).length / Math.max(1, ring.length);
    };
    expect(warmShare(0, 0.15)).toBeGreaterThan(warmShare(0.7, 1));
  });

  it('should order particles by tone so a draw loop switches fillStyle once per tone', () => {
    const tones = generateGalaxyParticles(500, 2).map((p) => p.tone);
    expect(tones).toEqual([...tones].sort((a, b) => a - b));
  });

  it('should expose one CSS colour per tone', () => {
    expect(GALAXY_TONE_CSS).toHaveLength(GALAXY_TONES.length);
  });
});

describe('galaxyParticleCount', () => {
  it('should stay within bounds and shrink with lower density', () => {
    expect(galaxyParticleCount(50, 1)).toBeGreaterThanOrEqual(400);
    expect(galaxyParticleCount(5000, 1)).toBeLessThanOrEqual(1600);
    expect(galaxyParticleCount(440, 0.5)).toBeLessThan(galaxyParticleCount(440, 1));
  });
});

describe('galaxyLayout', () => {
  it('should place the galaxy low and to the right on a wide viewport', () => {
    const layout = galaxyLayout(1280, 800);
    expect(layout.cx).toBeGreaterThan(1280 * 0.6);
    expect(layout.cy).toBeGreaterThan(800 * 0.5);
    expect(layout.radius).toBeGreaterThan(300);
  });

  it('should place the core in the top-right corner on a narrow phone viewport', () => {
    const layout = galaxyLayout(375, 812);
    expect(layout.cy).toBeLessThan(812 * 0.2);
    expect(layout.cx).toBeGreaterThan(375 * 0.7);
  });

  it('should keep the widget iframe (380x600) in the top placement', () => {
    expect(galaxyLayout(380, 600).cy).toBeLessThan(600 * 0.2);
  });
});

describe('galaxyRotation', () => {
  it('should be 0 at time 0 and grow slowly and monotonically', () => {
    expect(galaxyRotation(0)).toBe(0);
    expect(galaxyRotation(10_000)).toBeGreaterThan(0);
    // Less than a quarter turn in the first minute: calm.
    expect(galaxyRotation(60_000)).toBeLessThan(Math.PI / 2);
  });
});

describe('projectParticle', () => {
  const identity: Projection = { cx: 100, cy: 200, radius: 50, cosA: 1, sinA: 0, squash: 1, cosT: 1, sinT: 0 };

  it('should scale and translate a particle with no rotation, squash or tilt', () => {
    const out = { x: 0, y: 0 };
    projectParticle(1, 0, identity, out);
    expect(out.x).toBeCloseTo(150);
    expect(out.y).toBeCloseTo(200);
  });

  it('should rotate the particle in the galaxy plane', () => {
    const out = { x: 0, y: 0 };
    projectParticle(1, 0, { ...identity, cosA: 0, sinA: 1 }, out);
    expect(out.x).toBeCloseTo(100);
    expect(out.y).toBeCloseTo(250);
  });

  it('should squash the vertical axis to tilt the disc', () => {
    const out = { x: 0, y: 0 };
    projectParticle(0, 1, { ...identity, squash: 0.5 }, out);
    expect(out.y).toBeCloseTo(225);
  });
});
