/**
 * useWakeLock — Screen Wake Lock API hook.
 *
 * Prevents the screen from dimming or locking while the hook is active.
 * Ideal for POS mode, cashier display, or presentation views where the
 * operator must not have the screen go dark mid-transaction.
 *
 * Browser support: Chrome 84+, Edge 84+, Opera 70+, Samsung Internet 14.
 * Safari and Firefox: falls back silently (no-op).
 *
 * Features:
 *   - Auto-reacquire lock after tab visibility change (browser releases it)
 *   - Manual acquire/release
 *   - Reactive `active` state for UI feedback
 *   - Cleanup on unmount
 *
 * Usage:
 *   const { active, supported, acquire, release } = useWakeLock({ active: isPOSMode });
 *
 *   // Auto-acquire on mount, release on unmount:
 *   useWakeLock({ active: true });
 *
 *   // Conditional — enable only when fullscreen
 *   useWakeLock({ active: isFullscreen });
 */
import { useState, useEffect, useRef, useCallback } from "react";

interface UseWakeLockOptions {
  /** Whether to auto-acquire on mount and auto-release on unmount. Default: false */
  active?: boolean;
}

interface UseWakeLockReturn {
  /** Whether the wake lock is currently held */
  active: boolean;
  /** Whether the Wake Lock API is available in this browser */
  supported: boolean;
  /** Manually acquire the wake lock */
  acquire: () => Promise<void>;
  /** Manually release the wake lock */
  release: () => Promise<void>;
}

const supported =
  typeof navigator !== "undefined" && "wakeLock" in navigator;

export function useWakeLock(options: UseWakeLockOptions = {}): UseWakeLockReturn {
  const { active: shouldBeActive = false } = options;
  const [isActive, setIsActive] = useState(false);
  const lockRef = useRef<WakeLockSentinel | null>(null);

  const acquire = useCallback(async () => {
    if (!supported) return;
    try {
      lockRef.current = await (navigator as any).wakeLock.request("screen");
      setIsActive(true);

      lockRef.current.addEventListener("release", () => {
        setIsActive(false);
        lockRef.current = null;
      });
    } catch {
      // Permission denied or not supported — ignore
    }
  }, []);

  const release = useCallback(async () => {
    if (lockRef.current) {
      await lockRef.current.release().catch(() => {});
      lockRef.current = null;
      setIsActive(false);
    }
  }, []);

  // Auto acquire/release based on `active` option
  useEffect(() => {
    if (shouldBeActive) {
      acquire();
    } else {
      release();
    }
    return () => { release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldBeActive]);

  // Re-acquire after tab becomes visible (browser releases wake lock on hide)
  useEffect(() => {
    if (!supported || !shouldBeActive) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !lockRef.current) {
        acquire();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [shouldBeActive, acquire]);

  return {
    active: isActive,
    supported,
    acquire,
    release,
  };
}
