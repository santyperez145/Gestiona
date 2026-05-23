/**
 * useMediaQuery — Reactive CSS media query hook using matchMedia API.
 *
 * Returns true when the given CSS media query matches the current viewport,
 * and updates automatically on resize / orientation change.
 *
 * Pre-built breakpoint helpers:
 *   useIsMobile()  → max-width: 767px
 *   useIsTablet()  → 768px – 1023px
 *   useIsDesktop() → min-width: 1024px
 *   useIsLarge()   → min-width: 1280px
 *   usePrefersDark() → prefers-color-scheme: dark
 *   useReducedMotion() → prefers-reduced-motion: reduce
 *
 * Custom query:
 *   const isTall = useMediaQuery("(min-height: 800px)");
 *
 * SSR-safe: returns `false` (or the provided `defaultValue`) during hydration
 * when `window.matchMedia` is unavailable.
 */
import { useState, useEffect, useCallback } from "react";

export function useMediaQuery(query: string, defaultValue = false): boolean {
  const getMatch = useCallback((): boolean => {
    if (typeof window === "undefined" || !window.matchMedia) return defaultValue;
    return window.matchMedia(query).matches;
  }, [query, defaultValue]);

  const [matches, setMatches] = useState<boolean>(getMatch);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);

    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Use addEventListener if supported (modern), fall back to addListener
    if (mq.addEventListener) {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      // Safari < 14 fallback
      mq.addListener(handler);
      return () => mq.removeListener(handler);
    }
  }, [query]);

  return matches;
}

// ── Pre-built helpers ─────────────────────────────────────────────────────────

/** True when viewport width ≤ 767px (phones) */
export const useIsMobile = () => useMediaQuery("(max-width: 767px)");

/** True when viewport width is between 768px and 1023px (tablets) */
export const useIsTablet = () =>
  useMediaQuery("(min-width: 768px) and (max-width: 1023px)");

/** True when viewport width ≥ 1024px (laptops/desktops) */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

/** True when viewport width ≥ 1280px (large screens) */
export const useIsLarge = () => useMediaQuery("(min-width: 1280px)");

/** True when viewport width ≥ 1536px (XL screens) */
export const useIsXL = () => useMediaQuery("(min-width: 1536px)");

/** True when OS / browser prefers dark color scheme */
export const usePrefersDark = () =>
  useMediaQuery("(prefers-color-scheme: dark)");

/** True when user has requested reduced motion */
export const useReducedMotion = () =>
  useMediaQuery("(prefers-reduced-motion: reduce)");

/** True when device has a coarse pointer (touch screen) */
export const useIsTouchDevice = () => useMediaQuery("(pointer: coarse)");

/** True when device can hover (mouse / trackpad) */
export const useCanHover = () => useMediaQuery("(hover: hover)");

/**
 * Returns the current Tailwind-like breakpoint name.
 * "sm" | "md" | "lg" | "xl" | "2xl"
 */
export function useBreakpoint(): "sm" | "md" | "lg" | "xl" | "2xl" {
  const is2xl = useMediaQuery("(min-width: 1536px)");
  const isXl  = useMediaQuery("(min-width: 1280px)");
  const isLg  = useMediaQuery("(min-width: 1024px)");
  const isMd  = useMediaQuery("(min-width: 768px)");
  if (is2xl) return "2xl";
  if (isXl)  return "xl";
  if (isLg)  return "lg";
  if (isMd)  return "md";
  return "sm";
}
