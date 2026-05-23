/**
 * useExchangeRates — fetches live ARS/USD rates from dolarapi.com with 15-min cache.
 * Falls back to Bluelytics if primary fails.
 * Zero dependencies beyond React.
 */
import { useState, useEffect, useCallback } from "react";

export interface ExchangeRates {
  oficial: number;
  blue: number;
  mep: number;
  ccl: number;
  crypto: number;
  mayorista: number;
  lastUpdated: string; // ISO timestamp
  source: string;
}

const CACHE_KEY = "gestiona.exchange_rates_cache";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function loadCache(): (ExchangeRates & { fetchedAt: number }) | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveCache(rates: ExchangeRates) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...rates, fetchedAt: Date.now() }));
  } catch { /* ignore */ }
}

async function fetchFromDolarApi(): Promise<ExchangeRates> {
  const res = await fetch("https://dolarapi.com/v1/dolares", { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`dolarapi HTTP ${res.status}`);
  const arr: any[] = await res.json();
  const find = (nombre: string) => arr.find((d: any) => d.nombre?.toLowerCase() === nombre.toLowerCase());
  const blue = find("blue");
  const oficial = find("oficial");
  const mep = find("bolsa");
  const ccl = find("contado con liquidación");
  const crypto = find("cripto");
  const mayorista = find("mayorista");
  if (!blue) throw new Error("no blue rate in response");
  return {
    oficial: Math.round(oficial?.venta ?? 0),
    blue: Math.round(blue.venta),
    mep: Math.round(mep?.venta ?? 0),
    ccl: Math.round(ccl?.venta ?? 0),
    crypto: Math.round(crypto?.venta ?? 0),
    mayorista: Math.round(mayorista?.venta ?? 0),
    lastUpdated: new Date().toISOString(),
    source: "dolarapi.com",
  };
}

async function fetchFromBluelytics(): Promise<ExchangeRates> {
  const res = await fetch("https://api.bluelytics.com.ar/v2/latest", { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`bluelytics HTTP ${res.status}`);
  const data = await res.json();
  const midBlue = Math.round((data.blue?.value_sell + data.blue?.value_buy) / 2);
  const midOficial = Math.round((data.oficial?.value_sell + data.oficial?.value_buy) / 2);
  return {
    oficial: midOficial,
    blue: midBlue,
    mep: 0,
    ccl: 0,
    crypto: 0,
    mayorista: Math.round((data.oficial?.value_sell ?? midOficial) * 0.97),
    lastUpdated: data.last_update ?? new Date().toISOString(),
    source: "bluelytics.com.ar",
  };
}

export function useExchangeRates(autoFetch = true) {
  const [rates, setRates] = useState<ExchangeRates | null>(() => {
    const cached = loadCache();
    return cached ?? null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let fetched: ExchangeRates;
      try {
        fetched = await fetchFromDolarApi();
      } catch {
        fetched = await fetchFromBluelytics();
      }
      saveCache(fetched);
      setRates(fetched);
    } catch (e: any) {
      setError(e.message ?? "Error al obtener cotizaciones");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoFetch) return;
    const cached = loadCache();
    if (!cached) refresh();
  }, [autoFetch, refresh]);

  return { rates, loading, error, refresh };
}
