/**
 * useThrottle — Returns a throttled version of the input value.
 *
 * The returned value only updates at most once every `limitMs` milliseconds,
 * regardless of how rapidly the input changes. The last value is always
 * delivered after the throttle window expires (trailing edge).
 *
 * Difference from debounce:
 *   - Debounce: fires AFTER input stops changing for N ms
 *   - Throttle: fires AT MOST once every N ms (immediate leading + trailing)
 *
 * Usage:
 *   const [input, setInput] = useState("");
 *   const throttled = useThrottle(input, 300);
 *   // throttled updates at most every 300ms even if input updates every keystroke
 *
 * Also exports useThrottleFn for throttling callback functions.
 */
import { useState, useEffect, useCallback, useRef } from "react";

export function useThrottle<T>(value: T, limitMs: number): T {
  const [throttled, setThrottled] = useState<T>(value);
  const lastRunRef = useRef<number>(0);
  const trailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastRunRef.current;

    if (elapsed >= limitMs) {
      if (trailingRef.current) {
        clearTimeout(trailingRef.current);
        trailingRef.current = null;
      }
      lastRunRef.current = now;
      setThrottled(value);
    } else {
      if (trailingRef.current) clearTimeout(trailingRef.current);
      trailingRef.current = setTimeout(() => {
        lastRunRef.current = Date.now();
        setThrottled(value);
      }, limitMs - elapsed);
    }

    return () => {
      if (trailingRef.current) clearTimeout(trailingRef.current);
    };
  }, [value, limitMs]);

  return throttled;
}

/**
 * useThrottleFn — Returns a throttled version of a callback.
 * The function fires immediately on the first call, then at most once per limitMs.
 */
export function useThrottleFn<T extends (...args: any[]) => any>(
  fn: T,
  limitMs: number
): T {
  const lastRunRef = useRef<number>(0);
  const trailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);

  fnRef.current = fn;

  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    const elapsed = now - lastRunRef.current;

    if (elapsed >= limitMs) {
      if (trailingRef.current) { clearTimeout(trailingRef.current); trailingRef.current = null; }
      lastRunRef.current = now;
      return fnRef.current(...args);
    } else {
      if (trailingRef.current) clearTimeout(trailingRef.current);
      trailingRef.current = setTimeout(() => {
        lastRunRef.current = Date.now();
        fnRef.current(...args);
      }, limitMs - elapsed);
    }
  }, [limitMs]) as T;
}
