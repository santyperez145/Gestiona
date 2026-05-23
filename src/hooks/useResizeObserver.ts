/**
 * useResizeObserver — Track element dimensions reactively.
 *
 * Uses the ResizeObserver API to fire on every size change.
 * Gracefully falls back when ResizeObserver is unavailable.
 *
 * Usage:
 *   const { ref, width, height, contentRect } = useResizeObserver<HTMLDivElement>();
 *   <div ref={ref} />
 *   // width and height update on every resize
 *
 * With external ref:
 *   const divRef = useRef<HTMLDivElement>(null);
 *   const { width } = useResizeObserver({ ref: divRef });
 */
import { useRef, useState, useEffect, useCallback, RefObject } from "react";

interface Size {
  width: number | undefined;
  height: number | undefined;
  contentRect: DOMRectReadOnly | undefined;
}

interface UseResizeObserverOptions<T extends Element> {
  ref?: RefObject<T>;
  /** Callback fired on each resize */
  onResize?: (entry: ResizeObserverEntry) => void;
}

interface UseResizeObserverReturn<T extends Element> extends Size {
  ref: RefObject<T>;
}

export function useResizeObserver<T extends Element>(
  options: UseResizeObserverOptions<T> = {}
): UseResizeObserverReturn<T> {
  const { onResize } = options;
  const internalRef = useRef<T>(null);
  const ref = options.ref ?? internalRef;

  const [size, setSize] = useState<Size>({
    width: undefined,
    height: undefined,
    contentRect: undefined,
  });

  const handleResize = useCallback(
    (entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height, contentRect: entry.contentRect });
        onResize?.(entry);
      }
    },
    [onResize]
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(handleResize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, handleResize]);

  return { ref: ref as RefObject<T>, ...size };
}
