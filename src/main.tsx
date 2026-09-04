import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSentry } from "./lib/sentry";
import { validateEnv } from "./lib/env";
import { announceUpdateAvailable, setupServiceWorkerUpdates } from "./lib/swUpdate";
import { isStaleBuildError } from "./lib/staleBuildRecovery";

validateEnv();
initSentry();
setupServiceWorkerUpdates();

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
