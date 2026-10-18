import { createRng } from '@/lib/starfield';

/** Warm core, soft white, blue-white arm, indigo arm. */
export const GALAXY_TONES: readonly (readonly [number, number, number])[] = [
  [255, 226, 170],
  [250, 244, 232],
  [176, 200, 255],
  [150, 150, 255],
];
export const GALAXY_TONE_CSS: readonly string[] = GALAXY_TONES.map(([r, g, b]) => `rgb(${r},${g},${b})`);

const ARMS = 2;
/** How tightly the arms wind: radians of rotation from the core to the rim. */
const WINDING = 3.6;
const BULGE_SHARE = 0.2;
/** Faint particles spread over the whole disc: fills the gaps between the arms. */
const DISC_SHARE = 0.14;
const MIN_PARTICLES = 400;
const MAX_PARTICLES = 1600;
const PARTICLES_PER_RADIUS_PX = 3.4;
/** One full turn takes 7 minutes: slow enough to stay calm behind text. */
const ROTATION_PERIOD_MS = 420_000;
/** Disc tilt: vertical axis is squashed to this factor. */
export const GALAXY_SQUASH = 0.5;
export const GALAXY_TILT = -0.42;

export interface GalaxyParticle {
  /** Position in the galaxy plane, inside the unit disc. */
  readonly lx: number;
  readonly ly: number;
  /** Power-law brightness in [0, 1]. */
  readonly brightness: number;
  /** Side of the drawn square in CSS px. */
  readonly size: number;
  /** Index into GALAXY_TONES. */
  readonly tone: number;
  readonly phase: number;
  /** Shimmer rate in radians per ms. */
  readonly speed: number;
}

function gaussian(rng: () => number): number {
  return (rng() + rng() + rng() + rng() - 2) / 2;
}

function toneForRadius(r: number, rng: () => number): number {
  if (r < 0.16) return rng() < 0.8 ? 0 : 1;
  if (r < 0.4) return rng() < 0.55 ? 1 : 2;
  return rng() < 0.7 ? 2 : 3;
}

/** Spiral-arm particles plus a dense bulge, ordered by tone. Deterministic for a seed. */
export function generateGalaxyParticles(count: number, seed: number): readonly GalaxyParticle[] {
  const rng = createRng(seed);
  const particles: GalaxyParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    const isBulge = rng() < BULGE_SHARE;
    let r: number;
    let theta: number;
    const isDisc = !isBulge && rng() < DISC_SHARE / (1 - BULGE_SHARE);
    if (isBulge) {
      r = rng() ** 1.4 * 0.34;
      theta = rng() * Math.PI * 2;
    } else if (isDisc) {
      r = Math.sqrt(rng()) * 0.95;
      theta = rng() * Math.PI * 2;
    } else {
      r = 0.04 + rng() ** 1.5 * 0.96;
      const arm = Math.floor(rng() * ARMS);
      // Wider scatter near the core, tight arms towards the rim.
      theta = (arm / ARMS) * Math.PI * 2 + WINDING * r + gaussian(rng) * (1 - 0.5 * r);
    }
    const brightness = rng() ** 3 * (isBulge ? 0.45 : isDisc ? 0.4 : 0.85);
    particles.push({
      lx: Math.cos(theta) * r,
      ly: Math.sin(theta) * r,
      brightness,
      size: 0.55 + 1.1 * Math.sqrt(brightness) + (isBulge ? 0.15 : 0),
      tone: toneForRadius(r, rng),
      phase: rng() * Math.PI * 2,
      speed: 0.0005 + rng() * 0.0016,
    });
  }
  return particles.map((p, index) => ({ p, index })).sort((a, b) => a.p.tone - b.p.tone || a.index - b.index).map((entry) => entry.p);
}

/** Particle count for a galaxy of `radius` px; `density` scales it down on weak devices. */
export function galaxyParticleCount(radius: number, density: number): number {
  const base = Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, Math.round(radius * PARTICLES_PER_RADIUS_PX)));
  return Math.round(base * Math.min(1, Math.max(0.1, density)));
}

export interface GalaxyLayout {
  readonly cx: number;
  readonly cy: number;
  /** Semi-major axis in px. */
  readonly radius: number;
}

/** Bottom-right on a wide viewport (beside the chat column), top-right corner on narrow / portrait ones. The bright core never sits behind text. */
export function galaxyLayout(width: number, height: number): GalaxyLayout {
  const isNarrow = width < 700 || height > width * 1.05;
  if (isNarrow) {
    // Core in the top-right corner, clear of the title and the chat text; the arms sweep across the screen.
    return { cx: width * 0.86, cy: height * 0.13, radius: Math.min(width * 0.95, height * 0.5) };
  }
  return { cx: width * 0.8, cy: height * 0.6, radius: Math.min(width * 0.36, height * 0.55) };
}

/** In-plane rotation angle in radians at `time` ms. */
export function galaxyRotation(timeMs: number): number {
  return (timeMs / ROTATION_PERIOD_MS) * Math.PI * 2;
}

export interface Projection {
  cx: number;
  cy: number;
  radius: number;
  /** cos / sin of the in-plane rotation. */
  cosA: number;
  sinA: number;
  /** Vertical squash of the tilted disc. */
  squash: number;
  /** cos / sin of the disc tilt on screen. */
  cosT: number;
  sinT: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Maps a plane position to the screen: rotate in the plane, squash, tilt, scale, translate. No allocation. */
export function projectParticle(lx: number, ly: number, view: Projection, out: Point): void {
  const rx = lx * view.cosA - ly * view.sinA;
  const ry = (lx * view.sinA + ly * view.cosA) * view.squash;
  out.x = view.cx + (rx * view.cosT - ry * view.sinT) * view.radius;
  out.y = view.cy + (rx * view.sinT + ry * view.cosT) * view.radius;
}
