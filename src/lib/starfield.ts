export interface Star {
  /** Normalised horizontal position, [0, 1). */
  readonly x: number;
  /** Normalised vertical position, [0, 1). */
  readonly y: number;
  /** Depth, 0.15 (far) to 1 (near). Nearer stars move more and look larger. */
  readonly z: number;
  readonly radius: number;
  readonly phase: number;
  /** Index into the colour palette. */
  readonly tone: number;
}

export const MIN_STARS = 120;
export const MAX_STARS = 220;
export const TONE_COUNT = 3;
const PIXELS_PER_STAR = 9000;

/** mulberry32: small seeded PRNG so star layouts are reproducible in tests. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateStars(count: number, seed: number): readonly Star[] {
  const rng = createRng(seed);
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    const z = 0.15 + rng() * 0.85;
    stars.push({
      x: rng(),
      y: rng(),
      z,
      radius: 0.4 + z * 1.1 + rng() * 0.3,
      phase: rng() * Math.PI * 2,
      tone: Math.floor(rng() * TONE_COUNT),
    });
  }
  return stars;
}

/** Star count for a viewport, 120-220 at full density; `density` scales it down (e.g. dashboard). */
export function starCountForArea(width: number, height: number, density: number): number {
  const base = Math.min(MAX_STARS, Math.max(MIN_STARS, Math.round((width * height) / PIXELS_PER_STAR)));
  return Math.round(base * Math.min(1, Math.max(0, density)));
}

export function clampOffset(value: number, max: number): number {
  return Math.min(max, Math.max(-max, value));
}

export function easeToward(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

export function wrapUnit(value: number): number {
  return value - Math.floor(value);
}
