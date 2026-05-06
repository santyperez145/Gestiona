import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initSentry } from "./lib/sentry";
import { validateEnv } from "./lib/env";

validateEnv();
initSentry();

createRoot(document.getElementById("root")!).render(<App />);
