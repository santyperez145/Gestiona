/**
 * useWindowSize — Reactive window dimensions hook.
 *
 * Tracks window.innerWidth and window.innerHeight and updates on resize.
 * Throttled to 100ms to avoid excessive re-renders.
 *
 * Also exposes:
 *   - aspectRatio: width / height
 *   - isPortrait / isLandscape
 *   - orientation: "portrait" | "landscape"
 *   - scrollbarWidth: approximate scrollbar width (for modal positioning)
 *
 * SSR-safe: returns sensible defaults when window is unavailable.
 *
 * Usage:
 *   const { width, height, isPortrait } = useWindowSize();
 *   <canvas width={width} height={height} />
 */
import { useState, useEffect, useCallback } from "react";

export interface WindowSize {
  width: number;
  height: number;
  aspectRatio: number;
  isPortrait: boolean;
  isLandscape: boolean;
  orientation: "portrait" | "landscape";
  /** Approximate scrollbar width in pixels (0 on mobile) */
  scrollbarWidth: number;
}

function getSize(): WindowSize {
  if (typeof window === "undefined") {
    return {
      width: 1280,
      height: 800,
      aspectRatio: 1.6,
      isPortrait: false,
      isLandscape: true,
      orientation: "landscape",
      scrollbarWidth: 0,
    };
  }

  const w = window.innerWidth;
  const h = window.innerHeight;
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

  return {
    width: w,
    height: h,
    aspectRatio: h > 0 ? w / h : 1,
    isPortrait: h > w,
    isLandscape: w >= h,
    orientation: h > w ? "portrait" : "landscape",
    scrollbarWidth,
  };
}

export function useWindowSize(): WindowSize {
  const [size, setSize] = useState<WindowSize>(getSize);

  const handleResize = useCallback(() => {
    setSize(getSize());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Throttle with requestAnimationFrame for performance
    let rafId: number;
    const rafResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(handleResize);
    };

    window.addEventListener("resize", rafResize, { passive: true });
    window.addEventListener("orientationchange", rafResize, { passive: true });

    return () => {
      window.removeEventListener("resize", rafResize);
      window.removeEventListener("orientationchange", rafResize);
      cancelAnimationFrame(rafId);
    };
  }, [handleResize]);

  return size;
}
