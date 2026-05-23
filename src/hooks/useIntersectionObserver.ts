/**
 * useIntersectionObserver — Reactive IntersectionObserver hook.
 *
 * Observes a DOM element and reports whether it is currently visible in the
 * viewport (or a custom root). Uses the IntersectionObserver API.
 *
 * Common use cases:
 *   - Infinite scroll / load-more triggers
 *   - Lazy-load images or components
 *   - Animate elements when they enter the viewport
 *   - Track ad/banner impressions
 *
 * Usage:
 *   const { ref, entry, isIntersecting } = useIntersectionObserver({ threshold: 0.1 });
 *   <div ref={ref}>{isIntersecting ? <HeavyComponent /> : null}</div>
 *
 * Infinite scroll example:
 *   const { ref } = useIntersectionObserver({
 *     threshold: 0,
 *     onChange: (entry) => { if (entry.isIntersecting) loadMore(); },
 *   });
 *   <div ref={ref} />  // sentinel element at the bottom of the list
 */
import { useState, useEffect, useRef, useCallback } from "react";

interface UseIntersectionObserverOptions {
  /** Root element for intersection (default: viewport) */
  root?: Element | null;
  /** Margin around root. Same as CSS margin (default: "0px") */
  rootMargin?: string;
  /** Intersection threshold (0–1 or array). Default: 0 */
  threshold?: number | number[];
  /** Callback on every intersection change */
  onChange?: (entry: IntersectionObserverEntry) => void;
  /** Only trigger once (stops observing after first intersection) */
  triggerOnce?: boolean;
  /** Freeze observations — useful when component is unmounting */
  freeze?: boolean;
}

interface UseIntersectionObserverReturn {
  /** Attach to the element you want to observe */
  ref: (node: Element | null) => void;
  /** Latest IntersectionObserverEntry (null until first observation) */
  entry: IntersectionObserverEntry | null;
  /** True when the element is currently intersecting */
  isIntersecting: boolean;
  /** Manually stop observing */
  disconnect: () => void;
}

export function useIntersectionObserver({
  root = null,
  rootMargin = "0px",
  threshold = 0,
  onChange,
  triggerOnce = false,
  freeze = false,
}: UseIntersectionObserverOptions = {}): UseIntersectionObserverReturn {
  const [entry, setEntry] = useState<IntersectionObserverEntry | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementRef = useRef<Element | null>(null);
  const onChangeRef = useRef(onChange);
  const hasTriggeredRef = useRef(false);

  onChangeRef.current = onChange;

  const disconnect = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  const ref = useCallback((node: Element | null) => {
    // Clean up previous observer
    disconnect();
    elementRef.current = node;

    if (!node || freeze) return;
    if (triggerOnce && hasTriggeredRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        setEntry(e);
        onChangeRef.current?.(e);
        if (triggerOnce && e.isIntersecting) {
          hasTriggeredRef.current = true;
          disconnect();
        }
      },
      { root, rootMargin, threshold }
    );

    observerRef.current.observe(node);
  }, [root, rootMargin, threshold, triggerOnce, freeze, disconnect]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return {
    ref,
    entry,
    isIntersecting: entry?.isIntersecting ?? false,
    disconnect,
  };
}
