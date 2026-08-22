import { hardReload } from "@/lib/hardReload";

const STALE_BUILD_RECOVERY_KEY = "stale_build_recovery_at";

/**
 * Una segunda recuperación dentro de esta ventana probablemente sea un loop.
 * Pasado el límite, otro deploy legítimo puede volver a recuperarse en la
 * misma pestaña sin quedar bloqueado por toda la sesión.
 */
export const STALE_BUILD_LOOP_WINDOW_MS = 15_000;

const STALE_BUILD_ERROR_MARKERS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
  "Loading chunk",
  "ChunkLoadError",
  "Expected a JavaScript-or-Wasm module script",
  "MIME type of \"text/html\"",
];

let recoveryInFlight = false;

export function isStaleBuildError(error: unknown): boolean {
  const message = typeof error === "string"
    ? error
    : String((error as { message?: unknown } | null)?.message ?? "");

  return STALE_BUILD_ERROR_MARKERS.some(marker => message.includes(marker));
}

export function shouldRecoverStaleBuild(lastRecoveryAt: number | null, now: number): boolean {
  if (lastRecoveryAt === null || !Number.isFinite(lastRecoveryAt)) return true;
  return now - lastRecoveryAt >= STALE_BUILD_LOOP_WINDOW_MS;
}

function readLastRecoveryAt(): number | null {
  try {
    const raw = sessionStorage.getItem(STALE_BUILD_RECOVERY_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

function markRecovery(now: number) {
  try { sessionStorage.setItem(STALE_BUILD_RECOVERY_KEY, String(now)); } catch { /* modo privado */ }
}

/**
 * Limpia caches + service worker y recarga una sola vez por incidente.
 * Devuelve false cuando la ventana anti-loop pide mostrar la salida manual.
 */
export function recoverFromStaleBuild(): boolean {
  if (typeof window === "undefined") return false;
  if (recoveryInFlight) return true;

  const now = Date.now();
  if (!shouldRecoverStaleBuild(readLastRecoveryAt(), now)) return false;

  recoveryInFlight = true;
  markRecovery(now);
  void hardReload();
  return true;
}

/** Salida explícita del fallback: el gesto del usuario autoriza otro intento. */
export function forceStaleBuildRecovery() {
  try { sessionStorage.removeItem(STALE_BUILD_RECOVERY_KEY); } catch { /* modo privado */ }
  recoveryInFlight = false;
  recoverFromStaleBuild();
}

