/**
 * Adónde lleva un aviso de la campana (2026-10-15). Los resúmenes de alertas
 * guardan `entity_type = 'ruta'` y la pantalla donde se resuelven; antes tocar
 * un aviso sólo lo marcaba leído. Sólo rutas internas del panel.
 */
export function rutaDelAviso(n: { entity_type?: string | null; entity_id?: string | null }): string | null {
  return n.entity_type === "ruta" && typeof n.entity_id === "string" && /^\/[a-z]/.test(n.entity_id) ? n.entity_id : null;
}
