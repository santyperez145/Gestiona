/**
 * usePersistentForm — Auto-save form drafts to localStorage.
 *
 * Extends useState for form objects by persisting every change to localStorage.
 * Restores the last draft when the component mounts, preventing data loss on
 * accidental navigation or browser refresh.
 *
 * Features:
 *   - Auto-save on every field change (debounced 500ms to avoid hammering)
 *   - Configurable TTL (default 24h — drafts expire after 1 day)
 *   - `clearDraft()` removes the stored draft (call on successful submit)
 *   - `hasDraft` boolean: shows a "restore draft" banner in the UI
 *   - `draftAge` string: human-readable time since last auto-save
 *
 * Usage:
 *   const { form, setField, clearDraft, hasDraft, draftAge } = usePersistentForm(
 *     "product-form",
 *     EMPTY_FORM,
 *     { ttlMs: 24 * 3600 * 1000 }
 *   );
 *   // Use `form` instead of local state, `setField(key, value)` to update.
 */
import { useState, useCallback, useEffect, useRef } from "react";

interface Options {
  ttlMs?: number;
  debounceMs?: number;
}

interface Stored<T> {
  data: T;
  savedAt: number;
  exp: number;
}

function readDraft<T>(key: string, initial: T): { data: T; savedAt: number | null } {
  try {
    const raw = localStorage.getItem(`gestiona.draft.${key}`);
    if (!raw) return { data: initial, savedAt: null };
    const parsed: Stored<T> = JSON.parse(raw);
    if (Date.now() > parsed.exp) {
      localStorage.removeItem(`gestiona.draft.${key}`);
      return { data: initial, savedAt: null };
    }
    return { data: parsed.data, savedAt: parsed.savedAt };
  } catch {
    return { data: initial, savedAt: null };
  }
}

function writeDraft<T>(key: string, data: T, ttlMs: number, savedAt: number) {
  try {
    const stored: Stored<T> = { data, savedAt, exp: Date.now() + ttlMs };
    localStorage.setItem(`gestiona.draft.${key}`, JSON.stringify(stored));
  } catch {}
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "hace un momento";
  if (diff < 3600000) return `hace ${Math.round(diff / 60000)} min`;
  if (diff < 86400000) return `hace ${Math.round(diff / 3600000)}h`;
  return `hace ${Math.round(diff / 86400000)} días`;
}

export function usePersistentForm<T extends Record<string, unknown>>(
  draftKey: string,
  initialValue: T,
  options: Options = {}
) {
  const { ttlMs = 24 * 3600 * 1000, debounceMs = 500 } = options;

  const { data: restoredData, savedAt: restoredAt } = readDraft<T>(draftKey, initialValue);
  const [form, setForm] = useState<T>(restoredData);
  const [savedAt, setSavedAt] = useState<number | null>(restoredAt);
  const hasDraft = savedAt !== null;
  const draftAge = hasDraft && savedAt ? timeAgo(savedAt) : "";

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback((value: T) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const ts = Date.now();
      writeDraft(draftKey, value, ttlMs, ts);
      setSavedAt(ts);
    }, debounceMs);
  }, [draftKey, ttlMs, debounceMs]);

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      persist(next);
      return next;
    });
  }, [persist]);

  const setAllFields = useCallback((updates: Partial<T>) => {
    setForm(prev => {
      const next = { ...prev, ...updates };
      persist(next);
      return next;
    });
  }, [persist]);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(`gestiona.draft.${draftKey}`);
    setSavedAt(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, [draftKey]);

  const resetForm = useCallback(() => {
    setForm(initialValue);
    clearDraft();
  }, [initialValue, clearDraft]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return {
    form,
    setField,
    setAllFields,
    resetForm,
    clearDraft,
    hasDraft,
    draftAge,
    savedAt,
  };
}
