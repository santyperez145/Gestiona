/**
 * useLocalStorage — Typed, expiry-aware localStorage hook.
 *
 * Drop-in replacement for useState that persists value in localStorage.
 * Supports optional TTL (time-to-live) so stale data self-expires.
 *
 * Usage:
 *   const [theme, setTheme] = useLocalStorage("theme", "dark");
 *   const [token, setToken] = useLocalStorage("api_token", null, { ttlMs: 3600000 }); // 1hr TTL
 *
 * Notes:
 *   - JSON-serialized, so any JSON-compatible value works (string, number, object, array)
 *   - Fallback to initialValue if parse fails or TTL expired
 *   - Cross-tab: reads latest value on render (no realtime sync, use useBroadcastChannel for that)
 *   - `remove()` deletes the key entirely
 */
import { useState, useCallback } from "react";

interface Options {
  /** Milliseconds until the stored value expires. Defaults to no expiry. */
  ttlMs?: number;
}

type SetValue<T> = (value: T | ((prev: T) => T)) => void;

interface StoredWrapper<T> {
  v: T;
  exp?: number; // expiry timestamp (ms since epoch)
}

function read<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return initial;
    const wrapper: StoredWrapper<T> = JSON.parse(raw);
    if (wrapper.exp && Date.now() > wrapper.exp) {
      localStorage.removeItem(key);
      return initial;
    }
    return wrapper.v;
  } catch {
    return initial;
  }
}

function write<T>(key: string, value: T, ttlMs?: number) {
  try {
    const wrapper: StoredWrapper<T> = { v: value };
    if (ttlMs) wrapper.exp = Date.now() + ttlMs;
    localStorage.setItem(key, JSON.stringify(wrapper));
  } catch { /* quota exceeded or private mode */ }
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options?: Options
): [T, SetValue<T>, () => void] {
  const [storedValue, setStoredValue] = useState<T>(() => read<T>(key, initialValue));

  const setValue: SetValue<T> = useCallback((value) => {
    setStoredValue(prev => {
      const next = typeof value === "function" ? (value as (p: T) => T)(prev) : value;
      write(key, next, options?.ttlMs);
      return next;
    });
  }, [key, options?.ttlMs]);

  const remove = useCallback(() => {
    localStorage.removeItem(key);
    setStoredValue(initialValue);
  }, [key, initialValue]);

  return [storedValue, setValue, remove];
}
