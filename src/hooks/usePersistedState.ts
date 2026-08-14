import { useCallback, useEffect, useRef, useState } from "react";

type SetPersistedValue<T> = (value: T | ((previous: T) => T)) => void;

export function readPersistedValue<T>(key: string, initialValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? initialValue : JSON.parse(raw) as T;
  } catch {
    return initialValue;
  }
}

export function writePersistedValue<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full quota should not block the workspace.
  }
}

/**
 * Persists view state that should survive route changes and browser tabs.
 * The caller owns the scope in the key, normally including the active org id.
 */
export function usePersistedState<T>(key: string, initialValue: T): [T, SetPersistedValue<T>, () => void] {
  const initialRef = useRef(initialValue);
  const [value, setValue] = useState<T>(() => readPersistedValue(key, initialRef.current));

  useEffect(() => {
    setValue(readPersistedValue(key, initialRef.current));
  }, [key]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      setValue(readPersistedValue(key, initialRef.current));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [key]);

  const setPersistedValue = useCallback<SetPersistedValue<T>>((nextValue) => {
    setValue(previous => {
      const next = typeof nextValue === "function"
        ? (nextValue as (previous: T) => T)(previous)
        : nextValue;
      writePersistedValue(key, next);
      return next;
    });
  }, [key]);

  const remove = useCallback(() => {
    try { localStorage.removeItem(key); } catch { /* private browsing */ }
    setValue(initialRef.current);
  }, [key]);

  return [value, setPersistedValue, remove];
}

export function orgViewKey(scope: string, organizationId?: string | null) {
  return `gestiona.view.${scope}.${organizationId || "default"}`;
}
