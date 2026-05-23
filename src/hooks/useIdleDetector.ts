/**
 * useIdleDetector — Detects user inactivity and fires a callback.
 *
 * Listens to mousemove, mousedown, keydown, touchstart, scroll, and
 * visibilitychange events to reset the idle timer. When no activity is
 * detected for `idleMs` milliseconds the `onIdle` callback fires.
 * When the user comes back, `onActive` fires.
 *
 * Uses the Page Visibility API to also detect tab switches.
 *
 * Usage:
 *   useIdleDetector({
 *     idleMs: 5 * 60 * 1000,   // 5 minutes
 *     onIdle: () => lockSession(),
 *     onActive: () => unlockSession(),
 *   });
 *
 * Returns:
 *   { isIdle, idleFor, reset }
 *   - isIdle: boolean — currently idle
 *   - idleFor: number — milliseconds idle (0 when active)
 *   - reset: () => void — manually reset the idle timer
 */
import { useState, useEffect, useCallback, useRef } from "react";

interface UseIdleDetectorOptions {
  /** Milliseconds of inactivity before firing onIdle (default: 5 min) */
  idleMs?: number;
  /** Fired once when user goes idle */
  onIdle?: () => void;
  /** Fired once when user returns from idle */
  onActive?: () => void;
  /** Whether the detector is active (default: true) */
  enabled?: boolean;
}

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
] as const;

export function useIdleDetector({
  idleMs = 5 * 60 * 1000,
  onIdle,
  onActive,
  enabled = true,
}: UseIdleDetectorOptions = {}) {
  const [isIdle, setIsIdle] = useState(false);
  const [idleFor, setIdleFor] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleSinceRef = useRef<number | null>(null);
  const isIdleRef = useRef(false);
  const onIdleRef = useRef(onIdle);
  const onActiveRef = useRef(onActive);

  // Keep refs up-to-date without re-registering listeners
  onIdleRef.current = onIdle;
  onActiveRef.current = onActive;

  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (idleSinceRef.current !== null) {
        setIdleFor(Date.now() - idleSinceRef.current);
      }
    }, 1000);
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setIdleFor(0);
  }, []);

  const goIdle = useCallback(() => {
    if (isIdleRef.current) return;
    isIdleRef.current = true;
    idleSinceRef.current = Date.now();
    setIsIdle(true);
    startTick();
    onIdleRef.current?.();
  }, [startTick]);

  const goActive = useCallback(() => {
    if (!isIdleRef.current) return;
    isIdleRef.current = false;
    idleSinceRef.current = null;
    setIsIdle(false);
    stopTick();
    onActiveRef.current?.();
  }, [stopTick]);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    goActive();
    timerRef.current = setTimeout(goIdle, idleMs);
  }, [idleMs, goActive, goIdle]);

  useEffect(() => {
    if (!enabled) return;

    const handleActivity = () => reset();

    const handleVisibility = () => {
      if (document.hidden) {
        // Tab hidden — count as idle immediately
        if (timerRef.current) clearTimeout(timerRef.current);
        goIdle();
      } else {
        reset();
      }
    };

    ACTIVITY_EVENTS.forEach(evt =>
      window.addEventListener(evt, handleActivity, { passive: true })
    );
    document.addEventListener("visibilitychange", handleVisibility);

    // Kick off the initial timer
    timerRef.current = setTimeout(goIdle, idleMs);

    return () => {
      ACTIVITY_EVENTS.forEach(evt =>
        window.removeEventListener(evt, handleActivity)
      );
      document.removeEventListener("visibilitychange", handleVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
      stopTick();
    };
  }, [enabled, idleMs, reset, goIdle, stopTick]);

  return { isIdle, idleFor, reset };
}
