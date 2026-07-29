export function getOptionalEnv(key: string): string | undefined {
  return (import.meta.env as Record<string, string | undefined>)[key];
}

/**
 * Cada entrada es un grupo de nombres alternativos: alcanza con que uno esté.
 * La clave anónima de Supabase pasó a llamarse "publishable" y los dos nombres
 * conviven entre el .env local y el workflow de CI.
 */
const REQUIRED_VARS: readonly (readonly string[])[] = [
  ["VITE_SUPABASE_URL"],
  ["VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"],
];

export function validateEnv(): void {
  const missing = REQUIRED_VARS
    .filter(group => !group.some(key => import.meta.env[key]))
    .map(group => group.join(" o "));

  if (missing.length > 0) {
    const msg = [
      "Variables de entorno requeridas no encontradas:",
      ...missing.map((k) => `  - ${k}`),
      "",
      "Copiá .env.example a .env y completá los valores.",
    ].join("\n");

    // Show error in DOM so it's visible even without console
    if (typeof document !== "undefined") {
      document.body.innerHTML = `<pre style="padding:2rem;font-family:monospace;color:#c00;background:#fff">${msg}</pre>`;
    }
    throw new Error(msg);
  }
}
