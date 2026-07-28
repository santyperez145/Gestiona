import { toast } from "sonner";

/**
 * Detect new service worker versions and force the app to reload
 * so users always see the latest deploy.
 *
 * With `registerType: "autoUpdate"` in vite-plugin-pwa, the new SW
 * installs and activates automatically in the background. This listener
 * catches the moment a new SW takes control and triggers a reload.
 */
export function setupServiceWorkerUpdates() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  let refreshing = false;
  // Guarda entre recargas: si el SW se reinstala varias veces (deploys
  // seguidos, update() periódico), sin esto la app entra en loop de reloads.
  const RELOADED_KEY = "sw_controller_reloaded";

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    if (sessionStorage.getItem(RELOADED_KEY)) return; // ya recargamos en esta sesión
    refreshing = true;
    sessionStorage.setItem(RELOADED_KEY, "1");
    // Slight delay so any in-flight requests can settle
    setTimeout(() => window.location.reload(), 200);
  });

  // Also notify user when a new SW is waiting (rare with skipWaiting=true,
  // but defensive in case of race conditions)
  navigator.serviceWorker.ready.then((reg) => {
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // A new worker is installed and waiting — show a soft notification
          toast.info("Hay una nueva versión disponible", {
            description: "Se actualizará automáticamente en unos segundos.",
            duration: 4000,
          });
        }
      });
    });
  });

  // Periodically check for updates (every 30 min while tab is open)
  setInterval(() => {
    navigator.serviceWorker.ready.then((reg) => reg.update()).catch(() => {});
  }, 30 * 60 * 1000);
}
