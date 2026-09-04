import { toast } from "sonner";
import { hardReload } from "@/lib/hardReload";

/**
 * Detecta versiones nuevas sin interrumpir el trabajo en curso.
 *
 * El SW usa `skipWaiting()` + `clients.claim()`, así que al llegar un deploy
 * toma el control de las pestañas abiertas. El JS actual puede seguir operando;
 * actualizar es una decisión explícita para no perder formularios, caja ni
 * tareas a medio completar.
 */
export const UPDATE_AVAILABLE_EVENT = "nerqia:update-available";
const UPDATE_TOAST_ID = "nerqia-update-available";

export function announceUpdateAvailable() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(UPDATE_AVAILABLE_EVENT));
}

function showUpdateNotice() {
  toast.info("Hay una versión nueva de Nerqia", {
    id: UPDATE_TOAST_ID,
    description: "Seguí trabajando y actualizá cuando te convenga.",
    duration: Infinity,
    action: {
      label: "Actualizar",
      onClick: () => {
        toast.dismiss(UPDATE_TOAST_ID);
        void hardReload();
      },
    },
  });
}

export function createControllerChangeHandler(
  wasControlled: boolean,
  onUpdateAvailable: () => void,
) {
  let hasController = wasControlled;

  return () => {
    // `clients.claim()` también dispara controllerchange la primera vez que un
    // SW toma una visita limpia. Eso es instalación, no una versión nueva.
    if (!hasController) {
      hasController = true;
      return;
    }
    onUpdateAvailable();
  };
}

export function setupServiceWorkerUpdates() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener(UPDATE_AVAILABLE_EVENT, showUpdateNotice);
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    createControllerChangeHandler(Boolean(navigator.serviceWorker.controller), showUpdateNotice),
  );

  // Chequeo periódico mientras la pestaña esté abierta.
  setInterval(() => {
    navigator.serviceWorker.ready.then(reg => reg.update()).catch(() => {});
  }, 30 * 60 * 1000);

  // Al volver a la pestaña también se busca versión nueva: la mayoría deja la
  // app abierta días entre usos, y ahí es donde se acumula el desfasaje.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    navigator.serviceWorker.ready.then(reg => reg.update()).catch(() => {});
  });
}
