// Primer contacto de quien después da de alta un comercio (migración
// 20261010002200, `origen_de_alta`). TESIS §6 y E4: saber si un comercio
// llegó referido por otro comercio, por un influencer, por una campaña o
// directo. Se guarda el PRIMER contacto y no se pisa: el que trajo al
// comercio es el primero, no el último anuncio que vio.
//
// 📌 Sólo datos de marketing (código, utm, sitio de origen, página de
// entrada). Nada personal; la base recorta y valida todo de nuevo.

import { BRAND_ORIGIN } from "@/lib/brand";

export const CLAVE_ORIGEN = "nerqia.origen_de_alta";

export interface OrigenDeAlta {
  ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  sitio_origen?: string;
  pagina_entrada?: string;
  primer_contacto_at: string;
}

type Almacen = Pick<Storage, "getItem" | "setItem">;

const recortar = (valor: string | null, max: number) => {
  // Sin caracteres de control (códigos 0–31 y 127).
  const limpio = [...(valor ?? "")].filter(c => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127).join("").trim();
  return limpio ? limpio.slice(0, max) : undefined;
};

/** Lee el primer contacto de la URL y el sitio de origen; sin señales, null. */
export function leerContacto(url: string, referrer: string, ahora: Date): OrigenDeAlta | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const q = parsed.searchParams;
  let sitio: string | undefined;
  try {
    const host = referrer ? new URL(referrer).hostname.toLowerCase() : "";
    // El propio dominio no es un origen: es navegación interna.
    if (host && host !== parsed.hostname.toLowerCase()) sitio = recortar(host, 200);
  } catch { sitio = undefined; }
  const origen: OrigenDeAlta = {
    ref: recortar(q.get("ref"), 80)?.toLowerCase(),
    utm_source: recortar(q.get("utm_source"), 120),
    utm_medium: recortar(q.get("utm_medium"), 120),
    utm_campaign: recortar(q.get("utm_campaign"), 120),
    sitio_origen: sitio,
    pagina_entrada: recortar(parsed.pathname, 200),
    primer_contacto_at: ahora.toISOString(),
  };
  const tieneSenal = origen.ref || origen.utm_source || origen.utm_campaign || origen.sitio_origen;
  if (!tieneSenal) return null;
  return Object.fromEntries(Object.entries(origen).filter(([, v]) => v !== undefined)) as unknown as OrigenDeAlta;
}

/** Guarda el contacto sólo si todavía no hay uno (primer contacto). */
export function capturarPrimerContacto(url: string, referrer: string, almacen: Almacen | null, ahora = new Date()): void {
  if (!almacen) return;
  try {
    if (almacen.getItem(CLAVE_ORIGEN)) return;
    const origen = leerContacto(url, referrer, ahora);
    if (origen) almacen.setItem(CLAVE_ORIGEN, JSON.stringify(origen));
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): el alta sigue como «directo».
  }
}

/** Lo que viaja en el alta del comercio; null si no hubo contacto medible. */
export function origenParaAlta(almacen: Almacen | null): OrigenDeAlta | null {
  if (!almacen) return null;
  try {
    const raw = almacen.getItem(CLAVE_ORIGEN);
    if (!raw) return null;
    const data = JSON.parse(raw) as OrigenDeAlta;
    return data && typeof data === "object" && typeof data.primer_contacto_at === "string" ? data : null;
  } catch {
    return null;
  }
}

export function almacenLocal(): Almacen | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

/** Fila de `origen_de_alta` (lectura de Platform). */
export interface OrigenFila {
  org_id: string;
  canal: "comercio" | "influencer" | "codigo" | "campania" | "sitio" | "directo";
  codigo: string | null;
  utm_campaign: string | null;
  utm_source: string | null;
  sitio_origen: string | null;
  referido_por_org: string | null;
}

/** «Referido por Ferretería X», «Campaña otoño», «Directo»… */
export function describirOrigen(o: OrigenFila | undefined, nombres: Map<string, string>): string {
  if (!o) return "Sin dato (alta anterior a la medición)";
  const referente = o.referido_por_org ? nombres.get(o.referido_por_org) ?? "otro comercio" : null;
  switch (o.canal) {
    case "comercio": return `Referido por ${referente}`;
    case "influencer": return `Influencer de ${referente}${o.codigo ? ` (${o.codigo})` : ""}`;
    case "codigo": return `Código ${o.codigo} (sin dueño)`;
    case "campania": return `Campaña ${o.utm_campaign ?? o.utm_source ?? ""}`.trim();
    case "sitio": return `Desde ${o.sitio_origen}`;
    default: return "Directo";
  }
}

/** Enlace del sello «Hecha con Nerqia»: la landing con el ref del comercio. */
export function enlaceSelloNerqia(ref: string, origin = BRAND_ORIGIN): string {
  const url = new URL("/", origin);
  url.searchParams.set("ref", ref.trim().toLowerCase());
  url.searchParams.set("utm_source", "tienda");
  url.searchParams.set("utm_medium", "sello");
  return url.toString();
}
