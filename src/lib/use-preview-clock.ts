'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

const TICK_MS = 33;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToReducedMotion, getReducedMotionSnapshot, getReducedMotionServerSnapshot);
}

/**
 * Elapsed animation time in ms. It only advances while the target element is on screen and the tab is
 * visible, and stops entirely under `prefers-reduced-motion`. Every timer and observer is cleaned up.
 */
export function usePreviewClock(targetRef: RefObject<HTMLElement | null>, isEnabled: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const target = targetRef.current;
    if (!isEnabled || !target) return;

    let isOnScreen = true;
    let timerId = 0;
    let lastTick = 0;
    let elapsed = 0;

    const tick = (): void => {
      const now = performance.now();
      elapsed += now - lastTick;
      lastTick = now;
      setElapsedMs(elapsed);
    };
    const stop = (): void => {
      window.clearInterval(timerId);
      timerId = 0;
    };
    const sync = (): void => {
      const shouldRun = isOnScreen && !document.hidden;
      if (shouldRun && timerId === 0) {
        lastTick = performance.now();
        timerId = window.setInterval(tick, TICK_MS);
      } else if (!shouldRun && timerId !== 0) {
        stop();
      }
    };

    const observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1];
      if (latest) isOnScreen = latest.isIntersecting;
      sync();
    });
    observer.observe(target);
    document.addEventListener('visibilitychange', sync);
    sync();

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [targetRef, isEnabled]);

  return elapsedMs;
}
