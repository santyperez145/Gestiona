/**
 * useLazyImage — Intersection Observer based lazy image loading.
 *
 * Returns a ref to attach to an <img> or container element.
 * The `loaded` boolean becomes true once the element enters the viewport.
 *
 * Usage:
 *   const { ref, loaded } = useLazyImage();
 *   <div ref={ref}>
 *     <img src={loaded ? realSrc : undefined} style={{ opacity: loaded ? 1 : 0 }} />
 *   </div>
 */
import { useEffect, useRef, useState } from "react";

interface UseLazyImageOptions {
  /** Root margin for the Intersection Observer. Default "200px" (pre-load before in view) */
  rootMargin?: string;
  /** Intersection threshold. Default 0 */
  threshold?: number;
}

export function useLazyImage(options: UseLazyImageOptions = {}) {
  const { rootMargin = "200px", threshold = 0 } = options;
  const ref = useRef<HTMLElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ref.current || loaded) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [rootMargin, threshold, loaded]);

  return { ref, loaded };
}

/**
 * LazyImage component — drop-in replacement for <img> with lazy loading.
 * Renders a skeleton placeholder until in view, then fades in the real image.
 */
export function createLazyImageProps(src: string | undefined, alt: string) {
  return {
    src,
    alt,
    loading: "lazy" as const,
    decoding: "async" as const,
    style: { transition: "opacity 0.3s" },
  };
}
