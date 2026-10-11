// Búsquedas de la tienda sin resultado (migración 20261011000500). La tienda
// las registra; el comercio ve qué le piden y no tiene. Sin datos del
// visitante: sólo el término normalizado y un contador por día.

/** Lo mismo que hace la base (texto_catalogo): para no mandar lo que va a descartar. */
export function terminoNormalizado(texto: string): string | null {
  const t = (texto ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 60);
  return t.length >= 2 ? t : null;
}

/** Decide si registrar: hay término, no hubo resultados y no se mandó antes en la visita. */
export function debeRegistrar(termino: string, resultados: number, yaEnviados: Set<string>): string | null {
  const t = terminoNormalizado(termino);
  if (!t || resultados > 0 || yaEnviados.has(t)) return null;
  return t;
}

/** Lo mismo para una búsqueda que sí encontró algo (analítica, migración 20261011000700). */
export function debeRegistrarConResultados(termino: string, resultados: number, yaEnviados: Set<string>): string | null {
  const t = terminoNormalizado(termino);
  if (!t || resultados === 0 || yaEnviados.has(t)) return null;
  return t;
}

export interface FilaBusqueda {
  termino: string;
  veces: number;
}

/** Suma por término (las filas vienen por día) y ordena de más a menos buscado. */
export function topBusquedas(filas: FilaBusqueda[], limite = 10): FilaBusqueda[] {
  const total = new Map<string, number>();
  for (const f of filas) total.set(f.termino, (total.get(f.termino) ?? 0) + (Number(f.veces) || 0));
  return [...total.entries()]
    .map(([termino, veces]) => ({ termino, veces }))
    .sort((a, b) => b.veces - a.veces || a.termino.localeCompare(b.termino))
    .slice(0, limite);
}

export interface SinonimoDeBusqueda {
  termino: string;
  product_id: string;
}

/**
 * Productos que un sinónimo trae para esta búsqueda (migración
 * 20261011000600): coincide si todas las palabras de uno están en el otro
 * («amoladora» trae lo vinculado a «amoladora angular» y viceversa).
 */
export function productosPorSinonimo(q: string, sinonimos: SinonimoDeBusqueda[]): Set<string> {
  const busqueda = terminoNormalizado(q);
  const ids = new Set<string>();
  if (!busqueda) return ids;
  const palabras = busqueda.split(" ");
  for (const s of sinonimos) {
    const delSinonimo = (terminoNormalizado(s.termino) ?? "").split(" ").filter(Boolean);
    if (delSinonimo.length === 0) continue;
    const todasEnSinonimo = palabras.every(p => delSinonimo.includes(p));
    const todasEnBusqueda = delSinonimo.every(p => palabras.includes(p));
    if (todasEnSinonimo || todasEnBusqueda) ids.add(s.product_id);
  }
  return ids;
}

export interface FilaBusquedaConResultado {
  termino: string;
  veces: number;
  con_clic: number;
  /** Migración 20261011001100; falta en filas leídas antes de aplicarla. */
  con_pedido?: number;
}

export interface ResumenDeBusquedas {
  total: number;
  sinResultado: number;
  /** Porcentaje de búsquedas que no encontraron nada (null sin búsquedas). */
  pctSinResultado: number | null;
  /** De las que encontraron algo, porcentaje que terminó en abrir un producto. */
  pctConClic: number | null;
  /** De las que encontraron algo, porcentaje que terminó en un pedido. */
  pctConPedido: number | null;
  top: FilaBusquedaConResultado[];
}

/** Lo que más buscan y cuánto les sirve la búsqueda (las filas vienen por día). */
export function resumenDeBusquedas(
  conResultado: FilaBusquedaConResultado[], sinResultado: FilaBusqueda[], limite = 10,
): ResumenDeBusquedas {
  const porTermino = new Map<string, FilaBusquedaConResultado>();
  for (const f of conResultado) {
    const a = porTermino.get(f.termino) ?? { termino: f.termino, veces: 0, con_clic: 0, con_pedido: 0 };
    a.veces += Number(f.veces) || 0;
    a.con_clic += Number(f.con_clic) || 0;
    a.con_pedido = (a.con_pedido ?? 0) + (Number(f.con_pedido) || 0);
    porTermino.set(f.termino, a);
  }
  const filas = [...porTermino.values()];
  const conRes = filas.reduce((n, f) => n + f.veces, 0);
  const clics = filas.reduce((n, f) => n + Math.min(f.con_clic, f.veces), 0);
  const pedidos = filas.reduce((n, f) => n + Math.min(f.con_pedido ?? 0, f.veces), 0);
  const sin = sinResultado.reduce((n, f) => n + (Number(f.veces) || 0), 0);
  const total = conRes + sin;
  return {
    total,
    sinResultado: sin,
    pctSinResultado: total > 0 ? Math.round((sin / total) * 100) : null,
    pctConClic: conRes > 0 ? Math.round((clics / conRes) * 100) : null,
    pctConPedido: conRes > 0 ? Math.round((pedidos / conRes) * 100) : null,
    top: filas.sort((a, b) => b.veces - a.veces || a.termino.localeCompare(b.termino)).slice(0, limite),
  };
}

export interface AvisoDeBusqueda {
  id: string;
  termino: string;
  email: string;
  created_at: string;
}

/** Pedidos de aviso agrupados por término, el más pedido primero (migración 20261011000800). */
export function avisosPorTermino(avisos: AvisoDeBusqueda[]): { termino: string; emails: string[]; ids: string[] }[] {
  const grupos = new Map<string, { termino: string; emails: string[]; ids: string[] }>();
  for (const a of avisos) {
    const g = grupos.get(a.termino) ?? { termino: a.termino, emails: [], ids: [] };
    if (!g.emails.includes(a.email)) g.emails.push(a.email);
    g.ids.push(a.id);
    grupos.set(a.termino, g);
  }
  return [...grupos.values()].sort((a, b) => b.emails.length - a.emails.length || a.termino.localeCompare(b.termino));
}

/**
 * Términos con los que el cliente abrió un producto en esta visita (migración
 * 20261011001100). Viven sólo en `sessionStorage` del navegador: al crear el
 * pedido se mandan una vez y se borran. Nunca rompe: sin almacenamiento, no
 * se cuenta.
 */
const claveTerminos = (slug: string) => `nerqia.busquedas-abiertas.${slug}`;
export const MAX_TERMINOS_POR_PEDIDO = 10;

export function anotarBusquedaQueAbrio(slug: string, termino: string, almacen: Storage | null = sesion()): void {
  if (!almacen) return;
  try {
    const actuales = leerTerminos(slug, almacen);
    if (actuales.includes(termino)) return;
    almacen.setItem(claveTerminos(slug), JSON.stringify([...actuales, termino].slice(-MAX_TERMINOS_POR_PEDIDO)));
  } catch {
    // Almacenamiento lleno o bloqueado: no se cuenta.
  }
}

/** Devuelve los términos de la visita y los borra (se mandan una sola vez). */
export function tomarBusquedasQueAbrieron(slug: string, almacen: Storage | null = sesion()): string[] {
  if (!almacen) return [];
  try {
    const t = leerTerminos(slug, almacen);
    almacen.removeItem(claveTerminos(slug));
    return t;
  } catch {
    return [];
  }
}

function leerTerminos(slug: string, almacen: Storage): string[] {
  try {
    const v = JSON.parse(almacen.getItem(claveTerminos(slug)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function sesion(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
