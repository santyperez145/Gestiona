/**
 * useStorageEstimate — Storage Manager API hook.
 *
 * Queries the browser's Storage Manager for quota and usage estimates.
 * Useful for displaying storage health in a settings/admin panel, or for
 * warning users when IndexedDB / localStorage is nearing capacity.
 *
 * Browser support: All modern browsers (Chrome 61+, Firefox 57+, Safari 15.2+)
 *
 * Features:
 *   - Returns used / quota in bytes and human-readable format
 *   - Percentage used (for progress bars)
 *   - Persistent storage request (prevents browser eviction)
 *   - Auto-refresh on demand
 *
 * Usage:
 *   const { used, quota, percent, usedHuman, quotaHuman, requestPersistent } = useStorageEstimate();
 *
 *   <p>{usedHuman} usado de {quotaHuman} ({percent.toFixed(1)}%)</p>
 *   <Button onClick={requestPersistent}>Proteger datos</Button>
 */
import { useState, useEffect, useCallback } from "react";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

interface UseStorageEstimateReturn {
  /** Bytes currently in use */
  used: number;
  /** Total storage quota (bytes) */
  quota: number;
  /** Percentage used (0–100) */
  percent: number;
  /** Human-readable used amount (e.g. "4.2 MB") */
  usedHuman: string;
  /** Human-readable quota (e.g. "1.2 GB") */
  quotaHuman: string;
  /** Whether the storage is persisted (won't be evicted by browser) */
  persisted: boolean;
  /** Request persistent storage (shows permission prompt) */
  requestPersistent: () => Promise<boolean>;
  /** Manually refresh the estimate */
  refresh: () => Promise<void>;
  /** Whether the estimate is loading */
  loading: boolean;
}

export function useStorageEstimate(): UseStorageEstimateReturn {
  const [used, setUsed] = useState(0);
  const [quota, setQuota] = useState(0);
  const [persisted, setPersisted] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (typeof navigator?.storage === "undefined") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [estimate, isPersisted] = await Promise.all([
        navigator.storage.estimate(),
        navigator.storage.persisted().catch(() => false),
      ]);
      setUsed(estimate.usage ?? 0);
      setQuota(estimate.quota ?? 0);
      setPersisted(isPersisted as boolean);
    } catch {
      /* Silently ignore if unsupported */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const requestPersistent = useCallback(async (): Promise<boolean> => {
    if (typeof navigator?.storage?.persist === "undefined") return false;
    try {
      const granted = await navigator.storage.persist();
      if (granted) setPersisted(true);
      return granted;
    } catch {
      return false;
    }
  }, []);

  const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;

  return {
    used,
    quota,
    percent,
    usedHuman: formatBytes(used),
    quotaHuman: formatBytes(quota),
    persisted,
    requestPersistent,
    refresh,
    loading,
  };
}
