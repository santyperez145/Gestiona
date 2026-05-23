/**
 * usePWAInstall — Captures the browser's beforeinstallprompt event and
 * exposes a prompt() function to trigger the native install dialog.
 *
 * Usage:
 *   const { canInstall, install, dismissed } = usePWAInstall();
 *   {canInstall && <button onClick={install}>Instalar app</button>}
 */
import { useCallback, useEffect, useState } from "react";

const DISMISSED_KEY = "pwa_install_dismissed";

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissed, setDismissedState] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    // Check if already installed (standalone mode)
    const mq = window.matchMedia("(display-mode: standalone)");
    if (mq.matches) { setIsInstalled(true); return; }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Listen for app installed
    const installed = () => { setIsInstalled(true); setCanInstall(false); };
    window.addEventListener("appinstalled", installed);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setCanInstall(false);
    return outcome === "accepted";
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setDismissedState(true);
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* ignore */ }
  }, []);

  return {
    /** Whether install can be triggered right now */
    canInstall: canInstall && !dismissed,
    /** Whether the app is already installed (standalone) */
    isInstalled,
    /** Whether user previously dismissed the prompt */
    dismissed,
    /** Trigger the native install dialog */
    install,
    /** Dismiss and remember the choice */
    dismiss,
  };
}
