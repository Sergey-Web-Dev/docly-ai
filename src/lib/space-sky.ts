import { createRng } from '@/lib/starfield';

/** Star colour temperatures: blue-white, white, warm yellow-white, rare orange. */
export const SPACE_TONES: readonly (readonly [number, number, number])[] = [
  [170, 197, 255],
  [246, 248, 255],
  [255, 238, 205],
  [255, 189, 130],
];
// Cumulative weights for the tones above.
const TONE_CUMULATIVE: readonly number[] = [0.3, 0.66, 0.96, 1];
const LAYERS: readonly { readonly depth: number; readonly cumulative: number }[] = [
  { depth: 0.25, cumulative: 0.5 },
  { depth: 0.55, cumulative: 0.82 },
  { depth: 1, cumulative: 1 },
];
const BRIGHTNESS_EXPONENT = 5;
const BAND_SHARE = 0.25;
const BAND_ANGLE = -0.42;
const BAND_CENTER_Y = 0.62;
const BAND_SPREAD = 0.07;
const BAND_DIM = 0.55;

export const SPARKLE_FRACTION = 0.03;
export const MIN_SPACE_STARS = 120;
export const MAX_SPACE_STARS = 1100;
const PIXELS_PER_SPACE_STAR = 1500;

export interface SpaceStar {
  /** Normalised position, [0, 1). */
  readonly x: number;
  readonly y: number;
  /** Parallax layer depth: 0.25 (far), 0.55, 1 (near). */
  readonly layer: number;
  /** Power-law brightness in [0, 1]: most stars are near 0, very few near 1. */
  readonly brightness: number;
  /** Disc radius in CSS px. */
  readonly radius: number;
  /** Index into SPACE_TONES. */
  readonly tone: number;
  readonly phase: number;
  /** Scintillation rate in radians per ms. */
  readonly twinkleSpeed: number;
  /** One of the brightest ~3%: drawn with a halo and diffraction spikes. */
  readonly isSparkle: boolean;
  /** Part of the faint Milky-Way-like band. */
  readonly isBand: boolean;
}

function pickWeighted(value: number, cumulative: readonly number[]): number {
  const index = cumulative.findIndex((limit) => value < limit);
  return index === -1 ? cumulative.length - 1 : index;
}

function gaussian(rng: () => number): number {
  return (rng() + rng() + rng() + rng() - 2) / 2;
}

function wrapUnit(value: number): number {
  return value - Math.floor(value);
}

export function generateSpaceStars(count: number, seed: number): readonly SpaceStar[] {
  const rng = createRng(seed);
  const stars: SpaceStar[] = [];
  for (let i = 0; i < count; i += 1) {
    const isBand = rng() < BAND_SHARE;
    let x = rng();
    let y = rng();
    if (isBand) {
      const along = rng();
      const across = gaussian(rng) * BAND_SPREAD;
      x = along;
      y = BAND_CENTER_Y + Math.tan(BAND_ANGLE) * (along - 0.5) + across;
      x = Math.min(0.9999, Math.max(0, x));
      y = wrapUnit(y);
    }
    const layer = LAYERS[pickWeighted(rng(), LAYERS.map((l) => l.cumulative))]?.depth ?? 1;
    const brightness = rng() ** BRIGHTNESS_EXPONENT * (isBand ? BAND_DIM : 1);
    const tone = pickWeighted(rng(), TONE_CUMULATIVE);
    const radius = 0.45 + 1.5 * Math.sqrt(brightness) + layer * 0.15;
    stars.push({
      x,
      y,
      layer,
      brightness,
      radius,
      tone,
      phase: rng() * Math.PI * 2,
      twinkleSpeed: 0.0006 + rng() * 0.0022,
      isSparkle: false,
      isBand,
    });
  }
  return markSparkles(stars, SPARKLE_FRACTION);
}

/** Flags the brightest `fraction` of stars as sparkles. */
export function markSparkles(stars: readonly SpaceStar[], fraction: number): readonly SpaceStar[] {
  const sparkleCount = Math.ceil(stars.length * fraction);
  const ranked = stars.map((star, index) => ({ index, brightness: star.brightness })).sort((a, b) => b.brightness - a.brightness || a.index - b.index);
  const chosen = new Set(ranked.slice(0, sparkleCount).map((entry) => entry.index));
  return stars.map((star, index) => (chosen.has(index) ? { ...star, isSparkle: true, radius: Math.max(star.radius, 1.7) } : star));
}

/** Star count for a viewport; `density` scales it down on weak devices. */
export function spaceStarCount(width: number, height: number, density: number): number {
  const base = Math.min(MAX_SPACE_STARS, Math.max(MIN_SPACE_STARS, Math.round((width * height) / PIXELS_PER_SPACE_STAR)));
  return Math.round(base * Math.min(1, Math.max(0.1, density)));
}

/** Scintillation: brightness and a slight size flicker from two de-synchronised waves. */
export function twinkle(star: SpaceStar, time: number): { readonly alpha: number; readonly scale: number } {
  const wave = 0.6 * Math.sin(time * star.twinkleSpeed + star.phase) + 0.4 * Math.sin(time * star.twinkleSpeed * 2.3 + star.phase * 1.7);
  const depth = star.isSparkle ? 0.18 : 0.3;
  return { alpha: 1 + depth * wave, scale: 1 + 0.08 * wave };
}

export interface ShootingStar {
  readonly x: number;
  readonly y: number;
  /** Velocity in px per ms. */
  readonly vx: number;
  readonly vy: number;
  readonly length: number;
  readonly durationMs: number;
  readonly startedAt: number;
}

export function nextShootingDelayMs(rng: () => number): number {
  return 4000 + rng() * 5000;
}

export function createShootingStar(rng: () => number, width: number, height: number, now: number): ShootingStar {
  const direction = rng() < 0.5 ? 1 : -1;
  const angle = (15 + rng() * 25) * (Math.PI / 180);
  const speed = 0.6 + rng() * 0.8;
  const startX = direction === 1 ? rng() * width * 0.6 - width * 0.05 : width * 0.45 + rng() * width * 0.6;
  return {
    x: startX,
    y: rng() * height * 0.4 - height * 0.05,
    vx: Math.cos(angle) * speed * direction,
    vy: Math.sin(angle) * speed,
    length: 120 + rng() * 140,
    durationMs: 700 + rng() * 600,
    startedAt: now,
  };
}

/** 0 at launch to 1 at the end, or null once it has expired. */
export function shootingStarProgress(shot: ShootingStar, now: number): number | null {
  const progress = (now - shot.startedAt) / shot.durationMs;
  return progress > 1 ? null : Math.max(0, progress);
}
