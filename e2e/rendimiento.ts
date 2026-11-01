import { appendFileSync, mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";

/**
 * Medición de rendimiento en una visita en frío (2026-10-31), compartida por
 * el barrido del panel y la tienda: LCP, corrimientos (con el elemento del
 * salto más grande), tareas largas, JavaScript descargado y consultas a la
 * base (con las más repetidas). Cada medición queda en un .jsonl que
 * `scripts/resumen-rendimiento.mjs` publica como tabla en la corrida.
 */
export async function instalarMedicion(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __perf: { lcp: number; cls: number; largas: number; bloqueo: number; salto?: number; culpable?: string } };
    w.__perf = { lcp: 0, cls: 0, largas: 0, bloqueo: 0 };
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) w.__perf.lcp = e.startTime; })
        .observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(l => {
        type Fuente = { node?: Node | null };
        for (const e of l.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number; sources?: Fuente[] }>) {
          if (e.hadRecentInput) continue;
          w.__perf.cls += e.value ?? 0;
          // Qué se movió en el salto más grande, para saber qué corregir.
          const nodo = e.sources?.find(s => s.node instanceof Element)?.node as Element | undefined;
          if (nodo && (e.value ?? 0) > (w.__perf.salto ?? 0)) {
            w.__perf.salto = e.value ?? 0;
            w.__perf.culpable = `${nodo.tagName.toLowerCase()}.${String(nodo.getAttribute("class") ?? "").slice(0, 60)} «${(nodo.textContent ?? "").trim().slice(0, 40)}»`;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver(l => {
        for (const e of l.getEntries()) { w.__perf.largas += 1; w.__perf.bloqueo += Math.max(0, e.duration - 50); }
      }).observe({ type: "longtask", buffered: true });
    } catch { /* navegador sin estas métricas: quedan en cero */ }
  });
}

export async function registrarMedicion(page: Page, opciones: { ruta: string; inicio: number; titulo: number; archivo: string }) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const listo = Date.now() - opciones.inicio;
  const medida = await page.evaluate(() => {
    const p = (window as unknown as { __perf?: { lcp: number; cls: number; largas: number; bloqueo: number; culpable?: string } }).__perf;
    const recursos = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const js = recursos.filter(r => r.initiatorType === "script" || r.name.endsWith(".js"));
    const base = recursos.filter(r => /\/(rest|rpc|functions|auth)\/v1\//.test(r.name));
    return {
      lcp: Math.round(p?.lcp ?? 0),
      cls: Math.round((p?.cls ?? 0) * 1000) / 1000,
      tareasLargas: p?.largas ?? 0,
      bloqueo: Math.round(p?.bloqueo ?? 0),
      jsKb: Math.round(js.reduce((s, r) => s + (r.encodedBodySize || 0), 0) / 1024),
      archivosJs: js.length,
      consultas: base.length,
      consultaMasLenta: Math.round(Math.max(0, ...base.map(r => r.duration))),
      culpableCls: p?.culpable ?? null,
      // Las consultas más repetidas (tabla o función, sin filtros).
      repetidas: Object.entries(base.reduce<Record<string, number>>((acc, r) => {
        const clave = new URL(r.name).pathname.replace(/^\/(rest|functions|auth)\/v1\//, "");
        acc[clave] = (acc[clave] ?? 0) + 1;
        return acc;
      }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}×${n}`).join(" "),
    };
  });
  const fila = { ruta: opciones.ruta, titulo: opciones.titulo, listo, ...medida };
  console.log(`[rendimiento] ${JSON.stringify(fila)}`);
  mkdirSync("test-results", { recursive: true });
  appendFileSync(`test-results/${opciones.archivo}`, `${JSON.stringify(fila)}\n`);
  return fila;
}
