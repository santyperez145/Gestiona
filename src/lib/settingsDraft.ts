/**
 * Borrador de Ajustes: qué cambió, en qué sección, y cómo no perderlo.
 *
 * ── El problema que resuelve ─────────────────────────────────────────────
 *
 * Hasta 2026-10-09 la página tenía UN botón que guardaba todo, y vivía en la
 * pestaña Finanzas. En Tienda se editaba nombre, logo, pie de ticket, colores,
 * WhatsApp y CBU; en Impuestos, el IVA. Ninguna de las dos tenía con qué
 * guardar, y el encabezado decía «Cambios guardados por sección». Quien
 * cambiaba el logo y se iba lo perdía sin aviso.
 *
 * Ahora la página compara lo que se ve con lo último guardado, campo por
 * campo, y una barra fija ofrece guardar o descartar desde cualquier pestaña.
 *
 * ── Por qué sessionStorage ───────────────────────────────────────────────
 *
 * La app usa `<BrowserRouter>`, que no tiene `useBlocker`: no se puede frenar
 * un click en el menú lateral. `beforeunload` cubre cerrar la pestaña o
 * recargar; para la navegación interna el borrador queda guardado en la
 * pestaña y, al volver, la página ofrece recuperarlo. Es por pestaña a
 * propósito: un borrador viejo de otra sesión no tiene que aparecer en otra
 * computadora.
 */

/** Columnas de `settings` tal como se mandan a `saveSettingsDB`. */
export type BorradorAjustes = Record<string, unknown>;

export type SeccionAjustes =
  | 'brand'
  | 'finance'
  | 'pricing'
  | 'messaging'
  | 'inventory'
  | 'billing'
  | 'system';

/**
 * A qué pestaña pertenece cada columna. Un campo que no esté acá igual cuenta
 * como cambio —sin sección— para que olvidarse de mapearlo no esconda un
 * cambio sin guardar.
 */
export const SECCION_DE_CAMPO: Record<string, SeccionAjustes> = {
  business_name: 'brand',
  logo_url: 'brand',
  receipt_footer: 'brand',
  catalog_bg_color: 'brand',
  catalog_card_color: 'brand',
  catalog_accent_color: 'brand',
  brand_palettes: 'brand',

  exchange_rate: 'finance',
  customs_percent: 'finance',
  default_discount_percent: 'finance',
  category_pricing: 'finance',
  bank_cbu: 'finance',
  bank_alias: 'finance',
  bank_name: 'finance',
  bank_holder: 'finance',

  discount_cash_percent: 'pricing',
  discount_transfer_percent: 'pricing',
  discount_debit_percent: 'pricing',
  discount_credit_percent: 'pricing',
  volume_discount_threshold: 'pricing',
  volume_discount_percent: 'pricing',

  whatsapp_number: 'messaging',
  whatsapp_digest_enabled: 'messaging',
  whatsapp_birthday_enabled: 'messaging',

  costo_por_pedido: 'inventory',
  costo_almacenamiento_anual_pct: 'inventory',
  stock_dormido_days: 'inventory',
  max_overstock_units: 'inventory',
  max_ai_discount_percent: 'inventory',
  ai_tone: 'inventory',

  tax_enabled: 'billing',
  tax_iva_percent: 'billing',
  tax_prices_include_iva: 'billing',
  tax_iibb_percent: 'billing',
  tax_monotributo_monthly: 'billing',
  fiscal_id_required_above: 'billing',

  mfa_required: 'system',
  perfil_menu: 'system',
};

/**
 * JSON con las claves ordenadas: `{a,b}` y `{b,a}` son el mismo valor. Sin
 * esto `category_pricing` aparecía «cambiado» con sólo releerlo de la base.
 */
function estable(valor: unknown): string {
  if (valor === undefined) return 'null';
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(estable).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort()
    .map(k => `${JSON.stringify(k)}:${estable(obj[k])}`)
    .join(',')}}`;
}

/** Columnas cuyo valor difiere entre lo guardado y lo que muestra la página. */
export function camposCambiados(base: BorradorAjustes | null, actual: BorradorAjustes): string[] {
  if (!base) return [];
  const claves = new Set([...Object.keys(base), ...Object.keys(actual)]);
  return [...claves].filter(k => estable(base[k]) !== estable(actual[k])).sort();
}

/** Pestañas con algo sin guardar, en el orden en que aparecen las columnas. */
export function seccionesConCambios(campos: string[]): SeccionAjustes[] {
  const vistas = new Set<SeccionAjustes>();
  for (const campo of campos) {
    const seccion = SECCION_DE_CAMPO[campo];
    if (seccion) vistas.add(seccion);
  }
  return [...vistas];
}

/** Sólo las columnas que cambiaron, para mandar un update chico y auditable. */
export function soloCambios(actual: BorradorAjustes, campos: string[]): BorradorAjustes {
  return Object.fromEntries(campos.filter(k => k in actual).map(k => [k, actual[k]]));
}

const PREFIJO = 'nerqia.ajustes.borrador';

export function claveBorrador(orgId: string | null | undefined): string | null {
  return orgId ? `${PREFIJO}.${orgId}` : null;
}

// sessionStorage puede no existir o tirar (modo privado, cuota, iframe con
// storage bloqueado). Perder el borrador es aceptable; romper la página, no.
export function leerBorrador(clave: string | null): BorradorAjustes | null {
  if (!clave) return null;
  try {
    const crudo = window.sessionStorage.getItem(clave);
    if (!crudo) return null;
    const valor = JSON.parse(crudo);
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as BorradorAjustes : null;
  } catch {
    return null;
  }
}

export function guardarBorrador(clave: string | null, borrador: BorradorAjustes): void {
  if (!clave) return;
  try { window.sessionStorage.setItem(clave, JSON.stringify(borrador)); } catch { /* ver arriba */ }
}

export function borrarBorrador(clave: string | null): void {
  if (!clave) return;
  try { window.sessionStorage.removeItem(clave); } catch { /* ver arriba */ }
}
