/**
 * Core Web Vitals de la tienda con visitas reales (migración 20261011001000).
 *
 * Se mide la página por la que entra el visitante (la carga completa, como
 * hace Google con los datos de Chrome): LCP y CLS de esa carga e INP de toda
 * la visita. Al salir (pestaña oculta o cierre) se manda una sola vez con
 * `fetch(..., { keepalive: true })`, que sobrevive al cierre de la página.
 * Sin dependencias: PerformanceObserver nativo; si el navegador no lo tiene,
 * no se mide nada. Nunca rompe la tienda: todo es best-effort.
 */
import { getOptionalEnv } from "@/lib/env";

export type PaginaDeTienda = "inicio" | "productos" | "producto" | "otra";
export type MetricaVital = "lcp" | "cls" | "inp";
export type RangoVital = "buena" | "regular" | "mala";

/** Rangos de Google; la base clasifica con los mismos (un test lo exige). */
export const LIMITES_VITALES: Record<MetricaVital, { bueno: number; malo: number }> = {
  lcp: { bueno: 2500, malo: 4000 },
  cls: { bueno: 0.1, malo: 0.25 },
  inp: { bueno: 200, malo: 500 },
};

export function clasificarVital(metrica: MetricaVital, valor: number): RangoVital {
  const l = LIMITES_VITALES[metrica];
  return valor <= l.bueno ? "buena" : valor <= l.malo ? "regular" : "mala";
}

/** Tipo de página a partir de la ruta y la base de la tienda (`/tienda/<slug>`). */
export function tipoDePagina(pathname: string, base: string): PaginaDeTienda {
  const resto = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const r = resto.replace(/\/+$/, "");
  if (r === "") return "inicio";
  if (r === "/productos" || r.startsWith("/productos/")) return "productos";
  if (r.startsWith("/producto/")) return "producto";
  return "otra";
}

interface EntradaShift extends PerformanceEntry { value: number; hadRecentInput: boolean }
interface EntradaEvento extends PerformanceEntry { interactionId?: number }

/** CLS de Google: la peor ventana de cambios (≤ 1 s entre ellos, ≤ 5 s en total). */
export function clsDeCambios(cambios: { startTime: number; value: number }[]): number {
  let peor = 0, actual = 0, inicio = 0, ultimo = 0;
  for (const c of cambios) {
    if (actual > 0 && (c.startTime - ultimo > 1000 || c.startTime - inicio > 5000)) actual = 0;
    if (actual === 0) inicio = c.startTime;
    actual += c.value;
    ultimo = c.startTime;
    peor = Math.max(peor, actual);
  }
  return peor;
}

let iniciado = false;

function observar(tipo: string, alRecibir: (lista: PerformanceEntry[]) => void, extra: Record<string, unknown> = {}) {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(tipo)) return;
    const o = new PerformanceObserver(l => alRecibir(l.getEntries()));
    o.observe({ type: tipo, buffered: true, ...extra } as PerformanceObserverInit);
  } catch {
    // Navegador sin soporte: no se mide.
  }
}

/** Empieza a medir la visita. Una sola vez por carga de página. */
export function iniciarVitalesTienda(slug: string, pagina: PaginaDeTienda): void {
  if (iniciado || typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  iniciado = true;

  let lcp: number | null = null;
  const cambios: { startTime: number; value: number }[] = [];
  let inp: number | null = null;

  observar("largest-contentful-paint", es => { const u = es[es.length - 1]; if (u) lcp = u.startTime; });
  observar("layout-shift", es => {
    for (const e of es as EntradaShift[]) if (!e.hadRecentInput) cambios.push({ startTime: e.startTime, value: e.value });
  });
  observar("event", es => {
    for (const e of es as EntradaEvento[]) if (e.interactionId) inp = Math.max(inp ?? 0, e.duration);
  }, { durationThreshold: 40 });

  let enviado = false;
  const enviar = (alCerrar: boolean) => {
    if (enviado || (!alCerrar && document.visibilityState !== "hidden")) return;
    enviado = true;
    const url = getOptionalEnv("VITE_SUPABASE_URL");
    const clave = getOptionalEnv("VITE_SUPABASE_ANON_KEY") ?? getOptionalEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
    if (!url || !clave || (lcp === null && inp === null && cambios.length === 0)) return;
    try {
      void fetch(`${url}/rest/v1/rpc/registrar_vitales_tienda`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", apikey: clave, Authorization: `Bearer ${clave}` },
        body: JSON.stringify({
          p_slug: slug, p_pagina: pagina,
          p_lcp: lcp === null ? null : Math.round(lcp),
          p_cls: Math.round(clsDeCambios(cambios) * 1000) / 1000,
          p_inp: inp === null ? null : Math.round(inp),
        }),
      }).catch(() => { /* best-effort */ });
    } catch {
      // best-effort
    }
  };
  document.addEventListener("visibilitychange", () => enviar(false));
  // Algunos navegadores cierran la página sin pasar por «hidden».
  window.addEventListener("pagehide", () => enviar(true));
}
