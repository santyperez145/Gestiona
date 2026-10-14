import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSentry } from "./lib/sentry";
import { validateEnv } from "./lib/env";
import { announceUpdateAvailable, navegoHaceInstantes, recargarPorVersionNueva, setupServiceWorkerUpdates } from "./lib/swUpdate";
import { isStaleBuildError } from "./lib/staleBuildRecovery";
import { isNativeRuntime } from "./lib/nativeRuntime";
import { registrarError } from "./lib/registroDeErrores";

validateEnv();
initSentry();
if (!isNativeRuntime()) setupServiceWorkerUpdates();
// Primer contacto (ref, utm, sitio de origen) para saber cómo llega cada
// comercio nuevo: TESIS §6 y E4. La URL y el sitio de origen se leen ya; el
// código se carga aparte para no sumar un archivo a la carga inicial de la
// landing (presupuesto de `elCompradorNoBajaElPanel`).
const contactoUrl = window.location.href;
const contactoReferrer = document.referrer;
void import("./lib/origenDeAlta").then(({ almacenLocal, capturarPrimerContacto }) =>
  capturarPrimerContacto(contactoUrl, contactoReferrer, almacenLocal()));

// Cuando Vite despliega, los hashes anteriores desaparecen. Si el archivo viejo
// falla justo al navegar, se carga la versión nueva en la pantalla de destino
// (no hay trabajo que perder: la anterior ya se dejó). Fuera de una
// navegación no se interrumpe nada: se anuncia la versión y el error real de
// build viejo llega a la pantalla de actualización. Antes se silenciaba
// (preventDefault) y la pantalla recibía un módulo vacío: «reading 'default'».
window.addEventListener("vite:preloadError", (event) => {
  const preloadError = event as Event & { payload?: unknown };
  if (!isStaleBuildError(preloadError.payload)) return;
  announceUpdateAvailable();
  if (navegoHaceInstantes() && recargarPorVersionNueva()) event.preventDefault();
});

// Errores no atrapados: quedan medidos aunque no haya Sentry (P0.3). Una
// versión vieja que se actualiza no es un error de la app.
window.addEventListener("error", (event) => {
  if (!isStaleBuildError(event.error)) registrarError(event.error ?? event.message);
});

// Fallback para navegadores donde el fallo sólo aparece como promesa rechazada.
window.addEventListener("unhandledrejection", (event) => {
  if (!isStaleBuildError(event.reason)) { registrarError(event.reason); return; }
  announceUpdateAvailable();
  event.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);
