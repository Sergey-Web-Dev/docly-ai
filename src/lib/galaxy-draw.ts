import {
  CONSTELLATION_TONE_CSS,
  calmTwinkle,
  generateCalmStars,
  type CalmStar,
} from '@/lib/constellation-sky';
import {
  GALAXY_SQUASH,
  GALAXY_TILT,
  GALAXY_TONES,
  GALAXY_TONE_CSS,
  galaxyLayout,
  galaxyParticleCount,
  galaxyRotation,
  generateGalaxyParticles,
  projectParticle,
  type GalaxyLayout,
  type GalaxyParticle,
  type Point,
  type Projection,
} from '@/lib/galaxy-sky';
import type { FieldState } from '@/lib/starfield-draw';
import { wrapUnit } from '@/lib/starfield';

/** Haze sprite edge in CSS px; the unit disc spans all of it. Drawn scaled to the real galaxy size. */
const HAZE_SIZE = 512;
const HAZE_PARTICLES = 2800;
const HAZE_SEED = 7;
const SOFT_DOT_SIZE = 64;
const DUST_DENSITY_PX = 4200;
const MIN_DUST = 70;
const MAX_DUST = 420;
const DUST_DRIFT_PX_PER_MS = 0.0009;
const GALAXY_PARALLAX = 0.35;
const DUST_PARALLAX = 0.45;

export interface GalaxyScene {
  /** Grouped by colour tone so `fillStyle` changes at most once per tone. */
  readonly particles: readonly GalaxyParticle[];
  readonly dust: readonly CalmStar[];
  readonly haze: HTMLCanvasElement;
  layout: GalaxyLayout;
  /** Reused every frame so the draw loop allocates nothing. */
  readonly view: Projection;
  readonly point: Point;
  width: number;
  height: number;
  readonly dpr: number;
}

function makeCanvas(size: number, dpr: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d');
  ctx?.scale(dpr, dpr);
  return [canvas, ctx];
}

function buildSoftDots(dpr: number): readonly HTMLCanvasElement[] {
  return GALAXY_TONES.map(([r, g, b]) => {
    const [canvas, ctx] = makeCanvas(SOFT_DOT_SIZE, dpr);
    if (!ctx) return canvas;
    const c = SOFT_DOT_SIZE / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gradient.addColorStop(0.35, `rgba(${r},${g},${b},0.35)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SOFT_DOT_SIZE, SOFT_DOT_SIZE);
    return canvas;
  });
}

function buildHaze(dpr: number): HTMLCanvasElement {
  const [canvas, ctx] = makeCanvas(HAZE_SIZE, dpr);
  if (!ctx) return canvas;
  const half = HAZE_SIZE / 2;
  const dots = buildSoftDots(dpr);
  ctx.globalCompositeOperation = 'lighter';
  for (const p of generateGalaxyParticles(HAZE_PARTICLES, HAZE_SEED)) {
    const dot = dots[p.tone];
    if (!dot) continue;
    const r = Math.hypot(p.lx, p.ly);
    const size = 36 - 16 * r;
    ctx.globalAlpha = (0.03 + 0.05 * Math.sqrt(p.brightness)) * (r < 0.3 ? 0.35 : 1);
    ctx.drawImage(dot, half + p.lx * half - size / 2, half + p.ly * half - size / 2, size, size);
  }
  // Warm core glow.
  const core = ctx.createRadialGradient(half, half, 0, half, half, half * 0.42);
  core.addColorStop(0, 'rgba(255,238,205,0.55)');
  core.addColorStop(0.2, 'rgba(255,214,160,0.26)');
  core.addColorStop(0.55, 'rgba(210,150,130,0.07)');
  core.addColorStop(1, 'rgba(180,120,140,0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, HAZE_SIZE, HAZE_SIZE);
  return canvas;
}

const hazeCache = new Map<number, HTMLCanvasElement>();

function createHaze(dpr: number): HTMLCanvasElement {
  const cached = hazeCache.get(dpr);
  if (cached) return cached;
  const haze = buildHaze(dpr);
  hazeCache.set(dpr, haze);
  return haze;
}

function dustCount(width: number, height: number, density: number): number {
  const base = Math.min(MAX_DUST, Math.max(MIN_DUST, Math.round((width * height) / DUST_DENSITY_PX)));
  return Math.round(base * Math.min(1, Math.max(0.1, density)));
}

/** Scene for a viewport. Pass `previous` on resize: particles and dust are kept when their counts are unchanged. */
export function createGalaxyScene(width: number, height: number, density: number, dpr: number, seed: number, previous: GalaxyScene | null = null): GalaxyScene {
  const layout = galaxyLayout(width, height);
  const particleCount = galaxyParticleCount(layout.radius, density);
  const dustTotal = dustCount(width, height, density);
  const view: Projection = { cx: layout.cx, cy: layout.cy, radius: layout.radius, cosA: 1, sinA: 0, squash: GALAXY_SQUASH, cosT: Math.cos(GALAXY_TILT), sinT: Math.sin(GALAXY_TILT) };
  return {
    particles: previous && previous.particles.length === particleCount ? previous.particles : generateGalaxyParticles(particleCount, seed),
    dust: previous && previous.dust.length === dustTotal ? previous.dust : generateCalmStars(dustTotal, seed ^ 0x2545f491, 0.7),
    haze: createHaze(dpr),
    layout,
    view,
    point: { x: 0, y: 0 },
    width,
    height,
    dpr,
  };
}

function drawDust(ctx: CanvasRenderingContext2D, scene: GalaxyScene, state: FieldState, time: number): void {
  const { width, height } = scene;
  let tone = -1;
  for (const star of scene.dust) {
    if (star.tone !== tone) {
      tone = star.tone;
      ctx.fillStyle = CONSTELLATION_TONE_CSS[tone] ?? '#fff';
    }
    const drift = time * DUST_DRIFT_PX_PER_MS * star.layer;
    const x = wrapUnit((star.x * width + drift + state.offsetX * star.layer * DUST_PARALLAX) / width) * width;
    const y = wrapUnit((star.y * height + drift * 0.3 + state.offsetY * star.layer * DUST_PARALLAX) / height) * height;
    ctx.globalAlpha = Math.min(1, (0.16 + 0.55 * Math.sqrt(star.brightness)) * (0.5 + 0.5 * star.layer) * calmTwinkle(star, time));
    const size = Math.max(0.9, star.radius * 2);
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
}

function drawGalaxy(ctx: CanvasRenderingContext2D, scene: GalaxyScene, state: FieldState, time: number): void {
  const { view, point, layout } = scene;
  const angle = galaxyRotation(time);
  view.cosA = Math.cos(angle);
  view.sinA = Math.sin(angle);
  view.cx = layout.cx + state.offsetX * GALAXY_PARALLAX;
  view.cy = layout.cy + state.offsetY * GALAXY_PARALLAX;

  ctx.save();
  ctx.translate(view.cx, view.cy);
  ctx.rotate(GALAXY_TILT);
  ctx.scale(1, GALAXY_SQUASH);
  ctx.rotate(angle);
  ctx.globalAlpha = layout.hazeAlpha;
  ctx.drawImage(scene.haze, -view.radius, -view.radius, view.radius * 2, view.radius * 2);
  ctx.restore();

  let tone = -1;
  for (const p of scene.particles) {
    if (p.tone !== tone) {
      tone = p.tone;
      ctx.fillStyle = GALAXY_TONE_CSS[tone] ?? '#fff';
    }
    projectParticle(p.lx, p.ly, view, point);
    ctx.globalAlpha = Math.min(1, (0.22 + 0.78 * Math.sqrt(p.brightness)) * (0.82 + 0.18 * Math.sin(time * p.speed + p.phase)));
    ctx.fillRect(point.x - p.size / 2, point.y - p.size / 2, p.size, p.size);
  }
}

/** Draws one frame: dust, then the rotating galaxy. A `time` of 0 gives the static (reduced-motion) frame. */
export function drawGalaxyScene(ctx: CanvasRenderingContext2D, scene: GalaxyScene, state: FieldState, time: number): void {
  ctx.clearRect(0, 0, scene.width, scene.height);
  drawDust(ctx, scene, state, time);
  drawGalaxy(ctx, scene, state, time);
  ctx.globalAlpha = 1;
}
