/**
 * useOnlineStatus — Tracks online/offline state and fires toasts on change.
 *
 * Also measures connection quality when the Network Information API is available.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

export interface OnlineStatus {
  online: boolean;
  /** Effective connection type (4g, 3g, 2g, slow-2g) or null */
  effectiveType: string | null;
  /** Round trip time in ms or null */
  rtt: number | null;
  /** Downlink in Mbps or null */
  downlink: number | null;
}

function getConnectionInfo(): Pick<OnlineStatus, "effectiveType" | "rtt" | "downlink"> {
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  return {
    effectiveType: conn?.effectiveType ?? null,
    rtt: conn?.rtt ?? null,
    downlink: conn?.downlink ?? null,
  };
}

export function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>(() => ({
    online: navigator.onLine,
    ...getConnectionInfo(),
  }));

  useEffect(() => {
    const goOnline = () => {
      setStatus({ online: true, ...getConnectionInfo() });
      toast.success("Conexión restaurada", { duration: 3000, id: "offline-toast" });
    };
    const goOffline = () => {
      setStatus(s => ({ ...s, online: false }));
      toast.error("Sin conexión a internet", {
        duration: Infinity,
        id: "offline-toast",
        description: "Algunos datos pueden estar desactualizados",
      });
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // Network change
    const nav = navigator as any;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    const onNetChange = () => setStatus(s => ({ ...s, ...getConnectionInfo() }));
    conn?.addEventListener("change", onNetChange);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      conn?.removeEventListener("change", onNetChange);
    };
  }, []);

  return status;
}
