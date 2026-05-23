/**
 * useNetworkStatus — Detects online / offline status and connection quality.
 *
 * Uses the browser's `navigator.onLine` flag + `online`/`offline` events as the
 * primary signal, and the experimental Network Information API
 * (navigator.connection) for connection type and effective speed.
 *
 * Returns:
 *   - online: boolean           — true when the browser reports network access
 *   - offlineSince: Date | null — when we went offline (null if currently online)
 *   - connection: ConnectionInfo — effective type, downlink, RTT (may be null on
 *                                   browsers without Network Information API)
 *   - wasOffline: boolean        — true if we were offline at some point this session
 *
 * Usage:
 *   const { online, offlineSince, connection } = useNetworkStatus();
 *   if (!online) return <OfflineBanner since={offlineSince} />;
 */
import { useState, useEffect, useCallback } from "react";

export interface ConnectionInfo {
  /** 'slow-2g' | '2g' | '3g' | '4g' | null */
  effectiveType: string | null;
  /** Estimated downlink in Mbps */
  downlink: number | null;
  /** Round-trip time in ms */
  rtt: number | null;
  /** Whether the user has requested reduced data usage */
  saveData: boolean;
}

function getConnectionInfo(): ConnectionInfo {
  const conn = (navigator as any).connection ??
               (navigator as any).mozConnection ??
               (navigator as any).webkitConnection;
  if (!conn) return { effectiveType: null, downlink: null, rtt: null, saveData: false };
  return {
    effectiveType: conn.effectiveType ?? null,
    downlink: conn.downlink ?? null,
    rtt: conn.rtt ?? null,
    saveData: conn.saveData ?? false,
  };
}

export function useNetworkStatus() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [offlineSince, setOfflineSince] = useState<Date | null>(
    () => (typeof navigator !== "undefined" && !navigator.onLine ? new Date() : null)
  );
  const [connection, setConnection] = useState<ConnectionInfo>(getConnectionInfo);
  const [wasOffline, setWasOffline] = useState(false);

  const handleOnline = useCallback(() => {
    setOnline(true);
    setOfflineSince(null);
  }, []);

  const handleOffline = useCallback(() => {
    setOnline(false);
    setOfflineSince(new Date());
    setWasOffline(true);
  }, []);

  const handleConnectionChange = useCallback(() => {
    setConnection(getConnectionInfo());
  }, []);

  useEffect(() => {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const conn = (navigator as any).connection ??
                 (navigator as any).mozConnection ??
                 (navigator as any).webkitConnection;
    conn?.addEventListener("change", handleConnectionChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      conn?.removeEventListener("change", handleConnectionChange);
    };
  }, [handleOnline, handleOffline, handleConnectionChange]);

  return { online, offlineSince, connection, wasOffline };
}
