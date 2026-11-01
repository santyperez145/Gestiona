import { expect, test } from "@playwright/test";
import { exigirBackendReal } from "./backendReal";
import { instalarMedicion, registrarMedicion } from "./rendimiento";

/**
 * Rendimiento de la tienda para el comprador (2026-11-01): la superficie que
 * vende. Visita en frío de la portada, el listado, una ficha y el carrito, en
 * escritorio y en teléfono (proyectos chromium y mobile). Sólo mide e informa:
 * la tabla sale en el resumen de la corrida (test-results/rendimiento-tienda.jsonl).
 * Sólo lectura: no crea pedidos.
 */
exigirBackendReal();
test.use({ serviceWorkers: "block" });

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
    const ruta = pagina.ruta();
    expect(ruta, `sin ruta para ${pagina.nombre}`).not.toBe("");
    const inicio = Date.now();
    await page.goto(ruta);
    await pagina.listo(page);
    const titulo = Date.now() - inicio;
    if (pagina.nombre === "portada") {
      ficha = new URL(await page.locator(`a[href*="/tienda/${SLUG}/producto/"]`).first().evaluate(a => (a as HTMLAnchorElement).href)).pathname;
    }
    await registrarMedicion(page, { ruta: `${dispositivo} · ${pagina.nombre}`, inicio, titulo, archivo: "rendimiento-tienda.jsonl" });
    await contexto.close();
  }
});
