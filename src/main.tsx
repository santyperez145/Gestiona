import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSentry } from "./lib/sentry";
import { validateEnv } from "./lib/env";
import { setupServiceWorkerUpdates } from "./lib/swUpdate";
import { isStaleBuildError, recoverFromStaleBuild } from "./lib/staleBuildRecovery";

validateEnv();
initSentry();
setupServiceWorkerUpdates();

// Cuando Vite despliega, los hashes anteriores desaparecen. El evento propio
// de Vite ocurre antes de que el error llegue a React; limpiamos SW + caches y
// evitamos que el error derribe la ruta mientras empieza la recarga.
window.addEventListener("vite:preloadError", (event) => {
  const preloadError = event as Event & { payload?: unknown };
  if (!isStaleBuildError(preloadError.payload)) return;
  if (recoverFromStaleBuild()) event.preventDefault();
});

// Fallback para navegadores/versiones donde el fallo sólo aparece como una
// promesa rechazada. Una recarga común no basta: debe limpiar el SW viejo.
window.addEventListener("unhandledrejection", (event) => {
  if (isStaleBuildError(event.reason) && recoverFromStaleBuild()) {
    event.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
