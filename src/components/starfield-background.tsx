'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { SpaceBackdrop } from '@/components/space-backdrop';
import { createSpaceScene, drawSpace } from '@/lib/space-draw';
import { createFieldState, drawField, type FieldState } from '@/lib/starfield-draw';
import { clampOffset, easeToward, generateStars, starCountForArea, type Star } from '@/lib/starfield';

const STAR_SEED = 20260611;
const SPACE_SEED = 20261018;
const SPACE_PATHS: readonly string[] = ['/', '/login', '/signup'];
const SPACE_CLASS = 'space-mode';
const MAX_PARALLAX_PX = 28;
const IDLE_MS = 2000;
const MAX_DPR = 2;
const DASHBOARD_DENSITY = 0.55;
const DASHBOARD_OPACITY = 0.8;
const THROTTLED_FRAME_MS = 33;
const LOW_CORE_COUNT = 4;
const CHECKOUT_PATH = '/dashboard/billing/checkout';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

type StarfieldVariant = 'light' | 'space';

interface StarfieldCanvasProps {
  readonly variant: StarfieldVariant;
  readonly density: number;
  readonly opacity: number;
  /** Draw one still frame and run no animation loop (checkout page). */
  readonly isPaused: boolean;
}

// Touch devices and low-core machines get half the stars and ~30 fps.
function isLowPowerDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || LOW_CORE_COUNT + 1) <= LOW_CORE_COUNT;
}

function StarfieldCanvas({ variant, density, opacity, isPaused }: StarfieldCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (!canvas || !ctx) return;

    const isLowPower = isLowPowerDevice();
    const effectiveDensity = isLowPower ? density / 2 : density;
    const frameInterval = isLowPower ? THROTTLED_FRAME_MS : 0;
    const motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);

    // One run per mode. Switching mode (the reduced-motion setting changed at runtime) tears this down and starts again.
    const run = (isStatic: boolean): (() => void) => {
      const state: FieldState = createFieldState();
      let stars: readonly Star[] = [];
      let drawFrame: (time: number) => void = () => undefined;
      let frameId = 0;
      let lastTime = 0;
      let lastDrawn = 0;
      let lastPointerAt = 0;
      let pointerTarget = 0;
      let resizeTimer = 0;

      const resize = (): void => {
        const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
        state.width = window.innerWidth;
        state.height = window.innerHeight;
        canvas.width = Math.round(state.width * dpr);
        canvas.height = Math.round(state.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (variant === 'space') {
          const scene = createSpaceScene(state.width, state.height, effectiveDensity, dpr, SPACE_SEED);
          drawFrame = (time) => drawSpace(ctx, scene, state, time, !isStatic);
        } else {
          stars = generateStars(starCountForArea(state.width, state.height, effectiveDensity), STAR_SEED);
          drawFrame = (time) => drawField(ctx, stars, state, time, opacity);
        }
        if (isStatic) drawFrame(0);
      };
      const handleResize = (): void => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(resize, 120);
      };

      resize();
      window.addEventListener('resize', handleResize);
      if (isStatic) {
        return () => {
          window.clearTimeout(resizeTimer);
          window.removeEventListener('resize', handleResize);
        };
      }

      const frame = (time: number): void => {
        frameId = requestAnimationFrame(frame);
        if (time - lastDrawn < frameInterval) return;
        lastDrawn = time;
        const dt = lastTime === 0 ? 16 : Math.min(64, time - lastTime);
        lastTime = time;
        if (time - state.lastMoveAt > IDLE_MS) {
          state.targetX = 0;
          state.targetY = 0;
          pointerTarget = 0;
        }
        const factor = 1 - Math.exp(-dt / 350);
        state.offsetX = easeToward(state.offsetX, state.targetX, factor);
        state.offsetY = easeToward(state.offsetY, state.targetY, factor);
        state.pointerStrength = easeToward(state.pointerStrength, pointerTarget, factor);
        const decay = Math.exp(-dt / 120);
        state.velocityX *= decay;
        state.velocityY *= decay;
        drawFrame(time);
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
        const now = performance.now();
        const elapsed = Math.max(1, now - lastPointerAt);
        if (lastPointerAt > 0 && now - state.lastMoveAt < 100) {
          const smoothing = 0.35;
          state.velocityX += ((event.clientX - state.pointerX) / elapsed - state.velocityX) * smoothing;
          state.velocityY += ((event.clientY - state.pointerY) / elapsed - state.velocityY) * smoothing;
        }
        lastPointerAt = now;
        state.lastMoveAt = now;
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

      window.addEventListener('pointermove', handlePointerMove, { passive: true });
      document.addEventListener('visibilitychange', handleVisibilityChange);
      if (!document.hidden) start();

      return () => {
        stop();
        window.clearTimeout(resizeTimer);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    };

    let teardown = run(isPaused || motionQuery.matches);
    const handleMotionChange = (): void => {
      teardown();
      teardown = run(isPaused || motionQuery.matches);
    };
    motionQuery.addEventListener('change', handleMotionChange);

    return () => {
      motionQuery.removeEventListener('change', handleMotionChange);
      teardown();
    };
  }, [variant, density, opacity, isPaused]);

  return <canvas ref={canvasRef} aria-hidden="true" data-testid="starfield" className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}

/** Fixed full-viewport star field behind the whole app. Never rendered inside the embeddable widget. */
export function StarfieldBackground(): React.ReactElement | null {
  const pathname = usePathname();
  const isEmbed = pathname.startsWith('/embed');
  const isSpace = SPACE_PATHS.includes(pathname);

  useEffect(() => {
    if (!isSpace) return;
    document.documentElement.classList.add(SPACE_CLASS);
    return () => document.documentElement.classList.remove(SPACE_CLASS);
  }, [isSpace]);

  if (isEmbed) return null;
  if (isSpace) {
    return (
      <>
        <SpaceBackdrop />
        <StarfieldCanvas variant="space" density={1} opacity={1} isPaused={false} />
      </>
    );
  }
  const isDashboard = pathname.startsWith('/dashboard');
  return (
    <StarfieldCanvas
      variant="light"
      density={isDashboard ? DASHBOARD_DENSITY : 1}
      opacity={isDashboard ? DASHBOARD_OPACITY : 1}
      isPaused={pathname.startsWith(CHECKOUT_PATH)}
    />
  );
}
