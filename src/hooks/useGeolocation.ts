/**
 * useGeolocation — Browser Geolocation API hook.
 *
 * Requests the device's current position using the Web Geolocation API.
 * Handles permission states, errors, and continuous watching.
 *
 * Usage:
 *   const { position, error, loading, request } = useGeolocation();
 *   const { position, watching } = useGeolocation({ watch: true, highAccuracy: true });
 *
 * Returns:
 *   - position: { lat, lng, accuracy, altitude, speed }
 *   - error: string | null (human-readable)
 *   - loading: boolean
 *   - supported: boolean (Geolocation API available)
 *   - request(): manually trigger a position fetch
 *   - stop(): stop watching (if watch: true)
 *
 * Privacy note: location is NEVER sent to the server unless explicitly used.
 * Used for delivery routing, store location display, and distance estimates.
 */
import { useState, useEffect, useCallback, useRef } from "react";

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number; // meters
  altitude: number | null;
  speed: number | null; // m/s
  timestamp: number;
}

interface Options {
  /** Watch position continuously (default: false — one-shot) */
  watch?: boolean;
  /** High accuracy (more battery, more precision) */
  highAccuracy?: boolean;
  /** Max age of cached position in ms */
  maximumAge?: number;
  /** Timeout in ms */
  timeout?: number;
  /** Auto-request on mount */
  autoRequest?: boolean;
}

const ERROR_MESSAGES: Record<number, string> = {
  1: "Permiso de ubicación denegado. Habilitalo en la configuración del navegador.",
  2: "Posición no disponible (GPS sin señal o servicio no disponible).",
  3: "Tiempo de espera agotado al obtener la ubicación.",
};

export const geolocationSupported = typeof navigator !== "undefined" && "geolocation" in navigator;

export function useGeolocation(options: Options = {}) {
  const {
    watch = false,
    highAccuracy = false,
    maximumAge = 30000,
    timeout = 10000,
    autoRequest = false,
  } = options;

  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  const geoOptions: PositionOptions = {
    enableHighAccuracy: highAccuracy,
    maximumAge,
    timeout,
  };

  const onSuccess = useCallback((pos: GeolocationPosition) => {
    setPosition({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      altitude: pos.coords.altitude,
      speed: pos.coords.speed,
      timestamp: pos.timestamp,
    });
    setError(null);
    setLoading(false);
  }, []);

  const onError = useCallback((err: GeolocationPositionError) => {
    setError(ERROR_MESSAGES[err.code] ?? err.message);
    setLoading(false);
  }, []);

  const request = useCallback(() => {
    if (!geolocationSupported) {
      setError("Geolocalización no disponible en este navegador.");
      return;
    }
    setLoading(true);
    setError(null);
    if (watch) {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, geoOptions);
    } else {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, geoOptions);
    }
  }, [watch, onSuccess, onError]);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (autoRequest) request();
    return () => { if (watch) stop(); };
  }, [autoRequest]);

  return {
    position,
    error,
    loading,
    supported: geolocationSupported,
    watching: watchIdRef.current !== null,
    request,
    stop,
  };
}

/** Compute distance between two lat/lng coords in km (Haversine formula). */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
