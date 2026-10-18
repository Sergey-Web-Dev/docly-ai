import type { FieldState } from '@/lib/starfield-draw';
import { createRng, wrapUnit } from '@/lib/starfield';
import {
  SPACE_TONES,
  SPACE_TONE_CSS,
  createShootingStar,
  generateSpaceStars,
  groupByTone,
  isMinorResize,
  nextShootingDelayMs,
  shootingStarProgress,
  spaceStarCount,
  twinkle,
  type ShootingStar,
  type SpaceStar,
  type Twinkle,
} from '@/lib/space-sky';

/** Glow behind sparkles; drawn at ~20-40 px. */
const HALO_SIZE = 48;
/** Tiny glow for ordinary bright stars; drawn at ~6-20 px. */
const SMALL_HALO_SIZE = 16;
/** Diffraction cross; drawn at up to ~100 px. */
const SPIKE_SIZE = 112;
const SPIKE_THICKNESS = 0.8;
const SPIKE_CORE_RADIUS = 6;
const TAIL_WIDTH = 256;
const TAIL_HEIGHT = 12;
const DRIFT_PX_PER_MS = 0.0035;
const POINTER_RADIUS_PX = 170;
const FIRST_SHOT_MS = 1800;

type Rgb = readonly [number, number, number];
const SMALL_HALO_MIN_BRIGHTNESS = 0.12;

export interface SpaceSprites {
  /** Soft glow for sparkles, one per colour temperature. */
  readonly halos: readonly HTMLCanvasElement[];
  /** Small glow for non-sparkle stars, one per colour temperature. */
  readonly smallHalos: readonly HTMLCanvasElement[];
  /** Thin 4-point diffraction cross, one per colour temperature. */
  readonly spikes: readonly HTMLCanvasElement[];
  /** Horizontal streak, head on the right. */
  readonly tail: HTMLCanvasElement;
}

export interface SpaceScene {
  /** Grouped by colour tone so `fillStyle` changes at most once per tone. */
  stars: readonly SpaceStar[];
  sprites: SpaceSprites;
  readonly rng: () => number;
  shot: ShootingStar | null;
  nextShotAt: number;
  width: number;
  height: number;
  readonly dpr: number;
}

function makeCanvas(width: number, height: number, dpr: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx?.scale(dpr, dpr);
  return [canvas, ctx];
}

const rgba = (rgb: Rgb, alpha: number): string => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;

function buildHalo(rgb: Rgb, size: number, dpr: number): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(size, size, dpr);
  if (!ctx) return canvas;
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, rgba(rgb, 0.85));
  gradient.addColorStop(0.12, rgba(rgb, 0.45));
  gradient.addColorStop(0.4, rgba(rgb, 0.12));
  gradient.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function buildSpike(rgb: Rgb, dpr: number): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(SPIKE_SIZE, SPIKE_SIZE, dpr);
  if (!ctx) return canvas;
  const c = SPIKE_SIZE / 2;
  const hot: Rgb = [255, 255, 255];
  for (const vertical of [false, true]) {
    const gradient = vertical ? ctx.createLinearGradient(c, 0, c, SPIKE_SIZE) : ctx.createLinearGradient(0, c, SPIKE_SIZE, c);
    gradient.addColorStop(0, rgba(rgb, 0));
    gradient.addColorStop(0.35, rgba(rgb, 0.18));
    gradient.addColorStop(0.5, rgba(hot, 0.95));
    gradient.addColorStop(0.65, rgba(rgb, 0.18));
    gradient.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = gradient;
    // Thin bar that fades towards both ends through the gradient.
    if (vertical) ctx.fillRect(c - SPIKE_THICKNESS / 2, 0, SPIKE_THICKNESS, SPIKE_SIZE);
    else ctx.fillRect(0, c - SPIKE_THICKNESS / 2, SPIKE_SIZE, SPIKE_THICKNESS);
  }
  const core = ctx.createRadialGradient(c, c, 0, c, c, SPIKE_CORE_RADIUS);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.3, rgba(rgb, 0.5));
  core.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = core;
  ctx.fillRect(c - SPIKE_CORE_RADIUS, c - SPIKE_CORE_RADIUS, SPIKE_CORE_RADIUS * 2, SPIKE_CORE_RADIUS * 2);
  return canvas;
}

function buildTail(dpr: number): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(TAIL_WIDTH, TAIL_HEIGHT, dpr);
  if (!ctx) return canvas;
  const mid = TAIL_HEIGHT / 2;
  const gradient = ctx.createLinearGradient(0, 0, TAIL_WIDTH, 0);
  gradient.addColorStop(0, 'rgba(160,185,255,0)');
  gradient.addColorStop(0.7, 'rgba(200,215,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(TAIL_WIDTH - 4, mid - 1.4);
  ctx.lineTo(TAIL_WIDTH - 4, mid + 1.4);
  ctx.closePath();
  ctx.fill();
  const head = ctx.createRadialGradient(TAIL_WIDTH - 4, mid, 0, TAIL_WIDTH - 4, mid, 6);
  head.addColorStop(0, 'rgba(255,255,255,1)');
  head.addColorStop(1, 'rgba(180,200,255,0)');
  ctx.fillStyle = head;
  ctx.fillRect(TAIL_WIDTH - 10, 0, 10, TAIL_HEIGHT);
  return canvas;
}

const spriteCache = new Map<number, SpaceSprites>();

/** Offscreen glow / spike / tail sprites, built once per device pixel ratio and shared by every scene. */
export function createSpaceSprites(dpr: number): SpaceSprites {
  const cached = spriteCache.get(dpr);
  if (cached) return cached;
  const sprites: SpaceSprites = {
    halos: SPACE_TONES.map((rgb) => buildHalo(rgb, HALO_SIZE, dpr)),
    smallHalos: SPACE_TONES.map((rgb) => buildHalo(rgb, SMALL_HALO_SIZE, dpr)),
    spikes: SPACE_TONES.map((rgb) => buildSpike(rgb, dpr)),
    tail: buildTail(dpr),
  };
  spriteCache.set(dpr, sprites);
  return sprites;
}

/**
 * Scene for a viewport. Pass the `previous` scene on resize: a small height-only change (mobile address bar)
 * just rescales it, an unchanged star count keeps the star list, and the shooting-star state is always kept.
 */
export function createSpaceScene(width: number, height: number, density: number, dpr: number, seed: number, previous: SpaceScene | null = null): SpaceScene {
  if (previous && isMinorResize(previous, { width, height, dpr })) {
    previous.height = height;
    return previous;
  }
  const count = spaceStarCount(width, height, density);
  return {
    stars: previous && previous.stars.length === count ? previous.stars : groupByTone(generateSpaceStars(count, seed)),
    sprites: createSpaceSprites(dpr),
    rng: previous?.rng ?? createRng(seed ^ 0x9e3779b9),
    shot: previous?.shot ?? null,
    nextShotAt: previous?.nextShotAt ?? -1,
    width,
    height,
    dpr,
  };
}

/** Per-star values for one frame; one shared object so the draw loop allocates nothing. */
interface StarLook {
  x: number;
  y: number;
  alpha: number;
  radius: number;
  boost: number;
}

const look: StarLook = { x: 0, y: 0, alpha: 0, radius: 0, boost: 0 };
const flicker: Twinkle = { alpha: 1, scale: 1 };

/** Position, opacity and size of a star at `time`, including drift, parallax, twinkle and the pointer glow. */
function computeLook(scene: SpaceScene, star: SpaceStar, state: FieldState, time: number): void {
  const { width, height } = scene;
  const drift = time * DRIFT_PX_PER_MS * star.layer;
  look.x = wrapUnit((star.x * width + drift + state.offsetX * star.layer) / width) * width;
  look.y = wrapUnit((star.y * height + drift * 0.3 + state.offsetY * star.layer) / height) * height;
  twinkle(star, time, flicker);
  look.alpha = (0.28 + 0.72 * Math.sqrt(star.brightness)) * (0.5 + 0.5 * star.layer) * flicker.alpha;
  look.radius = star.radius * flicker.scale;
  look.boost = 0;

  const dx = state.pointerX - look.x;
  const dy = state.pointerY - look.y;
  const distance = Math.hypot(dx, dy);
  if (state.pointerStrength > 0.001 && distance > 0.5 && distance < POINTER_RADIUS_PX) {
    const boost = (1 - distance / POINTER_RADIUS_PX) ** 2 * state.pointerStrength;
    look.boost = boost;
    look.x += (dx / distance) * boost * 10 * star.layer;
    look.y += (dy / distance) * boost * 10 * star.layer;
    look.alpha += boost * 0.45;
    look.radius *= 1 + boost * 0.6;
  }
  look.alpha = Math.min(1, look.alpha);
}

function drawSparkle(ctx: CanvasRenderingContext2D, scene: SpaceScene, star: SpaceStar, time: number): void {
  const halo = scene.sprites.halos[star.tone];
  const spike = scene.sprites.spikes[star.tone];
  if (!halo || !spike) return;
  const { x, y, alpha, radius, boost } = look;
  const pulse = 0.88 + 0.12 * Math.sin(time * 0.0011 + star.phase);
  const haloSize = radius * 11 * (1 + boost * 0.4);
  ctx.globalAlpha = Math.min(1, alpha * 0.8);
  ctx.drawImage(halo, x - haloSize / 2, y - haloSize / 2, haloSize, haloSize);
  const spikeSize = (34 + star.brightness * 38) * pulse * (1 + boost * 0.35);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(time * 0.00007 * (star.phase > Math.PI ? 1 : -1) + star.phase);
  ctx.globalAlpha = alpha;
  ctx.drawImage(spike, -spikeSize / 2, -spikeSize / 2, spikeSize, spikeSize);
  ctx.restore();
}

function drawPlainStar(ctx: CanvasRenderingContext2D, scene: SpaceScene, star: SpaceStar): void {
  const { x, y, alpha, radius, boost } = look;
  const halo = scene.sprites.smallHalos[star.tone];
  if (halo && (star.brightness > SMALL_HALO_MIN_BRIGHTNESS || boost > 0.2)) {
    const haloSize = radius * 6;
    ctx.globalAlpha = alpha * 0.35;
    ctx.drawImage(halo, x - haloSize / 2, y - haloSize / 2, haloSize, haloSize);
  }
  ctx.globalAlpha = alpha;
  if (radius < 1.05) {
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    return;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawStar(ctx: CanvasRenderingContext2D, scene: SpaceScene, star: SpaceStar, state: FieldState, time: number): void {
  computeLook(scene, star, state, time);
  if (star.isSparkle) drawSparkle(ctx, scene, star, time);
  else drawPlainStar(ctx, scene, star);
}

function drawShootingStar(ctx: CanvasRenderingContext2D, scene: SpaceScene, time: number): void {
  const shot = scene.shot;
  if (!shot) return;
  const progress = shootingStarProgress(shot, time);
  if (progress === null) {
    scene.shot = null;
    return;
  }
  const elapsed = time - shot.startedAt;
  const headX = shot.x + shot.vx * elapsed;
  const headY = shot.y + shot.vy * elapsed;
  const fade = Math.sin(progress * Math.PI);
  const length = shot.length * (0.35 + 0.65 * Math.min(1, progress * 3));
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(Math.atan2(shot.vy, shot.vx));
  ctx.globalAlpha = Math.min(1, fade * 1.2);
  ctx.drawImage(scene.sprites.tail, -length, -TAIL_HEIGHT / 2, length, TAIL_HEIGHT);
  ctx.restore();
}

/** Draws one frame. Pass `allowShootingStars=false` for the static (reduced-motion) frame. */
export function drawSpace(ctx: CanvasRenderingContext2D, scene: SpaceScene, state: FieldState, time: number, allowShootingStars: boolean): void {
  ctx.clearRect(0, 0, scene.width, scene.height);
  let tone = -1;
  for (const star of scene.stars) {
    if (star.tone !== tone) {
      tone = star.tone;
      ctx.fillStyle = SPACE_TONE_CSS[tone] ?? SPACE_TONE_CSS[1] ?? '#fff';
    }
    drawStar(ctx, scene, star, state, time);
  }
  if (allowShootingStars) {
    if (scene.nextShotAt < 0) scene.nextShotAt = time + FIRST_SHOT_MS + scene.rng() * 2000;
    if (!scene.shot && time >= scene.nextShotAt) {
      scene.shot = createShootingStar(scene.rng, scene.width, scene.height, time);
      scene.nextShotAt = time + scene.shot.durationMs + nextShootingDelayMs(scene.rng);
    }
    drawShootingStar(ctx, scene, time);
  }
  ctx.globalAlpha = 1;
}
