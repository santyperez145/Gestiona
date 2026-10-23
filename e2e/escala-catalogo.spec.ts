import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Escala de Famatina (2026-10-23): un catálogo de 5.500 productos, con el
 * ajuste masivo desde el costo en dólares y una toma física completa, desde
 * la pantalla. Antes las dos hacían una llamada por producto desde el
 * navegador y la toma redibujaba los 5.500 renglones en cada tecla.
 *
 * ESCRIBE DATOS. Corre sólo contra el Supabase local, después de
 * `scripts/semilla-escala-local.mjs` (paso «E2E a escala» de `e2e-local.yml`).
 */
const url = (() => { try { return new URL(process.env.VITE_SUPABASE_URL ?? ""); } catch { return null; } })();
const LOCAL = process.env.E2E_LOCAL === "true" && !!url && ["127.0.0.1", "localhost"].includes(url.hostname);
const ARCHIVO = "e2e/.escala.json";

test.describe.configure({ mode: "serial" });
test.skip(!LOCAL || !existsSync(ARCHIVO), "Escribe datos: corre sólo contra la base local, después de la semilla de escala.");

async function cerrarAvisos(page: Page) {
  const ahoraNo = page.getByRole("button", { name: "Ahora no" });
  if (await ahoraNo.isVisible().catch(() => false)) await ahoraNo.click();
}

test("el ajuste desde el costo en dólares recalcula los 5.500 de una vez", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/productos");
  await cerrarAvisos(page);
  await page.getByRole("button", { name: "Más acciones de productos" }).click();
  await page.getByRole("menuitem", { name: "Ajuste masivo de precios" }).click();
  const dialogo = page.getByRole("dialog", { name: "Ajustar precios en bloque" });
  await dialogo.getByRole("button", { name: "Costo en dólares" }).click();
  await dialogo.getByLabel("Nuevo tipo de cambio").fill("1500");
  await dialogo.getByLabel("Markup sobre costo importado").fill("100");

  const desde = Date.now();
  await dialogo.getByRole("button", { name: /Recalcular a \$1\.500\/U\$S/ }).click();
  const aviso = page.getByText(/\d+ productos recalculados a \$1500\/U\$S/);
  await expect(aviso).toBeVisible({ timeout: 60_000 });
  const segundos = (Date.now() - desde) / 1000;
  const recalculados = Number((await aviso.textContent())?.match(/(\d+) productos/)?.[1] ?? 0);
  console.log(`Recálculo: ${recalculados} productos en ${segundos.toFixed(1)} s`);
  expect(recalculados).toBeGreaterThanOrEqual(5500);
  expect(segundos).toBeLessThan(30);
});

test("una toma física de 5.500 se cuenta sin trabas y se cierra en tandas", async ({ page }) => {
  test.setTimeout(300_000);
  const { org_id, productos } = JSON.parse(readFileSync(ARCHIVO, "utf8")) as { org_id: string; productos: string[] };

  // Lo contado, como lo deja quien cuenta y recarga: la mitad igual al
  // sistema (10) y la otra mitad con uno más (11).
  await page.addInitScript(([clave, borrador]) => {
    if (!sessionStorage.getItem("escala-precargada")) {
      localStorage.setItem(clave, borrador);
      sessionStorage.setItem("escala-precargada", "1");
    }
  }, [
    `gestiona.stockcount.draft.${org_id}`,
    JSON.stringify({
      saved_at: new Date().toISOString(),
      rows: productos.map((id, i) => ({ product_id: id, counted: i % 2 === 0 ? "10" : "11" })),
    }),
  ] as const);

  const desde = Date.now();
  await page.goto("/kardex");
  await cerrarAvisos(page);
  await page.getByRole("tab", { name: "Toma Física" }).click();
  await expect(page.getByText(/Retomamos tu conteo .*: 5500 producto/)).toBeVisible({ timeout: 90_000 });
  console.log(`Toma física: 5.500 renglones listos en ${((Date.now() - desde) / 1000).toFixed(1)} s`);

  // Una tecla en un renglón no tiene que esperar a los otros 5.499. Se mide
  // adentro de la página: un localizador por rol sobre 5.500 filas mide a
  // Playwright, no a la pantalla (dio 1,5 s el 23/10).
  const ms = await page.evaluate(async () => {
    const campo = document.querySelector<HTMLInputElement>('input[aria-label="Contado de ZZ Escala 0001"]');
    const fila = campo?.closest("tr");
    if (!campo || !fila) throw new Error("No está el renglón de ZZ Escala 0001");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const desde = performance.now();
    setter.call(campo, "12");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise<void>(listo => {
      const mirar = () => (fila.textContent?.includes("+2") ? listo() : requestAnimationFrame(mirar));
      mirar();
    });
    return Math.round(performance.now() - desde);
  });
  console.log(`Toma física: un campo responde en ${ms} ms con 5.500 renglones`);
  expect(ms).toBeLessThan(300);

  // Ajustan los 2.750 contados con 11 y el que pasó a 12.
  const cerrar = page.getByRole("button", { name: /Cerrar toma \(5500\)/ });
  await cerrar.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cerrar toma" }).click();
  const cierre = Date.now();
  await expect(page.getByText(/Toma cerrada: 2751 ajustes auditados/)).toBeVisible({ timeout: 120_000 });
  console.log(`Toma física: cerrada en ${((Date.now() - cierre) / 1000).toFixed(1)} s`);
});
