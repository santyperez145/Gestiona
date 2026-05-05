const REQUIRED_VARS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter(
    (key) => !import.meta.env[key]
  );

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
