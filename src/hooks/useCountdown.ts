/**
 * useCountdown — Countdown timer hook.
 *
 * Counts down from a target Date (or seconds from now) to zero.
 * Useful for flash-sale timers, session expiry warnings, offer countdowns.
 *
 * Usage:
 *   // From a target date
 *   const { days, hours, minutes, seconds, isExpired, reset } =
 *     useCountdown(new Date("2026-12-31"));
 *
 *   // From seconds from now
 *   const { minutes, seconds } = useCountdown(300); // 5-minute countdown
 *
 *   // Display
 *   <span>{String(minutes).padStart(2,'0')}:{String(seconds).padStart(2,'0')}</span>
 */
import { useState, useEffect, useCallback, useRef } from "react";

interface CountdownResult {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number; // total ms remaining
  isExpired: boolean;
  /** Restart countdown from the original target */
  reset: () => void;
}

function getRemaining(target: Date): number {
  return Math.max(0, target.getTime() - Date.now());
}

function msToComponents(ms: number) {
  const total = Math.floor(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours   = Math.floor(total / 3600) % 24;
  const days    = Math.floor(total / 86400);
  return { days, hours, minutes, seconds, total: ms };
}

export function useCountdown(targetOrSeconds: Date | number): CountdownResult {
  const targetDate = useRef<Date>(
    targetOrSeconds instanceof Date
      ? targetOrSeconds
      : new Date(Date.now() + (targetOrSeconds as number) * 1000)
  );

  const [remaining, setRemaining] = useState(() => getRemaining(targetDate.current));

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      const r = getRemaining(targetDate.current);
      setRemaining(r);
      if (r === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetDate.current.getTime()]);

  const reset = useCallback(() => {
    if (!(targetOrSeconds instanceof Date)) {
      targetDate.current = new Date(Date.now() + (targetOrSeconds as number) * 1000);
    }
    setRemaining(getRemaining(targetDate.current));
  }, [targetOrSeconds]);

  return {
    ...msToComponents(remaining),
    isExpired: remaining <= 0,
    reset,
  };
}
