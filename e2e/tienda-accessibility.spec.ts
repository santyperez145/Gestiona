/**
 * Accesibilidad automática de las superficies públicas que sostienen una
 * compra. La suite es de sólo lectura: las escrituras analíticas del
 * Storefront se responden en el navegador y el carrito vive en localStorage.
 *
 * Axe no sustituye una recorrida con teclado o lector de pantalla. Sí evita
 * que una regresión crítica o seria de WCAG A/AA llegue silenciosamente a la
 * tienda publicada.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SLUG = process.env.E2E_STORE_SLUG ?? "exentryimports";
const tienda = (ruta = "") => `/tienda/${SLUG}${ruta}`;
const IMPACTOS_BLOQUEANTES = new Set(["critical", "serious"]);
const TAGS_WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function fichasVisibles(page: Page) {
  const fichas = page.locator(`a[href*="/tienda/${SLUG}/producto/"]`);
  await expect(fichas.first()).toBeVisible();
  return fichas;
}

async function auditar(page: Page, superficie: string) {
  let resultado: Awaited<ReturnType<AxeBuilder["analyze"]>> | null = null;
  for (let intento = 0; intento < 2; intento += 1) {
    try {
      resultado = await new AxeBuilder({ page })
        .withTags(TAGS_WCAG)
        .analyze();
      break;
    } catch (error) {
      const documentoCambio = error instanceof Error
        && error.message.includes("Execution context was destroyed");
      if (!documentoCambio || intento > 0) throw error;
      await page.waitForLoadState("domcontentloaded");
    }
  }
  if (!resultado) throw new Error(`No se pudo auditar ${superficie}`);
  const bloqueantes = resultado.violations.filter(({ impact }) => (
    impact !== null && IMPACTOS_BLOQUEANTES.has(impact)
  ));
  const detalle = bloqueantes.flatMap(violacion => violacion.nodes.map(nodo => (
    `${violacion.id} (${violacion.impact}) ${nodo.target.join(" ")} — ${nodo.failureSummary ?? violacion.help}`
  ))).join("\n");

  if (bloqueantes.length > 0) {
    throw new Error(`${superficie} tiene violaciones axe críticas/serias:\n${detalle}`);
  }
}

async function abrirPrimeraFicha(page: Page) {
  await page.goto(tienda("/productos"));
  const fichas = await fichasVisibles(page);
  await fichas.first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function prepararCarrito(page: Page) {
  await abrirPrimeraFicha(page);
  await page.getByRole("button", { name: /Agregar al carrito/i }).click();
  await expect(page.getByLabel(/Carrito, \d+ artículo/)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  for (const rpc of ["record_store_visit", "save_store_cart_v3", "start_store_checkout_v2"]) {
    await page.route(`**/rest/v1/rpc/${rpc}`, route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    }));
  }
});

test.describe("WCAG A/AA del Storefront", () => {
  test("Inicio no tiene violaciones axe críticas o serias", async ({ page }) => {
    await page.goto(tienda());
    await fichasVisibles(page);
    await auditar(page, "Inicio");
  });

  test("catálogo no tiene violaciones axe críticas o serias", async ({ page }) => {
    await page.goto(tienda("/productos"));
    await fichasVisibles(page);
    await auditar(page, "Catálogo");
  });

  test("ficha no tiene violaciones axe críticas o serias", async ({ page }) => {
    await abrirPrimeraFicha(page);
    await auditar(page, "Ficha de producto");
  });

  test("carrito no tiene violaciones axe críticas o serias", async ({ page }) => {
    await prepararCarrito(page);
    await page.goto(tienda("/carrito"));
    await expect(page.getByRole("heading", { name: /Tu carrito/ })).toBeVisible();
    await auditar(page, "Carrito");
  });

  test("checkout no tiene violaciones axe críticas o serias", async ({ page }) => {
    await prepararCarrito(page);
    await page.goto(tienda("/checkout"));
    await expect(page.getByRole("heading", { name: "Finalizar compra" })).toBeVisible();
    await auditar(page, "Checkout");
  });
});
