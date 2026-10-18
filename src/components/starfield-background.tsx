'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { SpaceBackdrop, type BackdropVariant } from '@/components/space-backdrop';
import { createSkyScene, type SkyVariant } from '@/lib/sky-scene';
import { createFieldState, type FieldState } from '@/lib/starfield-draw';
import { clampOffset, easeToward } from '@/lib/starfield';

const SPACE_PATHS: readonly string[] = ['/', '/login', '/signup'];
const MAX_PARALLAX_PX = 28;
const IDLE_MS = 2000;
const MAX_DPR = 2;
const THROTTLED_FRAME_MS = 33;
const LOW_CORE_COUNT = 4;
const CHECKOUT_PATH = '/dashboard/billing/checkout';
const CHAT_PATH = '/dashboard/chat';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

interface StarfieldCanvasProps {
  readonly variant: SkyVariant;
  readonly density: number;
  /** Only the light variant uses this; the other variants have their own per-star brightness. */
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
      const scene = createSkyScene(ctx, state, { variant, density: effectiveDensity, opacity, isStatic });
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
        scene.resize(dpr);
        if (isStatic) scene.draw(0);
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
        scene.draw(time);
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

  return <canvas ref={canvasRef} aria-hidden="true" data-testid="starfield" data-variant={variant} className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}

interface SkyChoice {
  readonly variant: SkyVariant;
  readonly backdrop: BackdropVariant | null;
  readonly isPaused: boolean;
  readonly density: number;
}

const EMBED_DENSITY = 0.5;

function chooseSky(pathname: string): SkyChoice {
  if (SPACE_PATHS.includes(pathname)) return { variant: 'space', backdrop: 'space', isPaused: false, density: 1 };
  // Chat (playground and the embeddable widget) is calm and readable: a slowly rotating galaxy.
  // The widget iframe is small and sits on customers' pages: half the particles keep it light.
  if (pathname.startsWith('/embed')) return { variant: 'galaxy', backdrop: 'galaxy', isPaused: false, density: EMBED_DENSITY };
  if (pathname === CHAT_PATH || pathname.startsWith(`${CHAT_PATH}/`)) return { variant: 'galaxy', backdrop: 'galaxy', isPaused: false, density: 1 };
  // The rest of the dashboard, billing and checkout: aurora and cursor-linked constellations. Checkout holds still while typing.
  if (pathname.startsWith('/dashboard')) return { variant: 'constellations', backdrop: 'aurora', isPaused: pathname.startsWith(CHECKOUT_PATH), density: 1 };
  return { variant: 'light', backdrop: null, isPaused: false, density: 1 };
}

/** Fixed full-viewport sky behind the whole app: one of three space formats, or the light field elsewhere. */
export function StarfieldBackground(): React.ReactElement {
  const pathname = usePathname();
  const { variant, backdrop, isPaused, density } = chooseSky(pathname);
  return (
    <>
      {backdrop ? <SpaceBackdrop variant={backdrop} isPaused={isPaused} /> : null}
      <StarfieldCanvas variant={variant} density={density} opacity={1} isPaused={isPaused} />
    </>
  );
}
