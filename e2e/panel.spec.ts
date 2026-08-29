/**
 * El panel de gestión, con sesión.
 *
 * Estas pantallas son las que no pude verificar en el navegador mientras las
 * construía: el despacho de una orden, el editor de banners, la carga del
 * certificado de AFIP. Cada una quedó con un "probalo vos y contame", que es
 * exactamente lo que este archivo viene a eliminar.
 *
 * Sólo corren con `E2E_USER` / `E2E_PASSWORD` definidas — ver `auth.setup.ts`.
 * Sin eso se saltean localmente. En CI son obligatorias: el setup falla antes
 * de que un panel sin probar pueda presentarse como verde.
 *
 * **De sólo lectura, como los de la tienda.** Miran que las pantallas abran y
 * que los controles estén donde tienen que estar; ninguno despacha una orden
 * real ni sube un certificado. Lo que escriba, va con datos `ZZ` y limpieza.
 */
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

// Sin credenciales no hay sesión que reusar y estos specs no pueden correr. Se
// saltean enteros en vez de fallar: un test rojo por falta de configuración
// enseña a ignorar los tests rojos.
const faltanCredenciales = !process.env.E2E_USER || !process.env.E2E_PASSWORD;
if (faltanCredenciales && process.env.E2E_REQUIRE_AUTH === "true") {
  throw new Error("El proyecto panel exige E2E_USER y E2E_PASSWORD en CI");
}
test.skip(faltanCredenciales,
  "Definí E2E_USER y E2E_PASSWORD para probar el panel");

test.describe("dashboard", () => {
  test("cada tab por hash muestra sus datos y oculta sólo las otras vistas", async ({ page }) => {
    await page.goto("/#dashboard-sales");

    const content = page.locator(".workspace-dashboard-content");
    await expect(content).toHaveAttribute("data-dashboard-view", "sales");
    await expect(page.locator('[data-dashboard-section="sales"]')).toBeVisible();
    await expect(page.locator('[data-dashboard-section="overview"]')).toBeHidden();
    const viewTabs = page.getByRole("tablist", { name: "Vistas del dashboard" });

    const views = [
      ["Resumen", "overview"],
      ["Rendimiento", "sales"],
      ["Clientes", "customers"],
      ["Stock", "inventory"],
      ["Caja y finanzas", "finance"],
      ["Inteligencia", "intelligence"],
    ] as const;

    for (const [label, key] of views) {
      await viewTabs.getByRole("tab", { name: new RegExp(`^${label}`) }).click();
      await expect(content).toHaveAttribute("data-dashboard-view", key);
      await expect(page.locator(`[data-dashboard-section="${key}"]`)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`#dashboard-${key}$`));
    }
  });
});

test.describe("tienda e-commerce", () => {
  test("las pestañas del panel abren", async ({ page }) => {
    await page.goto("/tienda-online");

    // Si la sesión no viajó, la app manda al login y no hay nada que probar.
    await expect(page.getByRole("heading", { name: "Tienda E-Commerce" })).toBeVisible();

    for (const pestaña of [
      "Órdenes",
      "Opiniones y preguntas",
      "Páginas",
      "Banners",
      "Diseño & Tema",
    ]) {
      await page.getByRole("button", { name: pestaña, exact: true }).click();
      await expect(page.getByRole("button", { name: pestaña, exact: true })).toBeVisible();
    }
  });

  test("el botón de despachar se ve sin scrollear de costado", async ({ page }) => {
    // El bug era exactamente éste: la columna quedaba fuera de pantalla dentro
    // de una tabla con scroll horizontal, y el botón dejaba de existir para
    // quien no piensa en scrollear.
    await page.goto("/tienda-online");
    await page.getByRole("button", { name: "Órdenes", exact: true }).click();

    const pagas = page.getByRole("button", { name: /Preparar|Ver envío/ });
    if (!(await pagas.count())) {
      test.skip(true, "no hay órdenes pagas para despachar");
    }
    await expect(pagas.first()).toBeInViewport();
  });

  test("la identidad de la tienda se carga por archivo, no por URL", async ({ page }) => {
    await page.goto("/tienda-online");
    await page.getByRole("button", { name: "Diseño & Tema", exact: true }).click();

    await expect(page.getByText("Identidad")).toBeVisible();
    await expect(page.getByText("Elegí, arrastrá o pegá una imagen").first()).toBeVisible();
    // Si alguien vuelve a poner un campo de URL, esto lo agarra.
    await expect(page.getByPlaceholder("https://")).toHaveCount(0);
  });

  test("los banners piden imagen por archivo", async ({ page }) => {
    await page.goto("/tienda-online");
    await page.getByRole("button", { name: "Banners", exact: true }).click();

    // `count()` no espera la consulta. Primero se espera el estado cargado;
    // recién entonces se decide si hay un banner o el empty state.
    const imagen = page.getByText("Imagen del banner").first();
    const vacio = page.getByText("Sin banners", { exact: true });
    await expect(imagen.or(vacio)).toBeVisible();
    if (await vacio.isVisible()) {
      test.skip(true, "no hay banners cargados todavía");
    }
    await expect(imagen).toBeVisible();
  });
});

test.describe("credenciales", () => {
  test("integraciones no pide pegar ningún token", async ({ page }) => {
    await page.goto("/integraciones");
    await expect(page.getByRole("heading", { level: 1, name: "Integraciones & API" })).toBeVisible();

    // MercadoPago y MercadoLibre se conectan por OAuth. Un campo para pegar el
    // access token es lo que se sacó, y no tiene que volver.
    await expect(page.getByPlaceholder("APP_USR-...")).toHaveCount(0);
    await expect(page.getByText("Access Token de producción")).toHaveCount(0);
  });
});

test.describe("clientes", () => {
  test("el command center separa cartera e insights sin perder el contexto", async ({ page }) => {
    await page.goto("/clientes");
    await expect(page.getByRole("heading", { level: 1, name: "Clientes / CRM" })).toBeVisible();

    await expect(page.getByRole("region", { name: "Centro de control del CRM" })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Vistas del CRM" });
    await expect(tabs.getByRole("tab", { name: /Clientes/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("complementary", { name: "Segmentos rápidos" })).toBeVisible();

    await tabs.getByRole("tab", { name: /Insights/ }).click();
    await expect(tabs.getByRole("tab", { name: /Insights/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: "Insights de clientes" })).toBeVisible();

    await tabs.getByRole("tab", { name: /Clientes/ }).click();
    await expect(page.getByRole("region", { name: "Listado de clientes" })).toBeVisible();
  });
});

test.describe("productos", () => {
  test("usa Variantes como capacidad y lee un archivo real sin tocar el catálogo", async ({ page }) => {
    await page.goto("/productos");
    await expect(page.getByRole("heading", { level: 1, name: "Productos" })).toBeVisible();

    await page.getByRole("button", { name: "Nuevo", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Nuevo producto" });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("button", { name: /Variantes/ })).toBeVisible();
    await expect(editor.getByRole("button", { name: /Sabores/ })).toHaveCount(0);
    await editor.getByRole("button", { name: "Cerrar" }).click();

    await page.getByRole("button", { name: "Más acciones de productos" }).click();
    await page.getByRole("menuitem", { name: "Importar Excel/CSV" }).click();
    const importer = page.getByRole("dialog", { name: "Importar catálogo" });
    await expect(importer).toBeVisible();

    const fixture = path.resolve("e2e/fixtures/productos-importacion-e2e.csv");
    await importer.locator('input[type="file"]').setInputFiles(fixture);
    await expect(importer.getByText("productos-importacion-e2e.csv", { exact: true })).toBeVisible();
    await expect(importer.getByText("2 filas", { exact: true })).toBeVisible();
    await expect(importer.locator('[aria-label="Vista previa de productos importados"]')).toBeVisible();
    await expect(importer.getByText("ZZ Vista previa importador A", { exact: true })).toBeVisible();
    await expect(importer.getByText("ZZ Vista previa importador B", { exact: true })).toBeVisible();
    await expect(importer.getByRole("button", { name: "Preparar y validar" })).toBeVisible();

    // No se prepara ni se aprueba el lote: este E2E valida el parser de archivo
    // real y la vista previa, y mantiene la base de producción de sólo lectura.
    await importer.getByRole("button", { name: "Cancelar" }).click();
    await expect(importer).toBeHidden();
  });
});

test.describe("gastos", () => {
  test("el comprobante usa un solo modal y nunca expone una URL pública", async ({ page }) => {
    const errors: string[] = [];
    let observarInteraccion = false;
    page.on("console", message => {
      if (observarInteraccion && message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", error => {
      if (observarInteraccion) errors.push(error.message);
    });

    await page.goto("/gastos");
    await expect(page.getByRole("heading", { level: 1, name: "Gastos Operativos" })).toBeVisible();
    // La sesión guardada puede renovarse durante el arranque. Esta guarda mide
    // exclusivamente los errores que produzca la interacción del comprobante.
    await page.waitForTimeout(750);
    observarInteraccion = true;

    await page.getByRole("button", { name: "Nuevo Gasto" }).first().click();
    const formDialog = page.getByRole("dialog", { name: "Registrar Gasto" });
    await expect(formDialog).toBeVisible();
    await formDialog.getByRole("button", { name: "Escanear ticket con IA" }).click();

    await expect(formDialog.getByRole("region", { name: "Escanear comprobante" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(formDialog.locator('input[type="file"]')).toHaveCount(3);
    await expect(page.locator('a[href*="/storage/v1/object/public/expense-receipts"]')).toHaveCount(0);
    expect(errors, `errores en consola:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("POS", () => {
  async function abrirPos(page: Page) {
    await page.goto("/caja");

    // El nombre del vendedor es local a este navegador. Puede aparecer en una
    // sesión nueva, pero omitirlo no crea ninguna venta ni cambia la base.
    const vendedor = page.getByRole("heading", { name: "¿Quién atiende hoy?" });
    if (await vendedor.isVisible()) {
      await page.getByRole("button", { name: "Omitir", exact: true }).click();
    }

    await expect(page.getByPlaceholder(/Buscar producto/)).toBeVisible();
  }

  test("abre sin errores y no permite confirmar un carrito vacío", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(error.message));

    await abrirPos(page);

    await expect(page.getByRole("button", { name: /Confirmar venta/ })).toBeDisabled();
    expect(errors, `errores en consola:\n${errors.join("\n")}`).toEqual([]);
  });

  test("el atajo F2 vuelve a enfocar la búsqueda y conserva las categorías", async ({ page }) => {
    await abrirPos(page);

    const search = page.getByPlaceholder(/Buscar producto/);
    await page.keyboard.press("F2");
    await expect(search).toBeFocused();
    await expect(page.getByRole("button", { name: "Todo", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Árabe", exact: true })).toBeVisible();
  });
});
