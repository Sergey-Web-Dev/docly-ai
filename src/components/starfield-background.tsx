'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { clampOffset, easeToward, generateStars, starCountForArea, wrapUnit, type Star } from '@/lib/starfield';

// indigo-500, indigo-600, slate-500: soft stars on the app's light background.
const TONE_COLORS: readonly string[] = ['#6366f1', '#4f46e5', '#64748b'];
const STAR_SEED = 20260611;
const MAX_PARALLAX_PX = 28;
const IDLE_MS = 2000;
const POINTER_RADIUS_PX = 150;
const MAX_DPR = 2;
const DRIFT_PX_PER_MS = 0.006;
const DASHBOARD_DENSITY = 0.45;
const DASHBOARD_OPACITY = 0.6;

interface FieldState {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  targetX: number;
  targetY: number;
  pointerX: number;
  pointerY: number;
  pointerStrength: number;
  lastMoveAt: number;
}

interface StarfieldCanvasProps {
  readonly density: number;
  readonly opacity: number;
}

function drawStar(ctx: CanvasRenderingContext2D, star: Star, state: FieldState, time: number, opacity: number): void {
  const { width, height } = state;
  const driftX = time * DRIFT_PX_PER_MS * star.z;
  let px = wrapUnit((star.x * width + driftX + state.offsetX * star.z) / width) * width;
  let py = wrapUnit((star.y * height + driftX * 0.35 + state.offsetY * star.z) / height) * height;

  const twinkle = 0.65 + 0.35 * Math.sin(time * 0.0015 * (0.6 + star.z) + star.phase);
  let alpha = (0.22 + 0.42 * star.z) * twinkle;
  let radius = star.radius;

  const dx = state.pointerX - px;
  const dy = state.pointerY - py;
  const distance = Math.hypot(dx, dy);
  if (state.pointerStrength > 0.001 && distance > 0.5 && distance < POINTER_RADIUS_PX) {
    const closeness = (1 - distance / POINTER_RADIUS_PX) ** 2 * state.pointerStrength;
    px += (dx / distance) * closeness * 14 * star.z;
    py += (dy / distance) * closeness * 14 * star.z;
    alpha += closeness * 0.4;
    radius *= 1 + closeness * 0.5;
  }

  ctx.globalAlpha = Math.min(1, alpha) * opacity;
  ctx.fillStyle = TONE_COLORS[star.tone] ?? TONE_COLORS[0] ?? '#6366f1';
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawField(ctx: CanvasRenderingContext2D, stars: readonly Star[], state: FieldState, time: number, opacity: number): void {
  ctx.clearRect(0, 0, state.width, state.height);
  for (const star of stars) drawStar(ctx, star, state, time, opacity);
  ctx.globalAlpha = 1;
}

function StarfieldCanvas({ density, opacity }: StarfieldCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!canvas || !ctx) return;

    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const state: FieldState = {
      width: 0,
      height: 0,
      offsetX: 0,
      offsetY: 0,
      targetX: 0,
      targetY: 0,
      pointerX: 0,
      pointerY: 0,
      pointerStrength: 0,
      lastMoveAt: Number.NEGATIVE_INFINITY,
    };
    let stars: readonly Star[] = [];
    let frameId = 0;
    let lastTime = 0;
    let pointerTarget = 0;

    const resize = (): void => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      state.width = window.innerWidth;
      state.height = window.innerHeight;
      canvas.width = Math.round(state.width * dpr);
      canvas.height = Math.round(state.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = generateStars(starCountForArea(state.width, state.height, density), STAR_SEED);
    };

    resize();

    if (isReduced) {
      drawField(ctx, stars, state, 0, opacity);
      return;
    }

    const frame = (time: number): void => {
      const dt = lastTime === 0 ? 16 : Math.min(64, time - lastTime);
      lastTime = time;
      const isIdle = time - state.lastMoveAt > IDLE_MS;
      if (isIdle) {
        state.targetX = 0;
        state.targetY = 0;
        pointerTarget = 0;
      }
      const factor = 1 - Math.exp(-dt / 350);
      state.offsetX = easeToward(state.offsetX, state.targetX, factor);
      state.offsetY = easeToward(state.offsetY, state.targetY, factor);
      state.pointerStrength = easeToward(state.pointerStrength, pointerTarget, factor);
      drawField(ctx, stars, state, time, opacity);
      frameId = requestAnimationFrame(frame);
    };

    const start = (): void => {
      if (frameId === 0) {
        lastTime = 0;
        frameId = requestAnimationFrame(frame);
      }
    };
    const stop = (): void => {
      cancelAnimationFrame(frameId);
      frameId = 0;
    };

    const handlePointerMove = (event: PointerEvent): void => {
      state.lastMoveAt = performance.now();
      state.pointerX = event.clientX;
      state.pointerY = event.clientY;
      pointerTarget = 1;
      const nx = (event.clientX / state.width - 0.5) * 2;
      const ny = (event.clientY / state.height - 0.5) * 2;
      state.targetX = clampOffset(-nx * MAX_PARALLAX_PX, MAX_PARALLAX_PX);
      state.targetY = clampOffset(-ny * MAX_PARALLAX_PX, MAX_PARALLAX_PX);
    };

    const handleVisibilityChange = (): void => {
      if (document.hidden) stop();
      else start();
    };

    let resizeTimer = 0;
    const handleResize = (): void => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 120);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (!document.hidden) start();

    return () => {
      stop();
      window.clearTimeout(resizeTimer);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [density, opacity]);

  return <canvas ref={canvasRef} aria-hidden="true" data-testid="starfield" className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}

/** Fixed full-viewport star field behind the whole app. Never rendered inside the embeddable widget. */
export function StarfieldBackground(): React.ReactElement | null {
  const pathname = usePathname();
  if (pathname.startsWith('/embed')) return null;
  const isDashboard = pathname.startsWith('/dashboard');
  return <StarfieldCanvas density={isDashboard ? DASHBOARD_DENSITY : 1} opacity={isDashboard ? DASHBOARD_OPACITY : 1} />;
}
