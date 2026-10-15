/** Rutas públicas que no dependen de la organización del panel (2026-10-15). */
export function esRutaPublica(pathname: string): boolean {
  return /^\/(tienda|pagar|catalogo|influencer|invitacion|invitacion-creador|aceptar-contrato)\//.test(pathname);
}
