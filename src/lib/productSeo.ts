/**
 * Reglas del SEO de producto (2026-10-30, migración 20261030000600): cuánto
 * muestra Google antes de cortar y cómo se ve el recorte en la vista previa.
 */

/** Lo que Google suele mostrar antes de cortar con «…». */
export const SEO_TITULO_VISIBLE = 60;
export const SEO_DESCRIPCION_VISIBLE = 160;

export function recorteSeo(texto: string, visible: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > visible ? `${limpio.slice(0, visible - 1).trimEnd()}…` : limpio;
}
