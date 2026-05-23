/**
 * useScrollPosition — Tracks scroll position of the window or a custom element.
 *
 * Returns current scroll x/y, direction, whether the user is at the top/bottom,
 * and a scroll-to-top helper. Uses passive event listeners and rAF throttling.
 *
 * Usage:
 *   const { y, direction, isAtTop, scrollToTop } = useScrollPosition();
 *   {!isAtTop && <BackToTopButton onClick={scrollToTop} />}
 *
 *   // Observe a specific scrollable element:
 *   const { y } = useScrollPosition({ element: someRef });
 */
import { useState, useEffect, useCallback, useRef } from "react";

interface ScrollState {
  x: number;
  y: number;
  /** 'up' | 'down' | 'left' | 'right' | 'none' */
  direction: "up" | "down" | "left" | "right" | "none";
  isAtTop: boolean;
  isAtBottom: boolean;
  /** Scroll percentage 0–100 */
  percentY: number;
}

interface UseScrollPositionOptions {
  /** Custom scrollable element (default: window) */
  element?: React.RefObject<Element | null>;
  /** Throttle scroll events via rAF (default: true) */
  useRAF?: boolean;
}

export function useScrollPosition({
  element,
  useRAF = true,
}: UseScrollPositionOptions = {}): ScrollState & { scrollToTop: (smooth?: boolean) => void } {
  const getState = useCallback((): ScrollState => {
    const el = element?.current;
    const x = el ? el.scrollLeft : window.scrollX ?? window.pageXOffset;
    const y = el ? el.scrollTop  : window.scrollY ?? window.pageYOffset;
    const maxY = el
      ? el.scrollHeight - el.clientHeight
      : document.body.scrollHeight - window.innerHeight;
    const percentY = maxY > 0 ? Math.min(100, Math.round((y / maxY) * 100)) : 0;
    return { x, y, direction: "none", isAtTop: y <= 0, isAtBottom: y >= maxY - 2, percentY };
  }, [element]);

  const [state, setState] = useState<ScrollState>(getState);
  const prevYRef = useRef(state.y);
  const prevXRef = useRef(state.x);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const target = element?.current ?? window;

    const handleScroll = () => {
      if (useRAF) {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setState(prev => {
            const next = getState();
            const dy = next.y - prevYRef.current;
            const dx = next.x - prevXRef.current;
            let dir: ScrollState["direction"] = "none";
            if (Math.abs(dy) >= Math.abs(dx)) {
              if (dy > 2) dir = "down";
              else if (dy < -2) dir = "up";
            } else {
              if (dx > 2) dir = "right";
              else if (dx < -2) dir = "left";
            }
            prevYRef.current = next.y;
            prevXRef.current = next.x;
            return { ...next, direction: dir };
          });
        });
      } else {
        setState(getState);
      }
    };

    target.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [element, useRAF, getState]);

  const scrollToTop = useCallback((smooth = true) => {
    const el = element?.current;
    if (el) {
      el.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    } else {
      window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    }
  }, [element]);

  return { ...state, scrollToTop };
}
