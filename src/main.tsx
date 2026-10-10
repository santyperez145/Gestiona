import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSentry } from "./lib/sentry";
import { validateEnv } from "./lib/env";
import { announceUpdateAvailable, setupServiceWorkerUpdates } from "./lib/swUpdate";
import { isStaleBuildError } from "./lib/staleBuildRecovery";
import { isNativeRuntime } from "./lib/nativeRuntime";
import { almacenLocal, capturarPrimerContacto } from "./lib/origenDeAlta";

validateEnv();
initSentry();
if (!isNativeRuntime()) setupServiceWorkerUpdates();
// Primer contacto (ref, utm, sitio de origen) para saber cómo llega cada
// comercio nuevo: TESIS §6 y E4.
capturarPrimerContacto(window.location.href, document.referrer, almacenLocal());

// Cuando Vite despliega, los hashes anteriores desaparecen. Conservamos la
// pantalla actual y ofrecemos la actualización; nunca interrumpimos el trabajo.
window.addEventListener("vite:preloadError", (event) => {
  const preloadError = event as Event & { payload?: unknown };
  if (!isStaleBuildError(preloadError.payload)) return;
  announceUpdateAvailable();
  event.preventDefault();
});

// Fallback para navegadores donde el fallo sólo aparece como promesa rechazada.
window.addEventListener("unhandledrejection", (event) => {
  if (!isStaleBuildError(event.reason)) return;
  announceUpdateAvailable();
  event.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);
