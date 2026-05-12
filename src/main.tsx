import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSentry } from "./lib/sentry";
import { validateEnv } from "./lib/env";
import { setupServiceWorkerUpdates } from "./lib/swUpdate";

validateEnv();
initSentry();
setupServiceWorkerUpdates();

// When Vite deploys a new build, old cached chunk hashes disappear.
// Catch dynamic import failures and force a full reload so the SW picks up the new build.
window.addEventListener("unhandledrejection", (event) => {
  const msg = event?.reason?.message ?? "";
  if (msg.includes("Failed to fetch dynamically imported module") || msg.includes("Importing a module script failed")) {
    event.preventDefault();
    window.location.reload();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
