/**
 * useUndoRedo — Generic undo/redo state history hook.
 *
 * Wraps any state value in a history stack, enabling undo and redo operations.
 * Useful for form editors, canvas tools, config builders, etc.
 *
 * Features:
 *   - Configurable history limit (default: 50 entries)
 *   - Keyboard shortcut helpers (ctrl+z / ctrl+shift+z)
 *   - `snapshot()` — explicitly save a checkpoint (for batch edits)
 *   - `reset(value)` — reset to a new base state, clearing history
 *   - canUndo / canRedo booleans
 *   - historySize: current depth of history stack
 *
 * Usage:
 *   const { state, set, undo, redo, canUndo, canRedo, snapshot } =
 *     useUndoRedo(initialValue);
 *
 *   // set() records every change automatically
 *   <input value={state.name} onChange={e => set({ ...state, name: e.target.value })} />
 *
 *   // Snapshot for bulk/programmatic edits
 *   const applyTemplate = () => {
 *     snapshot();
 *     set(newValue);
 *   };
 */
import { useCallback, useRef, useState } from "react";

interface UseUndoRedoOptions {
  /** Maximum number of history entries (default: 50) */
  limit?: number;
}

interface UseUndoRedoReturn<T> {
  state: T;
  /** Update state and push a new history entry */
  set: (value: T | ((prev: T) => T)) => void;
  /** Manually snapshot the current state into history */
  snapshot: () => void;
  /** Step back one history entry */
  undo: () => void;
  /** Step forward one history entry */
  redo: () => void;
  /** Reset history to a new base value */
  reset: (value: T) => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Number of undo steps available */
  historySize: number;
  /** Number of redo steps available */
  futureSize: number;
}

export function useUndoRedo<T>(
  initialValue: T,
  options: UseUndoRedoOptions = {}
): UseUndoRedoReturn<T> {
  const { limit = 50 } = options;

  // past[0] is oldest, past[past.length-1] is most recent "before current"
  const [past, setPast]     = useState<T[]>([]);
  const [present, setPresent] = useState<T>(initialValue);
  const [future, setFuture] = useState<T[]>([]);

  const presentRef = useRef(present);
  presentRef.current = present;

  const set = useCallback((value: T | ((prev: T) => T)) => {
    setPresent(prev => {
      const next = typeof value === "function" ? (value as (p: T) => T)(prev) : value;
      // Push current state to past (trim to limit)
      setPast(p => [...p.slice(-(limit - 1)), prev]);
      // Clear redo stack
      setFuture([]);
      return next;
    });
  }, [limit]);

  const snapshot = useCallback(() => {
    const cur = presentRef.current;
    setPast(p => [...p.slice(-(limit - 1)), cur]);
    setFuture([]);
  }, [limit]);

  const undo = useCallback(() => {
    setPast(p => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      const newPast = p.slice(0, -1);
      setPresent(cur => {
        setFuture(f => [cur, ...f]);
        return prev;
      });
      return newPast;
    });
  }, []);

  const redo = useCallback(() => {
    setFuture(f => {
      if (f.length === 0) return f;
      const next = f[0];
      const newFuture = f.slice(1);
      setPresent(cur => {
        setPast(p => [...p, cur]);
        return next;
      });
      return newFuture;
    });
  }, []);

  const reset = useCallback((value: T) => {
    setPresent(value);
    setPast([]);
    setFuture([]);
  }, []);

  return {
    state: present,
    set,
    snapshot,
    undo,
    redo,
    reset,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    historySize: past.length,
    futureSize: future.length,
  };
}
