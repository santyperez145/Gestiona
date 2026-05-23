/**
 * useNotifications — Web Notifications API hook.
 *
 * Manages notification permission, shows native browser notifications,
 * and handles the full permission lifecycle gracefully.
 *
 * Features:
 *   - Request notification permission with user gesture
 *   - Show rich notifications (title, body, icon, badge, tag, actions)
 *   - Auto-closes after configurable timeout
 *   - Falls back silently on unsupported browsers
 *
 * Usage:
 *   const { supported, permission, requestPermission, notify } = useNotifications();
 *
 *   // Request permission (must be called in a user gesture handler)
 *   await requestPermission();
 *
 *   // Show a notification
 *   notify("Stock bajo", { body: "Lattafa Ameer Al Oud — solo 2 unidades", icon: "/icon.png" });
 *
 *   // Auto-close after 5s
 *   notify("Venta registrada", { body: "$12,500 · Efectivo", autoClose: 5000 });
 */
import { useState, useCallback, useEffect } from "react";

type NotificationPermission = "default" | "granted" | "denied";

interface NotifyOptions extends NotificationOptions {
  /** Auto-close the notification after N milliseconds */
  autoClose?: number;
}

interface UseNotificationsReturn {
  /** Whether the Notifications API is available in this browser */
  supported: boolean;
  /** Current permission state: "default" | "granted" | "denied" */
  permission: NotificationPermission;
  /** Request notification permission. Returns the resulting permission. */
  requestPermission: () => Promise<NotificationPermission>;
  /** Show a notification. Returns the Notification instance or null. */
  notify: (title: string, options?: NotifyOptions) => Notification | null;
}

export function useNotifications(): UseNotificationsReturn {
  const supported = typeof window !== "undefined" && "Notification" in window;

  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? (Notification.permission as NotificationPermission) : "denied"
  );

  // Keep permission in sync if the browser changes it externally
  useEffect(() => {
    if (!supported) return;
    // Some browsers expose a permissionchange event on Notification
    const status = Notification.permission as NotificationPermission;
    if (status !== permission) setPermission(status);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!supported) return "denied";
    try {
      const result = await Notification.requestPermission();
      const perm = result as NotificationPermission;
      setPermission(perm);
      return perm;
    } catch {
      return "denied";
    }
  }, [supported]);

  const notify = useCallback(
    (title: string, options: NotifyOptions = {}): Notification | null => {
      if (!supported) return null;
      if (Notification.permission !== "granted") return null;

      const { autoClose, ...notifOptions } = options;

      const n = new Notification(title, {
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        ...notifOptions,
      });

      if (autoClose && autoClose > 0) {
        setTimeout(() => n.close(), autoClose);
      }

      return n;
    },
    [supported]
  );

  return { supported, permission, requestPermission, notify };
}
