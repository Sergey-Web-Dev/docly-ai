import { createRng } from '@/lib/starfield';

/** Cool star colours for the dashboard sky: blue-white, near white, teal, violet. */
export const CONSTELLATION_TONES: readonly (readonly [number, number, number])[] = [
  [170, 197, 255],
  [230, 238, 255],
  [150, 215, 225],
  [190, 170, 255],
];
/** `fillStyle` strings for CONSTELLATION_TONES, built once so nothing is formatted per frame. */
export const CONSTELLATION_TONE_CSS: readonly string[] = CONSTELLATION_TONES.map(([r, g, b]) => `rgb(${r},${g},${b})`);
const TONE_CUMULATIVE: readonly number[] = [0.35, 0.65, 0.85, 1];
const LAYERS: readonly { readonly depth: number; readonly cumulative: number }[] = [
  { depth: 0.3, cumulative: 0.45 },
  { depth: 0.6, cumulative: 0.8 },
  { depth: 1, cumulative: 1 },
];

const LAYER_CUMULATIVE: readonly number[] = LAYERS.map((layer) => layer.cumulative);

export const MIN_CALM_STARS = 90;
export const MAX_CALM_STARS = 380;
const PIXELS_PER_CALM_STAR = 5200;

/** Stars within this distance (px) of the cursor join the constellation lines. */
export const CURSOR_RADIUS_PX = 140;
/** Two stars are linked only when closer than this (px). */
export const MAX_LINK_PX = 120;
/** Ambient constellations never put stars closer than this together (px); keeps shapes readable. */
const MIN_CHAIN_GAP_PX = 18;
export const MAX_CHAIN = 6;

export interface CalmStar {
  /** Normalised position, [0, 1). */
  readonly x: number;
  readonly y: number;
  /** Parallax / drift depth: 0.3 (far), 0.6, 1 (near). Stars of one layer always drift together. */
  readonly layer: number;
  /** Power-law brightness in [0, 1]. */
  readonly brightness: number;
  /** Disc radius in CSS px. */
  readonly radius: number;
  /** Index into CONSTELLATION_TONES. */
  readonly tone: number;
  readonly phase: number;
  /** Twinkle rate in radians per ms: very slow. */
  readonly twinkleSpeed: number;
}

function pickWeighted(value: number, cumulative: readonly number[]): number {
  const index = cumulative.findIndex((limit) => value < limit);
  return index === -1 ? cumulative.length - 1 : index;
}

/** Small, calm stars (no sparkles, no spikes), ordered by tone. `scale` shrinks them for fine star dust. */
export function generateCalmStars(count: number, seed: number, scale = 1): readonly CalmStar[] {
  const rng = createRng(seed);
  const stars: CalmStar[] = [];
  for (let i = 0; i < count; i += 1) {
    const layer = LAYERS[pickWeighted(rng(), LAYER_CUMULATIVE)]?.depth ?? 1;
    const brightness = rng() ** 2.2;
    stars.push({
      x: rng(),
      y: rng(),
      layer,
      brightness,
      radius: (0.4 + 0.9 * Math.sqrt(brightness) + layer * 0.1) * scale,
      tone: pickWeighted(rng(), TONE_CUMULATIVE),
      phase: rng() * Math.PI * 2,
      twinkleSpeed: 0.0004 + rng() * 0.0012,
    });
  }
  return stars.map((star, index) => ({ star, index })).sort((a, b) => a.star.tone - b.star.tone || a.index - b.index).map((entry) => entry.star);
}

/** Star count for a viewport; `density` scales it down on weak devices. */
export function constellationStarCount(width: number, height: number, density: number): number {
  const base = Math.min(MAX_CALM_STARS, Math.max(MIN_CALM_STARS, Math.round((width * height) / PIXELS_PER_CALM_STAR)));
  return Math.round(base * Math.min(1, Math.max(0.1, density)));
}

/** Link opacity factor: 1 for touching stars, 0 at `maxDistance` and beyond. */
export function linkAlpha(distance: number, maxDistance: number): number {
  if (distance >= maxDistance) return 0;
  return 1 - Math.max(0, distance) / maxDistance;
}

/** 1 under the cursor, falling off quadratically to 0 at `radius`. */
export function cursorCloseness(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  return (1 - Math.max(0, distance) / radius) ** 2;
}

/** Gentle brightness multiplier, 0.88 to 1.12. */
export function calmTwinkle(star: CalmStar, time: number): number {
  return 1 + 0.12 * Math.sin(time * star.twinkleSpeed + star.phase);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 0 to 1 over a constellation's life: fades in over the first quarter, holds, fades out over the last third. */
export function constellationEnvelope(elapsedMs: number, durationMs: number): number {
  if (elapsedMs <= 0 || elapsedMs >= durationMs) return 0;
  const progress = elapsedMs / durationMs;
  return Math.min(smoothstep(0, 0.25, progress), 1 - smoothstep(0.65, 1, progress));
}

export function nextConstellationDelayMs(rng: () => number): number {
  return 2500 + rng() * 3500;
}

export function constellationDurationMs(rng: () => number): number {
  return 8000 + rng() * 4000;
}

/**
 * Greedy chain of up to `size` stars starting at `seedIndex`: each next star is the nearest unused star of the
 * same depth layer within the link distance. Writes indices into `out` and returns how many were written.
 */
export function findConstellation(stars: readonly CalmStar[], seedIndex: number, size: number, width: number, height: number, out: Int16Array): number {
  const seed = stars[seedIndex];
  if (!seed) return 0;
  const limit = Math.min(size, out.length, MAX_CHAIN);
  let count = 0;
  out[count] = seedIndex;
  count += 1;
  let last = seed;
  while (count < limit) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < stars.length; i += 1) {
      const candidate = stars[i];
      if (!candidate || candidate.layer !== seed.layer || isInChain(out, count, i)) continue;
      const distance = Math.hypot((candidate.x - last.x) * width, (candidate.y - last.y) * height);
      if (distance < MIN_CHAIN_GAP_PX || distance > MAX_LINK_PX || distance >= bestDistance) continue;
      best = i;
      bestDistance = distance;
    }
    const next = stars[best];
    if (!next) break;
    out[count] = best;
    count += 1;
    last = next;
  }
  return count;
}

function isInChain(chain: Int16Array, count: number, index: number): boolean {
  for (let i = 0; i < count; i += 1) if (chain[i] === index) return true;
  return false;
}
