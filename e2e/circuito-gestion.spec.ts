import { expect, test, type Page } from "@playwright/test";

/**
 * El circuito de gestión de punta a punta, con datos de verdad (2026-10-23):
 * turno abierto → presupuesto → cobro en la caja a cuenta corriente → remito
 * → factura pedida → cobro de la deuda, y la «Operación completa» de la venta
 * con todos sus documentos.
 *
 * ESCRIBE DATOS. Corre sólo contra el Supabase local sembrado por
 * `scripts/semilla-e2e-local.mjs` (workflow `e2e-local.yml`): exige
 * E2E_LOCAL=true y una URL de Supabase local. Contra producción se saltea.
 */
const url = (() => { try { return new URL(process.env.VITE_SUPABASE_URL ?? ""); } catch { return null; } })();
const LOCAL = process.env.E2E_LOCAL === "true" && !!url && ["127.0.0.1", "localhost"].includes(url.hostname);

test.describe.configure({ mode: "serial" });
test.skip(!LOCAL, "El circuito escribe datos: corre sólo contra la base local del E2E (E2E_LOCAL=true).");

async function cerrarAvisos(page: Page) {
  // El recorrido de bienvenida o un aviso flotante no tienen que tapar la pantalla.
  const ahoraNo = page.getByRole("button", { name: "Ahora no" });
  if (await ahoraNo.isVisible().catch(() => false)) await ahoraNo.click();
}

async function atenderCaja(page: Page) {
  // La caja pregunta quién atiende el turno, como a un cajero real.
  const quien = page.getByRole("dialog", { name: /Quién atiende hoy/ });
  if (await quien.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) {
    await quien.getByPlaceholder("Tu nombre").fill("ZZ Cajera");
    await quien.getByRole("button", { name: "Confirmar" }).click();
    await expect(quien).toBeHidden();
  }
}

test("presupuesto → caja → remito → factura → cobro, con la operación completa", async ({ page }) => {
  test.setTimeout(240_000);

  // 1. Turno de caja abierto en la sucursal del negocio.
  await page.goto("/caja/turno");
  await cerrarAvisos(page);
  const abrir = page.getByRole("button", { name: "Abrir caja" });
  await expect(abrir).toBeVisible();
  await abrir.click();
  await expect(page.getByText("Caja abierta").first()).toBeVisible();

  // 2. Presupuesto para un cliente con CUIT, cargado por código.
  await page.goto("/presupuestos");
  await cerrarAvisos(page);
  await page.getByRole("button", { name: /Nuevo presupuesto/ }).first().click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Cliente").fill("ZZ Obra");
  await editor.getByRole("button", { name: /ZZ Obra Norte/ }).click();
  await expect(editor.getByText("Cliente de la lista: la caja lo carga al cobrar.")).toBeVisible();
  const codigo = editor.getByLabel("Agregar por código");
  await expect(codigo).toBeEnabled();
  await codigo.fill("ZZ-TOR-840");
  await codigo.press("Enter");
  const renglon = editor.getByTestId("renglon-presupuesto").filter({ has: page.getByRole("combobox", { name: /Producto del ítem/ }) }).first();
  await expect(renglon).toContainText("ZZ Tornillo 8x40");
  await renglon.getByLabel("Cantidad").fill("10");
  await editor.getByTestId("guardar-presupuesto").click();
  await expect(editor).toBeHidden();

  // 3. Cobrarlo en la caja, a cuenta corriente (fiado), con factura pedida.
  await page.getByRole("button", { name: "Ver detalle" }).first().click();
  await page.getByTestId("presupuesto-cobrar-en-caja").first().click();
  await expect(page).toHaveURL(/\/caja/);
  await atenderCaja(page);
  await expect(page.getByText("ZZ Tornillo 8x40").first()).toBeVisible();
  await page.getByRole("button", { name: "Fiado", exact: true }).click();
  await page.getByRole("button", { name: /Confirmar venta/ }).first().click();
  const confirmar = page.getByRole("alertdialog").getByRole("button", { name: "Confirmar venta" });
  if (await confirmar.isVisible().catch(() => false)) await confirmar.click();
  await expect(page.getByText(/Venta de \$\s?1\.200,00 registrada/).first()).toBeVisible({ timeout: 30_000 });

  // 4. Remito de lo vendido, desde la venta.
  await page.goto("/ventas");
  await cerrarAvisos(page);
  await page.getByRole("button", { name: /Ver detalle de ZZ Tornillo 8x40/ }).first().click();
  await page.getByRole("button", { name: "Remito", exact: true }).click();
  const remito = page.getByRole("dialog", { name: /Remito de entrega/ });
  await expect(remito).toBeVisible();
  await remito.getByRole("button", { name: "Todo lo pendiente" }).click();
  await remito.getByRole("button", { name: "Emitir", exact: true }).click();
  // Confirma el número del remito y se cierra con «Listo».
  await expect(page.getByText(/Remito X 00001-\d{8} emitido/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Listo", exact: true }).click();

  // 5 y 6. La operación completa tiene presupuesto, remito y factura (sin CAE: no hay ARCA local).
  const operacion = page.getByTestId("documentos-de-la-venta");
  await expect(operacion.getByText("Presupuesto", { exact: true })).toBeVisible();
  await expect(operacion.getByText(/^Remito X$/).first()).toBeVisible();
  await expect(operacion.getByText(/^Factura A$/).first()).toBeVisible();
  await expect(operacion.getByText(/sin CAE/).filter({ visible: true }).first()).toBeVisible();

  // 7. Cobro de la deuda en la caja, y la operación lo muestra.
  await page.goto("/caja");
  await cerrarAvisos(page);
  await atenderCaja(page);
  await page.locator('[data-tour="pos-cliente"]').click();
  const elegir = page.getByRole("dialog", { name: "Elegir cliente" });
  await elegir.getByLabel("Buscar cliente").fill("ZZ Obra");
  await elegir.getByRole("button", { name: /ZZ OBRA NORTE SA/ }).click();
  await page.getByTestId("pos-cobrar-deuda").click();
  const cobro = page.getByRole("dialog", { name: /Cobrar cuenta corriente/ });
  await expect(cobro).toBeVisible();
  await cobro.getByRole("button", { name: "Registrar cobro" }).click();
  await expect(cobro).toBeHidden({ timeout: 30_000 });

  await page.goto("/ventas");
  await page.getByRole("button", { name: /Ver detalle de ZZ Tornillo 8x40/ }).first().click();
  const final = page.getByTestId("documentos-de-la-venta");
  await expect(final.getByText("Cobro", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});
