import type { FieldState } from '@/lib/starfield-draw';
import { createRng, wrapUnit } from '@/lib/starfield';
import {
  SPACE_TONES,
  createShootingStar,
  generateSpaceStars,
  nextShootingDelayMs,
  shootingStarProgress,
  spaceStarCount,
  twinkle,
  type ShootingStar,
  type SpaceStar,
} from '@/lib/space-sky';

const HALO_SIZE = 96;
const SPIKE_SIZE = 192;
const TAIL_WIDTH = 256;
const TAIL_HEIGHT = 12;
const DRIFT_PX_PER_MS = 0.0035;
const POINTER_RADIUS_PX = 170;
const FIRST_SHOT_MS = 1800;

type Rgb = readonly [number, number, number];
const FALLBACK_TONE: Rgb = [246, 248, 255];

export interface SpaceSprites {
  /** Soft glow, one per colour temperature. */
  readonly halos: readonly HTMLCanvasElement[];
  /** Thin 4-point diffraction cross, one per colour temperature. */
  readonly spikes: readonly HTMLCanvasElement[];
  /** Horizontal streak, head on the right. */
  readonly tail: HTMLCanvasElement;
}

export interface SpaceScene {
  readonly stars: readonly SpaceStar[];
  readonly sprites: SpaceSprites;
  readonly rng: () => number;
  shot: ShootingStar | null;
  nextShotAt: number;
  width: number;
  height: number;
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

function buildHalo(rgb: Rgb, dpr: number): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(HALO_SIZE, HALO_SIZE, dpr);
  if (!ctx) return canvas;
  const c = HALO_SIZE / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, rgba(rgb, 0.85));
  gradient.addColorStop(0.12, rgba(rgb, 0.45));
  gradient.addColorStop(0.4, rgba(rgb, 0.12));
  gradient.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, HALO_SIZE, HALO_SIZE);
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
    // Thin, tapering bar: wide at the centre line only through the gradient, 1.4 px thick.
    if (vertical) ctx.fillRect(c - 0.7, 0, 1.4, SPIKE_SIZE);
    else ctx.fillRect(0, c - 0.7, SPIKE_SIZE, 1.4);
  }
  const core = ctx.createRadialGradient(c, c, 0, c, c, 10);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.3, rgba(rgb, 0.5));
  core.addColorStop(1, rgba(rgb, 0));
  ctx.fillStyle = core;
  ctx.fillRect(c - 10, c - 10, 20, 20);
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

/** Offscreen glow / spike / tail sprites, built once so no gradient is created per frame. */
export function createSpaceSprites(dpr: number): SpaceSprites {
  return {
    halos: SPACE_TONES.map((rgb) => buildHalo(rgb, dpr)),
    spikes: SPACE_TONES.map((rgb) => buildSpike(rgb, dpr)),
    tail: buildTail(dpr),
  };
}

export function createSpaceScene(width: number, height: number, density: number, dpr: number, seed: number): SpaceScene {
  const rng = createRng(seed ^ 0x9e3779b9);
  return {
    stars: generateSpaceStars(spaceStarCount(width, height, density), seed),
    sprites: createSpaceSprites(dpr),
    rng,
    shot: null,
    nextShotAt: -1,
    width,
    height,
  };
}

function drawStar(ctx: CanvasRenderingContext2D, scene: SpaceScene, star: SpaceStar, state: FieldState, time: number): void {
  const { width, height } = scene;
  const drift = time * DRIFT_PX_PER_MS * star.layer;
  let px = wrapUnit((star.x * width + drift + state.offsetX * star.layer) / width) * width;
  let py = wrapUnit((star.y * height + drift * 0.3 + state.offsetY * star.layer) / height) * height;

  const flicker = twinkle(star, time);
  const base = 0.28 + 0.72 * Math.sqrt(star.brightness);
  let alpha = base * (0.5 + 0.5 * star.layer) * flicker.alpha;
  let radius = star.radius * flicker.scale;
  let boost = 0;

  const dx = state.pointerX - px;
  const dy = state.pointerY - py;
  const distance = Math.hypot(dx, dy);
  if (state.pointerStrength > 0.001 && distance > 0.5 && distance < POINTER_RADIUS_PX) {
    boost = (1 - distance / POINTER_RADIUS_PX) ** 2 * state.pointerStrength;
    px += (dx / distance) * boost * 10 * star.layer;
    py += (dy / distance) * boost * 10 * star.layer;
    alpha += boost * 0.45;
    radius *= 1 + boost * 0.6;
  }
  alpha = Math.min(1, alpha);

  const rgb = SPACE_TONES[star.tone] ?? FALLBACK_TONE;
  const halo = scene.sprites.halos[star.tone];
  const spike = scene.sprites.spikes[star.tone];

  if (star.isSparkle && halo && spike) {
    const pulse = 0.88 + 0.12 * Math.sin(time * 0.0011 + star.phase);
    const haloSize = radius * 11 * (1 + boost * 0.4);
    ctx.globalAlpha = Math.min(1, alpha * 0.8);
    ctx.drawImage(halo, px - haloSize / 2, py - haloSize / 2, haloSize, haloSize);
    const spikeSize = (34 + star.brightness * 38) * pulse * (1 + boost * 0.35);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(time * 0.00007 * (star.phase > Math.PI ? 1 : -1) + star.phase);
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(spike, -spikeSize / 2, -spikeSize / 2, spikeSize, spikeSize);
    ctx.restore();
  } else {
    if (halo && (star.brightness > 0.12 || boost > 0.2)) {
      const haloSize = radius * 6;
      ctx.globalAlpha = alpha * 0.35;
      ctx.drawImage(halo, px - haloSize / 2, py - haloSize / 2, haloSize, haloSize);
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    if (radius < 1.05) {
      const side = radius * 2;
      ctx.fillRect(px - radius, py - radius, side, side);
    } else {
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
  for (const star of scene.stars) drawStar(ctx, scene, star, state, time);
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
