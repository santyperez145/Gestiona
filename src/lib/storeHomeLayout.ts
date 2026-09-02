/**
 * Portada de la tienda como bloques ordenables.
 *
 * Tiendanube deja elegir y ordenar los bloques de Inicio (carruseles, banners,
 * confianza). No copiamos su editor en vivo ni un theme engine: el comercio
 * arma la misma composición desde Diseño, y vacío significa "armalo solo",
 * igual que `nav_links`.
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

export type HomeSection = { id: HomeSectionId; enabled: boolean };

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

export function layoutsIguales(a: StorefrontLayout, b: StorefrontLayout): boolean {
  if (a.announcement.enabled !== b.announcement.enabled) return false;
  if (a.announcement.text !== b.announcement.text) return false;
  if (a.sections.length !== b.sections.length) return false;
  return a.sections.every((s, i) => s.id === b.sections[i].id && s.enabled === b.sections[i].enabled);
}

/** null = default, para que un bloque nuevo no quede escondido para siempre. */
export function layoutParaGuardar(layout: StorefrontLayout): StorefrontLayout | null {
  return layoutsIguales(layout, DEFAULT_STOREFRONT_LAYOUT) ? null : layout;
}

export function seccionHabilitada(layout: StorefrontLayout, id: HomeSectionId): boolean {
  return layout.sections.find((s) => s.id === id)?.enabled !== false;
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
