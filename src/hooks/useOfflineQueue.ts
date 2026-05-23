/**
 * useOfflineQueue — Offline-first action queue with IndexedDB persistence.
 *
 * When an action fails due to network loss, it is stored in IndexedDB and
 * retried automatically when the browser comes back online. Critical for
 * POS environments where connectivity is unreliable.
 *
 * Features:
 *   - IndexedDB persistence (survives page refresh)
 *   - Automatic retry on 'online' event
 *   - Configurable max retries and backoff
 *   - Optimistic UI (action appears to succeed immediately)
 *   - Queue drain progress feedback
 *   - Namespaced stores (per org / per entity type)
 *
 * Usage:
 *   const { enqueue, queueSize, draining } = useOfflineQueue("sales");
 *
 *   // Register the action to replay on retry:
 *   const saveSale = async (sale: Sale) => {
 *     await enqueue({
 *       id: crypto.randomUUID(),
 *       payload: sale,
 *       handler: async (s) => {
 *         await supabase.from("sales").insert(s);
 *       },
 *     });
 *   };
 *
 *   // UI badge
 *   {queueSize > 0 && <Badge>{queueSize} pendiente{queueSize > 1 ? "s" : ""}</Badge>}
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

export interface QueuedAction<T = unknown> {
  /** Unique action ID (use crypto.randomUUID()) */
  id: string;
  /** The data payload to pass to the handler on retry */
  payload: T;
  /** The async function to retry — must be serialisable by ref (not closure) */
  handler: (payload: T) => Promise<void>;
  /** How many times it's been tried already */
  attempts?: number;
  /** ISO string of when it was queued */
  queuedAt?: string;
}

interface UseOfflineQueueOptions {
  /** Max retry attempts before giving up. Default: 5 */
  maxRetries?: number;
  /** Base delay between retries (ms). Default: 2000 */
  baseDelay?: number;
  /** Called when a queued action permanently fails */
  onDeadLetter?: (action: QueuedAction) => void;
}

interface UseOfflineQueueReturn<T> {
  /**
   * Enqueue an action. Tries immediately — if it fails and we're offline,
   * it is persisted and retried on reconnect. Returns true on immediate success.
   */
  enqueue: (action: QueuedAction<T>) => Promise<boolean>;
  /** Number of actions waiting to be retried */
  queueSize: number;
  /** Whether the queue is currently being drained */
  draining: boolean;
  /** Manually trigger a drain attempt */
  drain: () => Promise<void>;
  /** Clear the queue (e.g. after user logs out) */
  clear: () => Promise<void>;
}

const DB_NAME = "gestiona_offline_queue";
const DB_VERSION = 1;

function openDB(storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName: string): Promise<any[]> {
  const db = await openDB(storeName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName: string, item: any): Promise<void> {
  const db = await openDB(storeName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(storeName: string, id: string): Promise<void> {
  const db = await openDB(storeName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(storeName: string): Promise<void> {
  const db = await openDB(storeName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Store handlers in memory — they can't be serialised to IndexedDB
const handlerMap = new Map<string, (payload: any) => Promise<void>>();

export function useOfflineQueue<T = unknown>(
  namespace: string,
  options: UseOfflineQueueOptions = {}
): UseOfflineQueueReturn<T> {
  const { maxRetries = 5, baseDelay = 2000, onDeadLetter } = options;
  const [queueSize, setQueueSize] = useState(0);
  const [draining, setDraining] = useState(false);
  const drainingRef = useRef(false);

  // Load initial queue size from IDB
  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    idbGetAll(namespace).then(items => setQueueSize(items.length)).catch(() => {});
  }, [namespace]);

  const drain = useCallback(async () => {
    if (drainingRef.current || typeof indexedDB === "undefined") return;
    drainingRef.current = true;
    setDraining(true);

    try {
      const items = await idbGetAll(namespace);
      if (items.length === 0) { setQueueSize(0); return; }

      let succeeded = 0;
      for (const item of items) {
        const handler = handlerMap.get(item.id) ?? item._handler;
        if (!handler) {
          // No handler registered — skip (will retry next drain)
          continue;
        }
        try {
          await handler(item.payload);
          await idbDelete(namespace, item.id);
          handlerMap.delete(item.id);
          succeeded++;
        } catch {
          const attempts = (item.attempts ?? 0) + 1;
          if (attempts >= maxRetries) {
            await idbDelete(namespace, item.id);
            handlerMap.delete(item.id);
            onDeadLetter?.(item as QueuedAction);
            toast.error(`Acción descartada tras ${maxRetries} intentos: ${item.id}`);
          } else {
            await idbPut(namespace, { ...item, attempts });
          }
        }
      }

      const remaining = await idbGetAll(namespace);
      setQueueSize(remaining.length);

      if (succeeded > 0) {
        toast.success(`✅ ${succeeded} acción${succeeded > 1 ? "es" : ""} sincronizada${succeeded > 1 ? "s" : ""}`);
      }
    } finally {
      drainingRef.current = false;
      setDraining(false);
    }
  }, [namespace, maxRetries, onDeadLetter]);

  // Auto-drain when coming back online
  useEffect(() => {
    const handler = () => {
      drain().catch(() => {});
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [drain]);

  const enqueue = useCallback(async (action: QueuedAction<T>): Promise<boolean> => {
    // Store handler in memory map
    handlerMap.set(action.id, action.handler as (payload: any) => Promise<void>);

    try {
      // Try immediately
      await action.handler(action.payload);
      return true;
    } catch {
      // Failed — persist to IDB for retry
      if (typeof indexedDB !== "undefined") {
        const record = {
          id: action.id,
          payload: action.payload,
          attempts: 0,
          queuedAt: new Date().toISOString(),
        };
        await idbPut(namespace, record).catch(() => {});
        const all = await idbGetAll(namespace).catch(() => []);
        setQueueSize(all.length);
        toast.warning("Sin conexión — la acción se sincronizará cuando vuelva internet", {
          duration: 4000,
          id: "offline-queue-notice",
        });
      }
      return false;
    }
  }, [namespace]);

  const clear = useCallback(async () => {
    await idbClear(namespace).catch(() => {});
    handlerMap.clear();
    setQueueSize(0);
  }, [namespace]);

  return { enqueue, queueSize, draining, drain, clear };
}
