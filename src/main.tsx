import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSentry } from "./lib/sentry";
import { validateEnv } from "./lib/env";
import { setupServiceWorkerUpdates } from "./lib/swUpdate";

validateEnv();
initSentry();
setupServiceWorkerUpdates();

createRoot(document.getElementById("root")!).render(<App />);
