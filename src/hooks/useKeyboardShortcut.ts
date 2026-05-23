/**
 * useKeyboardShortcut — Global keyboard shortcut registration hook.
 *
 * Listens for keydown events and fires the callback when the specified
 * key combination matches. Supports modifier keys (ctrl, alt, shift, meta/cmd).
 * Automatically cleans up on unmount.
 *
 * Ignores shortcuts when focus is in an input, textarea, or contenteditable
 * (unless `captureInInputs` is set to true).
 *
 * Usage:
 *   // Simple key
 *   useKeyboardShortcut("Escape", () => closeModal());
 *
 *   // With modifiers
 *   useKeyboardShortcut("s", () => save(), { ctrl: true });
 *   useKeyboardShortcut("k", () => openPalette(), { ctrl: true });
 *
 *   // Meta (Cmd on Mac, Win on Windows)
 *   useKeyboardShortcut("p", () => print(), { meta: true });
 *
 *   // Capture even inside inputs
 *   useKeyboardShortcut("F2", () => focusSearch(), { captureInInputs: true });
 *
 * Returns:
 *   Nothing — purely side-effect hook.
 *
 * Also exports useKeyboardShortcuts (plural) for registering multiple
 * shortcuts at once from a map.
 */
import { useEffect, useRef } from "react";

interface ShortcutOptions {
  /** Require Ctrl key (Cmd on Mac) */
  ctrl?: boolean;
  /** Require Alt / Option key */
  alt?: boolean;
  /** Require Shift key */
  shift?: boolean;
  /** Require Meta key (Win / Cmd) */
  meta?: boolean;
  /** Fire even when focus is inside an input/textarea */
  captureInInputs?: boolean;
  /** Whether to call event.preventDefault() */
  preventDefault?: boolean;
  /** Whether to call event.stopPropagation() */
  stopPropagation?: boolean;
  /** Disabled when false (default: true) */
  enabled?: boolean;
}

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isInInput(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return INPUT_TAGS.has(el.tagName) || el.isContentEditable;
}

export function useKeyboardShortcut(
  key: string,
  callback: (e: KeyboardEvent) => void,
  options: ShortcutOptions = {}
): void {
  const {
    ctrl = false,
    alt = false,
    shift = false,
    meta = false,
    captureInInputs = false,
    preventDefault = true,
    stopPropagation = false,
    enabled = true,
  } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (!captureInInputs && isInInput(e)) return;

      const keyMatch = e.key.toLowerCase() === key.toLowerCase() ||
                       e.code.toLowerCase() === key.toLowerCase();
      if (!keyMatch) return;
      if (ctrl  && !(e.ctrlKey  || e.metaKey)) return;
      if (alt   && !e.altKey)   return;
      if (shift && !e.shiftKey) return;
      if (meta  && !e.metaKey)  return;

      if (preventDefault) e.preventDefault();
      if (stopPropagation) e.stopPropagation();
      callbackRef.current(e);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [key, ctrl, alt, shift, meta, captureInInputs, preventDefault, stopPropagation, enabled]);
}

/**
 * Register multiple shortcuts at once.
 * @param shortcuts Map of "key+modifiers" → callback, e.g. { "ctrl+s": save, "Escape": close }
 */
export function useKeyboardShortcuts(
  shortcuts: Record<string, (e: KeyboardEvent) => void>,
  options: Omit<ShortcutOptions, "ctrl" | "alt" | "shift" | "meta"> = {}
): void {
  const { captureInInputs = false, preventDefault = true, stopPropagation = false, enabled = true } = options;
  const callbacksRef = useRef(shortcuts);
  callbacksRef.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (!captureInInputs && isInInput(e)) return;

      for (const [combo, cb] of Object.entries(callbacksRef.current)) {
        const parts = combo.toLowerCase().split("+");
        const key = parts[parts.length - 1];
        const needCtrl  = parts.includes("ctrl")  || parts.includes("cmd");
        const needAlt   = parts.includes("alt");
        const needShift = parts.includes("shift");
        const needMeta  = parts.includes("meta");

        const keyMatch = e.key.toLowerCase() === key || e.code.toLowerCase() === key;
        if (!keyMatch) continue;
        if (needCtrl  && !(e.ctrlKey || e.metaKey)) continue;
        if (needAlt   && !e.altKey)   continue;
        if (needShift && !e.shiftKey) continue;
        if (needMeta  && !e.metaKey)  continue;

        if (preventDefault) e.preventDefault();
        if (stopPropagation) e.stopPropagation();
        cb(e);
        break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [captureInInputs, preventDefault, stopPropagation, enabled]);
}
