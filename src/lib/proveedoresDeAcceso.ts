import { getOptionalEnv } from "@/lib/env";

/**
 * ¿Está habilitado el acceso con Google en este proyecto? (2026-10-31)
 *
 * El botón «Continuar con Google» se mostraba siempre; si el proveedor no
 * estaba configurado en Supabase (docs/GOOGLE_OAUTH_SETUP.md), al tocarlo
 * respondía «no está disponible»: un error visible en la puerta de entrada.
 * Ahora se pregunta a Auth (`/auth/v1/settings`, público con la clave
 * anónima) y el botón sólo aparece si Google está habilitado. Ante cualquier
 * duda no se muestra: el acceso con email siempre está.
 */
let consulta: Promise<boolean> | null = null;

export function googleHabilitado(fetcher: typeof fetch = fetch): Promise<boolean> {
  if (consulta) return consulta;
  const url = getOptionalEnv("VITE_SUPABASE_URL");
  const clave = getOptionalEnv("VITE_SUPABASE_ANON_KEY") ?? getOptionalEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !clave) return Promise.resolve(false);
  consulta = fetcher(`${url.replace(/\/+$/, "")}/auth/v1/settings`, { headers: { apikey: clave } })
    .then(async r => (r.ok ? ((await r.json()) as { external?: Record<string, unknown> })?.external?.google === true : false))
    .catch(() => false)
    .then(habilitado => {
      // Un corte pasajero no deja el botón escondido para siempre.
      if (!habilitado) consulta = null;
      return habilitado;
    });
  return consulta;
}

/** Sólo para pruebas. */
export function olvidarProveedoresDeAcceso() {
  consulta = null;
}
