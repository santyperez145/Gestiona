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
let appUpdateAvailable = false;

/** Permite que el error boundary distinga un deploy pendiente de un bug real. */
export function hasPendingAppUpdate() {
  return appUpdateAvailable;
}

export function announceUpdateAvailable() {
  if (typeof window === "undefined") return;
  appUpdateAvailable = true;
  window.dispatchEvent(new Event(UPDATE_AVAILABLE_EVENT));
}

function showUpdateNotice() {
  appUpdateAvailable = true;
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

// ── Actualizar al navegar ──────────────────────────────────────────────────
// Lo que hacen las apps de primer nivel: con una versión nueva pendiente, el
// próximo cambio de pantalla carga la versión nueva. Recargar ahí no pierde
// trabajo (el usuario ya dejó la pantalla anterior) y evita que la pantalla
// nueva pida archivos de un build que ya no existe: el 2026-10-14 eso dejaba
// «Cannot read properties of undefined (reading 'default')» y la pantalla de
// versión nueva en medio de la navegación.
const CLAVE_RECARGA = "nerqia.recarga-por-version";
const VENTANA_SIN_REPETIR_MS = 60_000;
const VENTANA_DE_NAVEGACION_MS = 4_000;
let ultimaNavegacion = 0;

function recargoHaceInstantes(ahora: number): boolean {
  try {
    const previa = Number(sessionStorage.getItem(CLAVE_RECARGA) ?? 0);
    return ahora - previa < VENTANA_SIN_REPETIR_MS;
  } catch {
    return true; // Sin sessionStorage no hay candado: mejor no recargar solo.
  }
}

/** Recarga a la versión nueva una sola vez por minuto. Devuelve si recargó. */
export function recargarPorVersionNueva(ahora = Date.now()): boolean {
  if (typeof window === "undefined" || recargoHaceInstantes(ahora)) return false;
  try { sessionStorage.setItem(CLAVE_RECARGA, String(ahora)); } catch { return false; }
  void hardReload();
  return true;
}

/** Lo llama el router en cada cambio de pantalla (no en la primera carga). */
export function alCambiarDePantalla(ahora = Date.now()): boolean {
  ultimaNavegacion = ahora;
  return appUpdateAvailable ? recargarPorVersionNueva(ahora) : false;
}

/** Un archivo viejo que falla justo después de navegar es parte de esa navegación. */
export function navegoHaceInstantes(ahora = Date.now()): boolean {
  return ultimaNavegacion > 0 && ahora - ultimaNavegacion < VENTANA_DE_NAVEGACION_MS;
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
