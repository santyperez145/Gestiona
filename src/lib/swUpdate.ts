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
const VENTANA_DE_NAVEGACION_MS = 4_000;
let ultimaNavegacion = 0;

// Hasta tres recargas solas en dos minutos, con esperas crecientes. Una sola
// por minuto no alcanzaba: el 2026-10-15, durante una publicación, el servidor
// devolvió 404 a archivos nuevos unos segundos; el único intento se gastó ahí
// y la pantalla siguiente quedó en «Nueva versión disponible». Más allá de
// tres, no es un despliegue en curso: se ofrece actualizar a mano.
const ESPERAS_MS = [0, 8_000, 20_000];
const VENTANA_DE_INTENTOS_MS = 120_000;
type Intentos = { n: number; primera: number; ultima: number };

function leerIntentos(ahora: number): Intentos | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE_RECARGA);
    if (!crudo) return { n: 0, primera: ahora, ultima: 0 };
    const previo = JSON.parse(crudo) as Partial<Intentos> | number;
    // Formato anterior: el instante de la última recarga.
    const i: Intentos = typeof previo === "number"
      ? { n: 1, primera: previo, ultima: previo }
      : { n: Number(previo.n) || 0, primera: Number(previo.primera) || ahora, ultima: Number(previo.ultima) || 0 };
    return ahora - i.primera > VENTANA_DE_INTENTOS_MS ? { n: 0, primera: ahora, ultima: 0 } : i;
  } catch {
    return null; // Sin sessionStorage no hay candado: mejor no recargar solo.
  }
}

/** En cuántos ms puede ir la próxima recarga sola, o null si no hay más intentos. */
export function esperaParaRecargar(ahora = Date.now()): number | null {
  const i = leerIntentos(ahora);
  if (!i || i.n >= ESPERAS_MS.length) return null;
  return Math.max(0, ESPERAS_MS[i.n] - (ahora - i.ultima));
}

/**
 * Anota el intento y recarga a la versión nueva dentro de `espera` ms.
 * Devuelve la espera, o null si ya no quedan intentos.
 */
export function programarRecargaPorVersion(ahora = Date.now()): number | null {
  if (typeof window === "undefined") return null;
  const espera = esperaParaRecargar(ahora);
  const i = leerIntentos(ahora);
  if (espera === null || !i) return null;
  try { sessionStorage.setItem(CLAVE_RECARGA, JSON.stringify({ n: i.n + 1, primera: i.n === 0 ? ahora : i.primera, ultima: ahora + espera })); }
  catch { return null; }
  if (espera === 0) void hardReload();
  else setTimeout(() => { void hardReload(); }, espera);
  return espera;
}

/** Recarga ya, si corresponde un intento inmediato. Devuelve si recargó. */
export function recargarPorVersionNueva(ahora = Date.now()): boolean {
  if (esperaParaRecargar(ahora) !== 0) return false;
  return programarRecargaPorVersion(ahora) === 0;
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

const VENTANA_DE_CARGA_MS = 20_000;

/**
 * Un archivo de una versión que ya no existe falló. Si la página recién cargó
 * o se acaba de navegar, no hay trabajo a medio hacer que proteger: se carga
 * la versión nueva sola (hasta tres veces, con esperas) en vez de frenar en
 * «Nueva versión disponible» hasta que la persona toque «Actualizar» (pasaba
 * al entrar justo después de un despliegue, 2026-10-14). Devuelve en cuántos
 * ms recarga, o null si corresponde ofrecer actualizar a mano.
 */
export function recuperarVersionSola(ahora = Date.now(), msDesdeLaCarga = typeof performance !== "undefined" ? performance.now() : Infinity): number | null {
  const sinTrabajoEnCurso = msDesdeLaCarga < VENTANA_DE_CARGA_MS || navegoHaceInstantes(ahora);
  return sinTrabajoEnCurso ? programarRecargaPorVersion(ahora) : null;
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
