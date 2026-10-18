import {
  CONSTELLATION_TONES,
  CONSTELLATION_TONE_CSS,
  CURSOR_RADIUS_PX,
  MAX_CHAIN,
  MAX_LINK_PX,
  calmTwinkle,
  constellationDurationMs,
  constellationEnvelope,
  constellationStarCount,
  cursorCloseness,
  findConstellation,
  generateCalmStars,
  linkAlpha,
  nextConstellationDelayMs,
  type CalmStar,
} from '@/lib/constellation-sky';
import type { FieldState } from '@/lib/starfield-draw';
import { createRng, wrapUnit } from '@/lib/starfield';

const DRIFT_PX_PER_MS = 0.0018;
const PARALLAX_FACTOR = 0.6;
const MAX_NEAR = 24;
const AMBIENT_SLOTS = 2;
const HALO_SIZE = 24;
const FIRST_SPAWN_MS = 1200;
const STATIC_ENVELOPE = 0.7;
const CURSOR_LINE_STYLE = 'rgb(165,184,255)';
const AMBIENT_LINE_STYLE = 'rgb(150,214,226)';
const MAX_AMBIENT_SEGMENT_PX = MAX_LINK_PX * 1.6;
const SPAWN_ATTEMPTS = 24;

interface AmbientSlot {
  readonly indices: Int16Array;
  count: number;
  startedAt: number;
  durationMs: number;
  isActive: boolean;
  isStatic: boolean;
}

export interface ConstellationScene {
  /** Grouped by colour tone so `fillStyle` changes at most once per tone. */
  readonly stars: readonly CalmStar[];
  /** Screen position of each star in the current frame (reused every frame). */
  readonly px: Float32Array;
  readonly py: Float32Array;
  /** Indices of stars near the cursor in the current frame, and how close each one is, 0..1. */
  readonly near: Int16Array;
  readonly nearCloseness: Float32Array;
  nearCount: number;
  readonly slots: readonly AmbientSlot[];
  readonly halos: readonly HTMLCanvasElement[];
  readonly rng: () => number;
  nextSpawnAt: number;
  width: number;
  height: number;
  readonly dpr: number;
}

function makeSlots(): AmbientSlot[] {
  return Array.from({ length: AMBIENT_SLOTS }, () => ({ indices: new Int16Array(MAX_CHAIN), count: 0, startedAt: 0, durationMs: 0, isActive: false, isStatic: false }));
}

function buildHalo(rgb: readonly [number, number, number], dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(HALO_SIZE * dpr);
  canvas.height = Math.round(HALO_SIZE * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(dpr, dpr);
  const c = HALO_SIZE / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.8)`);
  gradient.addColorStop(0.2, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.3)`);
  gradient.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, HALO_SIZE, HALO_SIZE);
  return canvas;
}

const haloCache = new Map<number, readonly HTMLCanvasElement[]>();

function createHalos(dpr: number): readonly HTMLCanvasElement[] {
  const cached = haloCache.get(dpr);
  if (cached) return cached;
  const halos = CONSTELLATION_TONES.map((rgb) => buildHalo(rgb, dpr));
  haloCache.set(dpr, halos);
  return halos;
}

/** Scene for a viewport. Pass `previous` on resize to keep the random stream; the star list is kept when the count is unchanged. */
export function createConstellationScene(width: number, height: number, density: number, dpr: number, seed: number, previous: ConstellationScene | null = null): ConstellationScene {
  const count = constellationStarCount(width, height, density);
  const isSameStars = previous !== null && previous.stars.length === count;
  const stars = isSameStars ? previous.stars : generateCalmStars(count, seed);
  return {
    stars,
    px: new Float32Array(count),
    py: new Float32Array(count),
    near: new Int16Array(MAX_NEAR),
    nearCloseness: new Float32Array(MAX_NEAR),
    nearCount: 0,
    slots: makeSlots(),
    halos: createHalos(dpr),
    rng: previous?.rng ?? createRng(seed ^ 0x51ed270b),
    nextSpawnAt: -1,
    width,
    height,
    dpr,
  };
}

/** Starts a new ambient constellation in `slot`; returns false when no usable chain was found. */
function spawn(scene: ConstellationScene, slot: AmbientSlot, time: number, isStatic: boolean): boolean {
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt += 1) {
    const seedIndex = Math.floor(scene.rng() * scene.stars.length);
    const size = 3 + Math.floor(scene.rng() * 3);
    const count = findConstellation(scene.stars, seedIndex, size, scene.width, scene.height, slot.indices);
    if (count < 3) continue;
    slot.count = count;
    slot.startedAt = time;
    slot.durationMs = constellationDurationMs(scene.rng);
    slot.isActive = true;
    slot.isStatic = isStatic;
    return true;
  }
  return false;
}

function updateAmbient(scene: ConstellationScene, time: number, isAnimated: boolean): void {
  if (scene.stars.length === 0) return;
  if (!isAnimated) {
    const first = scene.slots[0];
    if (first && !first.isActive) spawn(scene, first, time, true);
    return;
  }
  if (scene.nextSpawnAt < 0) scene.nextSpawnAt = time + FIRST_SPAWN_MS;
  let free: AmbientSlot | null = null;
  for (const slot of scene.slots) {
    if (slot.isActive && time - slot.startedAt >= slot.durationMs) slot.isActive = false;
    if (!slot.isActive && !free) free = slot;
  }
  if (free && time >= scene.nextSpawnAt) {
    spawn(scene, free, time, false);
    scene.nextSpawnAt = time + nextConstellationDelayMs(scene.rng);
  }
}

function drawStars(ctx: CanvasRenderingContext2D, scene: ConstellationScene, state: FieldState, time: number): void {
  const { width, height, stars } = scene;
  scene.nearCount = 0;
  let tone = -1;
  for (let i = 0; i < stars.length; i += 1) {
    const star = stars[i];
    if (!star) continue;
    if (star.tone !== tone) {
      tone = star.tone;
      ctx.fillStyle = CONSTELLATION_TONE_CSS[tone] ?? '#fff';
    }
    const drift = time * DRIFT_PX_PER_MS * star.layer;
    const x = wrapUnit((star.x * width + drift + state.offsetX * star.layer * PARALLAX_FACTOR) / width) * width;
    const y = wrapUnit((star.y * height + drift * 0.4 + state.offsetY * star.layer * PARALLAX_FACTOR) / height) * height;
    scene.px[i] = x;
    scene.py[i] = y;

    let closeness = 0;
    if (state.pointerStrength > 0.001) {
      closeness = cursorCloseness(Math.hypot(state.pointerX - x, state.pointerY - y), CURSOR_RADIUS_PX);
      if (closeness > 0 && scene.nearCount < MAX_NEAR) {
        scene.near[scene.nearCount] = i;
        scene.nearCloseness[scene.nearCount] = closeness;
        scene.nearCount += 1;
      }
    }
    const boost = closeness * state.pointerStrength;
    const alpha = Math.min(1, (0.2 + 0.62 * Math.sqrt(star.brightness)) * (0.55 + 0.45 * star.layer) * calmTwinkle(star, time) + boost * 0.4);
    const radius = star.radius * (1 + boost * 0.5);

    const halo = scene.halos[star.tone];
    if (halo && (star.brightness > 0.5 || boost > 0.25)) {
      const size = radius * 7;
      ctx.globalAlpha = alpha * 0.45;
      ctx.drawImage(halo, x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = alpha;
    if (radius < 1.05) {
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Thin fading lines between the stars gathered around the cursor. */
function drawCursorLinks(ctx: CanvasRenderingContext2D, scene: ConstellationScene, strength: number): void {
  if (scene.nearCount < 2 || strength < 0.01) return;
  ctx.strokeStyle = CURSOR_LINE_STYLE;
  ctx.lineWidth = 0.9;
  for (let a = 0; a < scene.nearCount; a += 1) {
    const ia = scene.near[a] ?? 0;
    for (let b = a + 1; b < scene.nearCount; b += 1) {
      const ib = scene.near[b] ?? 0;
      const ax = scene.px[ia] ?? 0;
      const ay = scene.py[ia] ?? 0;
      const bx = scene.px[ib] ?? 0;
      const by = scene.py[ib] ?? 0;
      const alpha = linkAlpha(Math.hypot(ax - bx, ay - by), MAX_LINK_PX) * Math.sqrt(Math.min(scene.nearCloseness[a] ?? 0, scene.nearCloseness[b] ?? 0)) * strength * 0.85;
      if (alpha < 0.02) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
}

function drawAmbient(ctx: CanvasRenderingContext2D, scene: ConstellationScene, time: number): void {
  ctx.strokeStyle = AMBIENT_LINE_STYLE;
  ctx.lineWidth = 0.7;
  for (const slot of scene.slots) {
    if (!slot.isActive) continue;
    const envelope = slot.isStatic ? STATIC_ENVELOPE : constellationEnvelope(time - slot.startedAt, slot.durationMs);
    if (envelope < 0.01) continue;
    for (let i = 1; i < slot.count; i += 1) {
      const from = slot.indices[i - 1] ?? 0;
      const to = slot.indices[i] ?? 0;
      const fx = scene.px[from] ?? 0;
      const fy = scene.py[from] ?? 0;
      const tx = scene.px[to] ?? 0;
      const ty = scene.py[to] ?? 0;
      if (Math.hypot(fx - tx, fy - ty) > MAX_AMBIENT_SEGMENT_PX) continue;
      ctx.globalAlpha = envelope * 0.42;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    for (let i = 0; i < slot.count; i += 1) {
      const index = slot.indices[i] ?? 0;
      const halo = scene.halos[scene.stars[index]?.tone ?? 0];
      if (!halo) continue;
      ctx.globalAlpha = envelope * 0.7;
      ctx.drawImage(halo, (scene.px[index] ?? 0) - 7, (scene.py[index] ?? 0) - 7, 14, 14);
    }
  }
}

/** Draws one frame. `isAnimated=false` draws the static (reduced-motion / paused) frame with one fixed constellation. */
export function drawConstellations(ctx: CanvasRenderingContext2D, scene: ConstellationScene, state: FieldState, time: number, isAnimated: boolean): void {
  ctx.clearRect(0, 0, scene.width, scene.height);
  updateAmbient(scene, time, isAnimated);
  drawStars(ctx, scene, state, time);
  drawAmbient(ctx, scene, time);
  drawCursorLinks(ctx, scene, state.pointerStrength);
  ctx.globalAlpha = 1;
}
