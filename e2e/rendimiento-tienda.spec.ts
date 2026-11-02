import { expect, test } from "@playwright/test";
import { exigirBackendReal } from "./backendReal";
import { PRESUPUESTO, instalarMedicion, registrarMedicion } from "./rendimiento";

/**
 * Rendimiento de la tienda para el comprador (2026-11-01): la superficie que
 * vende. Visita en frío de la portada, el listado, una ficha y el carrito, en
 * escritorio y en teléfono (proyectos chromium y mobile). Sólo mide e informa:
 * la tabla sale en el resumen de la corrida (test-results/rendimiento-tienda.jsonl).
 * Sólo lectura: no crea pedidos.
 */
exigirBackendReal();
test.use({ serviceWorkers: "block" });
// Los presupuestos se comparan en el entorno controlado del E2E local; contra
// producción la red del runner haría variar los tiempos y daría falsos rojos.
test.skip(process.env.E2E_LOCAL !== "true", "La medición de la tienda corre en el E2E local (E2E_LOCAL=true).");

const SLUG = process.env.E2E_STORE_SLUG ?? "exentryimports";
const tienda = (ruta = "") => `/tienda/${SLUG}${ruta}`;

test("rendimiento de la tienda en una visita en frío", async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const dispositivo = testInfo.project.name;
  let ficha = "";

  const paginas: Array<{ nombre: string; ruta: () => string; listo: (p: import("@playwright/test").Page) => Promise<void> }> = [
    { nombre: "portada", ruta: () => tienda(), listo: async p => { await expect(p.locator(`a[href*="/tienda/${SLUG}/producto/"]`).first()).toBeVisible({ timeout: 30_000 }); } },
    { nombre: "listado", ruta: () => tienda("/productos"), listo: async p => { await expect(p.locator(`a[href*="/tienda/${SLUG}/producto/"]`).first()).toBeVisible({ timeout: 30_000 }); } },
    { nombre: "ficha", ruta: () => ficha, listo: async p => { await expect(p.locator("h1").first()).toBeVisible({ timeout: 30_000 }); } },
    { nombre: "carrito", ruta: () => tienda("/carrito"), listo: async p => { await expect(p.locator("h1, h2").first()).toBeVisible({ timeout: 30_000 }); } },
  ];

  for (const pagina of paginas) {
    // Contexto nuevo por página: visita en frío, sin caché ni sesión.
    const contexto = await browser.newContext(testInfo.project.use);
    const page = await contexto.newPage();
    await instalarMedicion(page);
    // La tienda es del comercio: la marca Nerqia no puede aparecer ni un instante
    // mientras carga (pasó el 2026-11-01 con el cargador de arranque).
    await page.addInitScript(() => {
      const w = window as unknown as { __marcaNerqia?: boolean };
      new MutationObserver(() => {
        if (!w.__marcaNerqia && document.body?.innerText?.includes("Cargando Nerqia")) w.__marcaNerqia = true;
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    const ruta = pagina.ruta();
    expect(ruta, `sin ruta para ${pagina.nombre}`).not.toBe("");
    const inicio = Date.now();
    await page.goto(ruta);
    await pagina.listo(page);
    const titulo = Date.now() - inicio;
    if (pagina.nombre === "portada") {
      ficha = new URL(await page.locator(`a[href*="/tienda/${SLUG}/producto/"]`).first().evaluate(a => (a as HTMLAnchorElement).href)).pathname;
    }
    const fila = await registrarMedicion(page, { ruta: `${dispositivo} · ${pagina.nombre}`, inicio, titulo, archivo: "rendimiento-tienda.jsonl" });
    expect.soft(fila.cls, `${pagina.nombre}: salto al cargar — se mueve: ${fila.culpableCls ?? "?"}`).toBeLessThanOrEqual(PRESUPUESTO.tienda.cls);
    expect.soft(fila.consultas, `${pagina.nombre}: consultas — más repetidas: ${fila.repetidas}`).toBeLessThanOrEqual(PRESUPUESTO.tienda.consultas);
    expect.soft(fila.lcp, `${pagina.nombre}: contenido principal (LCP, ms)`).toBeLessThanOrEqual(PRESUPUESTO.tienda.lcp);
    expect(await page.evaluate(() => Boolean((window as unknown as { __marcaNerqia?: boolean }).__marcaNerqia)),
      `la tienda mostró «Cargando Nerqia» en ${pagina.nombre}`).toBe(false);
    await contexto.close();
  }
});
