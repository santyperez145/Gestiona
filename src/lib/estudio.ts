/**
 * Portal del contador (2026-10-30): el enlace de invitación y la vuelta al
 * portal después de entrar.
 *
 * Quien abre el enlace sin sesión deja el token en este navegador y entra:
 * el login lo devuelve a /estudio (no al alta de un negocio, que un contador
 * no necesita) y ahí se acepta.
 */
const CLAVE = "nerqia.estudio.invitacion";

export function enlaceDeInvitacion(token: string, origen = typeof window !== "undefined" ? window.location.origin : "https://nerqia.app"): string {
  return `${origen}/estudio?invitacion=${encodeURIComponent(token)}`;
}

export function guardarInvitacionPendiente(token: string) {
  try { localStorage.setItem(CLAVE, token); } catch { /* sin almacenamiento: se acepta igual desde el enlace */ }
}

export function invitacionPendiente(): string | null {
  try { return localStorage.getItem(CLAVE); } catch { return null; }
}

export function olvidarInvitacionPendiente() {
  try { localStorage.removeItem(CLAVE); } catch { /* nada que limpiar */ }
}

/** A dónde va quien acaba de entrar: al portal si venía de una invitación. */
export function destinoDespuesDelLogin(): "/" | "/estudio" {
  return invitacionPendiente() ? "/estudio" : "/";
}
