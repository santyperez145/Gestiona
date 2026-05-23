/**
 * useEventListener — Type-safe DOM event listener hook.
 *
 * Attaches an event listener to window, document, or any DOM element ref.
 * Automatically removes the listener on unmount and updates when the handler
 * changes (via ref) so the listener never goes stale.
 *
 * Usage:
 *   // Window events
 *   useEventListener("resize", () => recalcLayout());
 *   useEventListener("keydown", handleKey, window);
 *
 *   // Element events via ref
 *   const btnRef = useRef<HTMLButtonElement>(null);
 *   useEventListener("click", handleClick, btnRef);
 *
 *   // Document events
 *   useEventListener("visibilitychange", handleVisibility, document);
 *
 *   // With options
 *   useEventListener("scroll", handleScroll, window, { passive: true });
 *   useEventListener("touchmove", prevent, ref, { passive: false });
 */
import { useEffect, useRef } from "react";

type EventTarget = Window | Document | HTMLElement | Element | null | undefined;
type RefObject<T> = { readonly current: T | null };

// Overload: ref object
export function useEventListener<K extends keyof HTMLElementEventMap>(
  type: K,
  listener: (e: HTMLElementEventMap[K]) => void,
  element: RefObject<HTMLElement | null>,
  options?: boolean | AddEventListenerOptions
): void;

// Overload: window
export function useEventListener<K extends keyof WindowEventMap>(
  type: K,
  listener: (e: WindowEventMap[K]) => void,
  element?: Window,
  options?: boolean | AddEventListenerOptions
): void;

// Overload: document
export function useEventListener<K extends keyof DocumentEventMap>(
  type: K,
  listener: (e: DocumentEventMap[K]) => void,
  element: Document,
  options?: boolean | AddEventListenerOptions
): void;

// Implementation
export function useEventListener(
  type: string,
  listener: (e: Event) => void,
  element: EventTarget | RefObject<EventTarget> = window,
  options?: boolean | AddEventListenerOptions
): void {
  const savedListener = useRef(listener);

  useEffect(() => {
    savedListener.current = listener;
  }, [listener]);

  useEffect(() => {
    const target = element && "current" in element ? element.current : element;
    if (!target || !target.addEventListener) return;

    const handler = (e: Event) => savedListener.current(e);

    target.addEventListener(type, handler, options);
    return () => target.removeEventListener(type, handler, options);
  }, [type, element, options]);
}
