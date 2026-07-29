import { toast } from "sonner";

/**
 * Detecta versiones nuevas del service worker y recarga para que el usuario
 * vea siempre el último deploy.
 *
 * El SW usa `skipWaiting()` + `clients.claim()`, así que al llegar un deploy
 * toma el control de las pestañas abiertas al instante. Pero el JS que ya está
 * corriendo sigue siendo el viejo: sin una recarga la pantalla queda
 * desactualizada aunque el SW ya sirva los assets nuevos.
 *
 * OJO con el guard anti-loop: antes era un flag de sessionStorage sin
 * vencimiento, así que después de la primera recarga de la sesión **ningún**
 * deploy posterior volvía a recargar. La app se quedaba mostrando código viejo
 * indefinidamente (por eso un botón arreglado seguía apuntando al link viejo).
 * Ahora el guard es por tiempo: corta los loops —que ocurren en milisegundos—
 * pero deja pasar las actualizaciones legítimas.
 */
const LAST_RELOAD_KEY = "sw_last_reload_at";
/** Dos recargas más seguidas que esto son un loop, no una actualización. */
export const LOOP_WINDOW_MS = 15_000;

/**
 * ¿Conviene recargar sola la app al cambiar el service worker?
 *
 * Pura y exportada a propósito: es la regla que estuvo rota y dejaba a la app
 * mostrando código viejo para siempre.
 *
 * @param lastReloadAt marca de la última recarga automática (ms), o null
 * @param now momento actual (ms)
 */
export function shouldAutoReload(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt === null || !Number.isFinite(lastReloadAt)) return true;
  return now - lastReloadAt >= LOOP_WINDOW_MS;
}

function reloadedRecently(): boolean {
  try {
    const raw = sessionStorage.getItem(LAST_RELOAD_KEY);
    return !shouldAutoReload(raw === null ? null : Number(raw), Date.now());
  } catch {
    return false;
  }
}

function markReload() {
  try { sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now())); } catch { /* modo privado */ }
}

export function setupServiceWorkerUpdates() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;

    if (reloadedRecently()) {
      // Sospecha de loop: no recargamos solos, pero se lo ofrecemos al usuario
      // para que no quede atrapado en una versión vieja sin salida.
      toast.info("Hay una versión nueva de la app", {
        description: "Actualizá para verla.",
        duration: Infinity,
        action: {
          label: "Actualizar",
          onClick: () => { markReload(); window.location.reload(); },
        },
      });
      return;
    }

    refreshing = true;
    markReload();
    // Margen para que terminen las peticiones en vuelo.
    setTimeout(() => window.location.reload(), 200);
  });

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
