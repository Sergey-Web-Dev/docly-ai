import { trailLength, wrapUnit, type Star } from '@/lib/starfield';

// r, g, b per tone: indigo-500, indigo-600, violet-500, violet-600, slate-500.
const TONES: readonly (readonly [number, number, number])[] = [
  [99, 102, 241],
  [79, 70, 229],
  [139, 92, 246],
  [124, 58, 237],
  [100, 116, 139],
];
const FALLBACK_TONE: readonly [number, number, number] = [99, 102, 241];
const POINTER_RADIUS_PX = 150;
const DRIFT_PX_PER_MS = 0.006;
const GLOW_RADIUS_FACTOR = 5;

export interface FieldState {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  targetX: number;
  targetY: number;
  pointerX: number;
  pointerY: number;
  pointerStrength: number;
  /** Smoothed cursor velocity in px per ms. */
  velocityX: number;
  velocityY: number;
  lastMoveAt: number;
}

export function createFieldState(): FieldState {
  return {
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
    targetX: 0,
    targetY: 0,
    pointerX: 0,
    pointerY: 0,
    pointerStrength: 0,
    velocityX: 0,
    velocityY: 0,
    lastMoveAt: Number.NEGATIVE_INFINITY,
  };
}

function drawGlow(ctx: CanvasRenderingContext2D, px: number, py: number, radius: number, rgb: readonly [number, number, number], alpha: number): void {
  const reach = radius * GLOW_RADIUS_FACTOR;
  const gradient = ctx.createRadialGradient(px, py, 0, px, py, reach);
  gradient.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(alpha * 0.6).toFixed(3)})`);
  gradient.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(px, py, reach, 0, Math.PI * 2);
  ctx.fill();
}

function drawStar(ctx: CanvasRenderingContext2D, star: Star, state: FieldState, time: number, opacity: number): void {
  const { width, height } = state;
  const driftX = time * DRIFT_PX_PER_MS * star.z;
  let px = wrapUnit((star.x * width + driftX + state.offsetX * star.z) / width) * width;
  let py = wrapUnit((star.y * height + driftX * 0.35 + state.offsetY * star.z) / height) * height;

  const twinkle = 0.8 + 0.2 * Math.sin(time * 0.0015 * (0.6 + star.z) + star.phase);
  let alpha = star.alpha * twinkle;
  let radius = star.radius;

  const dx = state.pointerX - px;
  const dy = state.pointerY - py;
  const distance = Math.hypot(dx, dy);
  if (state.pointerStrength > 0.001 && distance > 0.5 && distance < POINTER_RADIUS_PX) {
    const closeness = (1 - distance / POINTER_RADIUS_PX) ** 2 * state.pointerStrength;
    px += (dx / distance) * closeness * 14 * star.z;
    py += (dy / distance) * closeness * 14 * star.z;
    alpha += closeness * 0.3;
    radius *= 1 + closeness * 0.5;
  }

  const rgb = TONES[star.tone] ?? FALLBACK_TONE;
  const finalAlpha = Math.min(1, alpha) * opacity;
  if (star.isHero) drawGlow(ctx, px, py, radius, rgb, finalAlpha);

  const color = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const speed = Math.hypot(state.velocityX, state.velocityY);
  const trail = trailLength(speed, star.z);
  ctx.globalAlpha = finalAlpha;
  if (trail > 0.5 && speed > 0) {
    ctx.strokeStyle = color;
    ctx.lineWidth = radius * 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - (state.velocityX / speed) * trail, py - (state.velocityY / speed) * trail);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function drawField(ctx: CanvasRenderingContext2D, stars: readonly Star[], state: FieldState, time: number, opacity: number): void {
  ctx.clearRect(0, 0, state.width, state.height);
  for (const star of stars) drawStar(ctx, star, state, time, opacity);
  ctx.globalAlpha = 1;
}
