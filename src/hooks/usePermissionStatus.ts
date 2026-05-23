/**
 * usePermissionStatus — Permissions API hook for checking browser permission states.
 *
 * Reactively tracks the state of browser permissions (camera, microphone,
 * notifications, geolocation, etc.) and updates the UI when they change.
 *
 * Features:
 *   - Query current state without triggering a permission prompt
 *   - Reactive updates via PermissionStatus.onchange
 *   - Multiple permissions in one hook call
 *   - Graceful fallback for unsupported browsers
 *
 * Usage:
 *   const { camera, microphone, notifications } = usePermissionStatus(
 *     ["camera", "microphone", "notifications"]
 *   );
 *
 *   // States: "granted" | "denied" | "prompt" | "unsupported"
 *   if (camera === "denied") <Alert>Cámara bloqueada</Alert>
 *   if (notifications === "prompt") <Button onClick={requestPermission}>Activar notificaciones</Button>
 */
import { useState, useEffect } from "react";

type PermissionName =
  | "camera"
  | "microphone"
  | "notifications"
  | "geolocation"
  | "persistent-storage"
  | "push"
  | "screen-wake-lock"
  | "clipboard-read"
  | "clipboard-write";

type PermissionState = "granted" | "denied" | "prompt" | "unsupported";

type PermissionMap<T extends PermissionName> = Record<T, PermissionState>;

export function usePermissionStatus<T extends PermissionName>(
  permissions: T[]
): PermissionMap<T> {
  const initial = Object.fromEntries(
    permissions.map(p => [p, "prompt" as PermissionState])
  ) as PermissionMap<T>;

  const [states, setStates] = useState<PermissionMap<T>>(initial);

  useEffect(() => {
    if (typeof navigator?.permissions?.query !== "function") {
      setStates(
        Object.fromEntries(permissions.map(p => [p, "unsupported"])) as PermissionMap<T>
      );
      return;
    }

    const statusRefs: PermissionStatus[] = [];

    Promise.all(
      permissions.map(async (perm) => {
        try {
          const status = await navigator.permissions.query({ name: perm as PermissionDescriptor["name"] });
          statusRefs.push(status);

          const update = () => {
            setStates(prev => ({ ...prev, [perm]: status.state as PermissionState }));
          };

          status.addEventListener("change", update);
          return { perm, state: status.state as PermissionState };
        } catch {
          return { perm, state: "unsupported" as PermissionState };
        }
      })
    ).then(results => {
      setStates(
        Object.fromEntries(results.map(r => [r.perm, r.state])) as PermissionMap<T>
      );
    });

    return () => {
      statusRefs.forEach(s => {
        // Remove all listeners
        try { s.onchange = null; } catch { /* ignore */ }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return states;
}
