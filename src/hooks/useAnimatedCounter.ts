/**
 * useAnimatedCounter — Smooth number animation for KPI displays.
 *
 * Animates a number from its previous value to a new target using
 * requestAnimationFrame and an easing curve. Great for revenue counters,
 * stock counts, KPI cards that update in real-time.
 *
 * Features:
 *   - Easing functions: linear, easeOut, easeInOut, spring
 *   - Configurable duration (default 600ms)
 *   - Handles rapid value changes gracefully (cancels in-flight animation)
 *   - Returns the formatted string via optional formatter
 *
 * Usage:
 *   const revenue = useAnimatedCounter(todayRevenue, { duration: 800, easing: "easeOut" });
 *   <span>{revenue.toLocaleString("es-AR")}</span>
 *
 *   // With formatter:
 *   const revenue = useAnimatedCounter(totalARS, {
 *     duration: 600,
 *     format: v => `$${Math.round(v).toLocaleString("es-AR")}`,
 *   });
 *   <span>{revenue}</span>  // Already formatted string
 */
import { useState, useEffect, useRef } from "react";

type EasingFn = "linear" | "easeOut" | "easeInOut" | "spring";

interface UseAnimatedCounterOptions {
  /** Animation duration in ms. Default: 600 */
  duration?: number;
  /** Easing function. Default: "easeOut" */
  easing?: EasingFn;
  /** Optional formatter — when provided, returns string; otherwise returns number */
  format?: (value: number) => string;
  /** Skip animation on first render. Default: false */
  skipInitial?: boolean;
}

const easings: Record<EasingFn, (t: number) => number> = {
  linear: t => t,
  easeOut: t => 1 - Math.pow(1 - t, 3),
  easeInOut: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  spring: t => {
    const c4 = (2 * Math.PI) / 3;
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

export function useAnimatedCounter(
  target: number,
  options: UseAnimatedCounterOptions = {}
): number | string {
  const { duration = 600, easing = "easeOut", format, skipInitial = false } = options;
  const [current, setCurrent] = useState(skipInitial ? target : 0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef<number>(0);
  const isFirstRef = useRef(true);

  useEffect(() => {
    if (isFirstRef.current && skipInitial) {
      isFirstRef.current = false;
      fromRef.current = target;
      setCurrent(target);
      return;
    }
    isFirstRef.current = false;

    const from = fromRef.current;
    const diff = target - from;
    if (diff === 0) return;

    const easeFn = easings[easing];
    startRef.current = null;

    const step = (timestamp: number) => {
      if (!startRef.current) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeFn(t);
      const value = from + diff * eased;
      setCurrent(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
        setCurrent(target);
      }
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, easing, skipInitial]);

  if (format) return format(current as number);
  return current;
}
