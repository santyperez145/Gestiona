/**
 * Portada de la tienda como bloques ordenables y configurables.
 *
 * Tiendanube/Shopify dejan elegir, ordenar y configurar los bloques de Inicio
 * (título propio, cuántos productos mostrar). No copiamos su editor en vivo ni
 * un theme engine: el comercio arma la misma composición desde Diseño, y vacío
 * significa "armalo solo", igual que `nav_links`.
 */

import { textoAnuncioEnvioAutomatico } from "@/lib/storeShippingCoverage";

export const HOME_SECTION_IDS = [
  "banners",
  "hero",
  "trust",
  "porque",
  "vistos",
  "categories",
  "ofertas",
  "destacados",
  "novedades",
] as const;

export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

export type HomeSection = {
  id: HomeSectionId;
  enabled: boolean;
  /** Título custom del bloque (Shopify sections). undefined = genérico. */
  title?: string;
  /** Cuántos ítems muestra la vitrina. undefined/default = 8. */
  limit?: number;
  /** Colección (slug de categoría) que filtra la vitrina del bloque. */
  collection?: string;
};

export type StorefrontLayout = {
  announcement: { enabled: boolean; text: string };
  sections: HomeSection[];
};

export const HOME_SECTION_LABELS: Record<HomeSectionId, string> = {
  banners: "Banners",
  hero: "Portada",
  trust: "Barra de confianza",
  porque: "Porque compraste",
  vistos: "Vistos recientemente",
  categories: "Categorías",
  ofertas: "Ofertas",
  destacados: "Destacados",
  novedades: "Novedades",
};

export const DEFAULT_STOREFRONT_LAYOUT: StorefrontLayout = {
  announcement: { enabled: true, text: "" },
  sections: HOME_SECTION_IDS.map((id) => ({ id, enabled: true })),
};

const IDS = new Set<string>(HOME_SECTION_IDS);

/** Bloques con vitrina de productos: los únicos que aceptan límite. */
export const HOME_SECTIONS_WITH_LIMIT: ReadonlySet<HomeSectionId> = new Set([
  "porque", "vistos", "ofertas", "destacados", "novedades",
]);

/** Bloques que pueden filtrarse por una colección concreta (Shopify collection). */
export const HOME_SECTIONS_WITH_COLLECTION: ReadonlySet<HomeSectionId> = new Set([
  "destacados", "novedades",
]);

/** Bloques cuyo título se muestra al comprador y por eso se puede cambiar. */
export const HOME_SECTIONS_WITH_TITLE: ReadonlySet<HomeSectionId> = new Set([
  "porque", "vistos", "categories", "ofertas", "destacados", "novedades",
]);

/** Límites razonables: 3 para que la fila no se vuelva un feed infinito. */
export const HOME_SECTION_LIMIT_MIN = 3;
export const HOME_SECTION_LIMIT_MAX = 12;
export const HOME_SECTION_LIMIT_DEFAULT = 8;

function textoLimpio(raw: unknown, max = 140): string {
  return String(raw ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function esLayoutCrudo(raw: unknown): raw is Record<string, unknown> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length > 0;
}

/** ¿El comercio guardó una composición, o hay que armarla sola? */
export function layoutEsPersonalizado(raw: unknown): boolean {
  return esLayoutCrudo(raw);
}

/** Límite guardado, acotado. Fuera de rango o basura = default. */
export function limiteDeSeccion(s: Pick<HomeSection, "id"> & Partial<HomeSection>, raw?: unknown): number {
  void s;
  const n = Number(raw);
  if (!Number.isFinite(n)) return HOME_SECTION_LIMIT_DEFAULT;
  return Math.min(HOME_SECTION_LIMIT_MAX, Math.max(HOME_SECTION_LIMIT_MIN, Math.round(n)));
}

/** Slug de colección guardado, saneado. Vacío, no-string o basura = sin filtro. */
export function coleccionDeSeccion(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const slug = raw.trim().toLowerCase();
  if (!slug || !/^[a-z0-9][a-z0-9_-]{0,80}$/.test(slug)) return undefined;
  return slug;
}

export function parseStorefrontLayout(raw: unknown): StorefrontLayout {
  if (!esLayoutCrudo(raw)) return { ...DEFAULT_STOREFRONT_LAYOUT, sections: [...DEFAULT_STOREFRONT_LAYOUT.sections] };

  const anuncio = raw.announcement && typeof raw.announcement === "object" && !Array.isArray(raw.announcement)
    ? raw.announcement as Record<string, unknown>
    : {};

  const vistos = new Set<HomeSectionId>();
  const sections: HomeSection[] = [];
  const lista = Array.isArray(raw.sections) ? raw.sections : [];
  for (const item of lista) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = String((item as { id?: unknown }).id ?? "");
    if (!IDS.has(id) || vistos.has(id as HomeSectionId)) continue;
    const sid = id as HomeSectionId;
    vistos.add(sid);
    sections.push({
      id: sid,
      enabled: (item as { enabled?: unknown }).enabled !== false,
      // Config por bloque: título propio, límite de ítems y colección (Shopify sections).
      title: textoLimpio((item as { title?: unknown }).title, 60) || undefined,
      limit: limiteDeSeccion({ id: sid }, (item as { limit?: unknown }).limit),
      collection: HOME_SECTIONS_WITH_COLLECTION.has(sid)
        ? coleccionDeSeccion((item as { collection?: unknown }).collection)
        : undefined,
    });
  }
  for (const id of HOME_SECTION_IDS) {
    if (vistos.has(id)) continue;
    sections.push({ id, enabled: true });
  }

  return {
    announcement: {
      enabled: anuncio.enabled !== false,
      text: textoLimpio(anuncio.text),
    },
    sections,
  };
}

export function moverSeccion(sections: HomeSection[], id: HomeSectionId, dir: -1 | 1): HomeSection[] {
  const i = sections.findIndex((s) => s.id === id);
  if (i < 0) return sections;
  const j = i + dir;
  if (j < 0 || j >= sections.length) return sections;
  const next = [...sections];
  const tmp = next[i];
  next[i] = next[j];
  next[j] = tmp;
  return next;
}

/** Defaults de comparación: un bloque sin título custom usa el genérico. */
function seccionDefault(id: HomeSectionId): HomeSection {
  return { id, enabled: true, title: undefined, limit: HOME_SECTION_LIMIT_DEFAULT, collection: undefined };
}

export function layoutsIguales(a: StorefrontLayout, b: StorefrontLayout): boolean {
  if (a.announcement.enabled !== b.announcement.enabled) return false;
  if (a.announcement.text !== b.announcement.text) return false;
  if (a.sections.length !== b.sections.length) return false;
  return a.sections.every((s, i) => {
    const o = b.sections[i];
    if (!o || s.id !== o.id || s.enabled !== o.enabled) return false;
    const ta = s.title ?? undefined;
    const tb = o.title ?? undefined;
    if (ta !== tb) return false;
    const la = limiteDeSeccion(s, s.limit);
    const lb = limiteDeSeccion(o, o.limit);
    if (la !== lb) return false;
    // La colección sólo cuenta en bloques que la soportan; en el resto no es
    // una diferencia real y no debe forzar a guardar el layout.
    const soporta = HOME_SECTIONS_WITH_COLLECTION.has(s.id);
    const ca = soporta ? coleccionDeSeccion(s.collection) : undefined;
    const cb = soporta ? coleccionDeSeccion(o.collection) : undefined;
    return ca === cb;
  });
}

/** null = default, para que un bloque nuevo no quede escondido para siempre. */
export function layoutParaGuardar(layout: StorefrontLayout): StorefrontLayout | null {
  return layoutsIguales(layout, DEFAULT_STOREFRONT_LAYOUT) ? null : layout;
}

export function seccionHabilitada(layout: StorefrontLayout, id: HomeSectionId): boolean {
  return layout.sections.find((s) => s.id === id)?.enabled !== false;
}

/** Título mostrable: el custom del comercio o el genérico. */
export function tituloDeSeccion(layout: StorefrontLayout, id: HomeSectionId): string {
  const custom = layout.sections.find((s) => s.id === id)?.title;
  return custom && custom.trim() ? custom.trim() : HOME_SECTION_LABELS[id];
}

/** Cuántos ítems muestra la vitrina de un bloque. */
export function limiteDeItems(layout: StorefrontLayout, id: HomeSectionId): number {
  return limiteDeSeccion({ id }, layout.sections.find((s) => s.id === id)?.limit);
}

/** Colección que filtra la vitrina del bloque, o undefined si no filtra. */
export function coleccionDeBloque(layout: StorefrontLayout, id: HomeSectionId): string | undefined {
  if (!HOME_SECTIONS_WITH_COLLECTION.has(id)) return undefined;
  return coleccionDeSeccion(layout.sections.find((s) => s.id === id)?.collection);
}

/**
 * Con el default, un banner cargado reemplaza al hero (dos bloques grandes
 * empujan el catálogo abajo del pliegue). Si el comercio personalizó, manda
 * el interruptor de cada bloque.
 */
export function heroVisible(
  layout: StorefrontLayout,
  bannerCount: number,
  personalizado: boolean,
): boolean {
  if (!seccionHabilitada(layout, "hero")) return false;
  if (!personalizado) return bannerCount === 0;
  return true;
}

export function textoDeAnuncio(
  layout: StorefrontLayout,
  opts: {
    freeShippingAbove?: number | null;
    fmt?: (n: number) => string;
    shippingProvinces?: string[] | null;
  },
): string | null {
  if (!layout.announcement.enabled) return null;
  const custom = layout.announcement.text;
  if (custom) return custom;
  return textoAnuncioEnvioAutomatico(opts);
}

export { seccionDefault };
