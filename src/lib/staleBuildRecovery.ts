import { hardReload } from "@/lib/hardReload";

const STALE_BUILD_ERROR_MARKERS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
  "Loading chunk",
  "ChunkLoadError",
  "Expected a JavaScript-or-Wasm module script",
  "MIME type of \"text/html\"",
];

export function isStaleBuildError(error: unknown): boolean {
  const message = typeof error === "string"
    ? error
    : String((error as { message?: unknown } | null)?.message ?? "");

  return STALE_BUILD_ERROR_MARKERS.some(marker => message.includes(marker));
}

/** Salida explícita del fallback: el gesto del usuario autoriza otro intento. */
export function forceStaleBuildRecovery() {
  void hardReload();
}
