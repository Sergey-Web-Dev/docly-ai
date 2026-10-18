'use client';

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { CHAT_PREVIEW_SCENARIOS, msUntilNextChange } from '@/lib/chat-preview';

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
 * Elapsed animation time in ms, or null until the clock has started. It only advances while the target element is
 * on screen and the tab is visible, and never under `prefers-reduced-motion`. Instead of polling, one timeout sleeps
 * until the next visible change (see msUntilNextChange). Every timer and observer is cleaned up.
 */
export function usePreviewClock(targetRef: RefObject<HTMLElement | null>, isEnabled: boolean): number | null {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!isEnabled || !target) return;

    let isOnScreen = true;
    let timerId = 0;
    let lastTick = 0;
    let elapsed = 0;

    const schedule = (): void => {
      timerId = window.setTimeout(tick, msUntilNextChange(CHAT_PREVIEW_SCENARIOS, elapsed));
    };
    function tick(): void {
      const now = performance.now();
      elapsed += now - lastTick;
      lastTick = now;
      setElapsedMs(elapsed);
      schedule();
    }
    const stop = (): void => {
      window.clearTimeout(timerId);
      timerId = 0;
    };
    const sync = (): void => {
      const shouldRun = isOnScreen && !document.hidden;
      if (shouldRun && timerId === 0) {
        lastTick = performance.now();
        setElapsedMs(elapsed);
        schedule();
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
