/**
 * useIndexedDB — Lightweight IndexedDB wrapper for offline caching.
 *
 * Persists data locally using the browser's IndexedDB, allowing offline
 * access to products, customers, and other critical data.
 *
 * Usage:
 *   const { get, set, del, clear } = useIndexedDB("products");
 *   await set("my-key", data);
 *   const cached = await get("my-key");
 *
 * Each storeName is an independent IndexedDB object store within the
 * "gestiona-cache" database.
 */
import { useCallback, useEffect, useRef } from "react";

const DB_NAME = "gestiona-cache";
const DB_VERSION = 1;

const STORES = ["products", "customers", "settings", "sales", "misc"] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not supported"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbGet<T = unknown>(store: StoreName, key: string): Promise<T | undefined> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  }));
}

function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

function idbDel(store: StoreName, key: string): Promise<void> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

function idbClear(store: StoreName): Promise<void> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

export function useIndexedDB(storeName: StoreName) {
  const get = useCallback(<T = unknown>(key: string) => idbGet<T>(storeName, key), [storeName]);
  const set = useCallback((key: string, value: unknown) => idbSet(storeName, key, value), [storeName]);
  const del = useCallback((key: string) => idbDel(storeName, key), [storeName]);
  const clear = useCallback(() => idbClear(storeName), [storeName]);

  return { get, set, del, clear };
}

/**
 * Cache-then-fetch pattern.
 * Returns cached data immediately (if available), then fetches fresh data.
 */
export async function cachedFetch<T>(
  store: StoreName,
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 5 * 60 * 1000 // 5 minutes default
): Promise<T> {
  type Cached = { data: T; ts: number };
  const cached = await idbGet<Cached>(store, key);
  if (cached && Date.now() - cached.ts < ttlMs) {
    return cached.data;
  }
  const fresh = await fetcher();
  await idbSet(store, key, { data: fresh, ts: Date.now() });
  return fresh;
}
