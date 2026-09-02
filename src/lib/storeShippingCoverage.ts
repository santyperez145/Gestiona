/**
 * Cobertura de envío a domicilio, para no prometer el país entero.
 *
 * Medido 2026-09-02: Exentry tiene 6 zonas y tarifa en una (CABA). Con retiro
 * activo el checkout parece nacional: 23 provincias sólo pueden ir a buscarlo.
 * Shopify y Tiendanube muestran el método después de la ubicación; acá el
 * selector tiene que decir qué provincia no tiene domicilio.
 */

import { AR_PROVINCES, PROVINCE_NAME } from "@/lib/shippingCalc";

const VALIDOS = new Set(AR_PROVINCES.map((p) => p.code));

export const PROVINCE_SHORT: Record<string, string> = {
  "AR-C": "CABA",
  "AR-B": "Buenos Aires",
};

export function provinciasConEnvio(codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of codes) {
    const code = String(raw ?? "").trim();
    if (!VALIDOS.has(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out.sort();
}

export function nombreProvinciaCorto(code: string): string {
  return PROVINCE_SHORT[code] ?? PROVINCE_NAME[code] ?? code;
}

export function provinciaTieneDomicilio(
  code: string,
  shippingProvinces: string[] | null | undefined,
): boolean | null {
  if (shippingProvinces == null) return null;
  return shippingProvinces.includes(code);
}

/** Texto honesto de cobertura. null = no hay domicilio en ninguna zona. */
export function textoCoberturaDomicilio(shippingProvinces: string[] | null | undefined): string | null {
  if (shippingProvinces == null) return null;
  const codes = provinciasConEnvio(shippingProvinces);
  if (codes.length === 0) return null;
  if (codes.length >= AR_PROVINCES.length) return "Envíos a todo el país";
  if (codes.length === 1) return `Envío a domicilio en ${nombreProvinciaCorto(codes[0])}`;
  if (codes.length <= 3) {
    return `Envío a domicilio en ${codes.map(nombreProvinciaCorto).join(", ")}`;
  }
  return `Envío a domicilio en ${codes.length} provincias`;
}

export function etiquetaProvinciaCheckout(
  code: string,
  name: string,
  shippingProvinces: string[] | null | undefined,
): string {
  const tiene = provinciaTieneDomicilio(code, shippingProvinces);
  if (tiene === false) return `${name} — sin envío a domicilio`;
  return name;
}

/**
 * Anuncio automático. Sin cobertura conocida no se inventa un envío nacional.
 * Un umbral de $150.000 sólo aplica donde hay tarifario.
 */
export function textoAnuncioEnvioAutomatico(opts: {
  freeShippingAbove?: number | null;
  fmt?: (n: number) => string;
  shippingProvinces?: string[] | null;
}): string | null {
  if (opts.shippingProvinces == null) return null;
  const cobertura = textoCoberturaDomicilio(opts.shippingProvinces);
  if (!cobertura) return null;
  const umbral = Number(opts.freeShippingAbove ?? 0);
  if (umbral > 0 && opts.fmt) {
    if (opts.shippingProvinces.length >= AR_PROVINCES.length) {
      return `Envío gratis desde ${opts.fmt(umbral)}`;
    }
    return `Envío gratis desde ${opts.fmt(umbral)} · ${cobertura}`;
  }
  return cobertura;
}
