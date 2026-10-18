export interface Star {
  /** Normalised horizontal position, [0, 1). */
  readonly x: number;
  /** Normalised vertical position, [0, 1). */
  readonly y: number;
  /** Depth, 0.15 (far) to 1 (near). Nearer stars move more and look larger. */
  readonly z: number;
  /** Radius in CSS px at DPR 1, 0.8 to 2.4. */
  readonly radius: number;
  readonly phase: number;
  /** Index into the colour palette. */
  readonly tone: number;
  /** Base opacity, 0.35 to 0.85, before twinkle. */
  readonly alpha: number;
  /** A few brighter stars that also get a soft glow. */
  readonly isHero: boolean;
}

export const MIN_RADIUS = 0.8;
export const MAX_RADIUS = 2.4;
export const MIN_ALPHA = 0.35;
export const MAX_ALPHA = 0.85;
const HERO_CHANCE = 0.07;

export const MIN_STARS = 120;
export const MAX_STARS = 220;
/** indigo, indigo (deep), violet, violet (deep), slate. */
export const TONE_COUNT = 5;
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
    const x = rng();
    const y = rng();
    const radius = Math.min(MAX_RADIUS, MIN_RADIUS + z * 1.2 + rng() * 0.4);
    const phase = rng() * Math.PI * 2;
    const tone = Math.floor(rng() * TONE_COUNT);
    const alpha = MIN_ALPHA + rng() * (MAX_ALPHA - MIN_ALPHA);
    const isHero = z > 0.6 && rng() < HERO_CHANCE * 2;
    stars.push({ x, y, z, radius: isHero ? Math.max(radius, 1.8) : radius, phase, tone, alpha: isHero ? MAX_ALPHA : alpha, isHero });
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

/** Trail length in px for a given cursor speed (px per ms): none when slow, capped when fast. */
export function trailLength(speedPxPerMs: number, depth: number, maxPx = 14): number {
  const strength = Math.min(1, Math.max(0, (speedPxPerMs - 0.8) / 2));
  return strength * maxPx * depth;
}
