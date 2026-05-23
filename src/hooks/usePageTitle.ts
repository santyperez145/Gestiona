/**
 * usePageTitle — Dynamically update document.title.
 *
 * Sets the page title on mount and on every change. Restores the original
 * title on unmount (optional, default: true).
 *
 * Usage:
 *   usePageTitle("Dashboard");
 *   usePageTitle(`${productName} — Productos`, { suffix: " | Gestiona", restore: false });
 *
 * @param title  Title to set
 * @param opts   { suffix: appended to title; restore: bool — restore on unmount }
 */
import { useEffect, useRef } from "react";

interface Options {
  /** String appended to every title, e.g. " | Gestiona" */
  suffix?: string;
  /** Restore original title on unmount. Default: true */
  restore?: boolean;
}

export function usePageTitle(title: string, opts: Options = {}): void {
  const { suffix = " | Gestiona", restore = true } = opts;
  const prevTitle = useRef(document.title);

  useEffect(() => {
    if (restore) prevTitle.current = document.title;
    document.title = title + suffix;
    return () => {
      if (restore) document.title = prevTitle.current;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, suffix]);
}
