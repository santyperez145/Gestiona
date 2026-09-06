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
    await expect(page.getByRole("heading", { name: "Nerqia Commerce" })).toBeVisible();

    for (const pestaña of [
      "Publicar",
      "Productos",
      "Opiniones y preguntas",
      "Categorías",
      "Páginas",
      "Banners",
      "Diseño y tema",
      "Pagos y envíos",
    ]) {
      await page.getByRole("button", { name: pestaña, exact: true }).click();
      await expect(page.getByRole("button", { name: pestaña, exact: true })).toBeVisible();
    }
  });

  test("el botón de despachar se ve sin scrollear de costado", async ({ page }) => {
    // El bug era exactamente éste: la columna quedaba fuera de pantalla dentro
    // de una tabla con scroll horizontal, y el botón dejaba de existir para
    // quien no piensa en scrollear.
    // Pedidos es una cola operativa canónica, no una copia dentro del editor
    // de la tienda. El alias viejo redirige a esta misma superficie.
    await page.goto("/pedidos-online");
    await expect(page.getByRole("heading", { level: 1, name: "Pedidos" })).toBeVisible();

    const pagas = page.getByRole("button", { name: /Preparar|Ver envío/ });
    if (!(await pagas.count())) {
      test.skip(true, "no hay órdenes pagas para despachar");
    }
    await expect(pagas.first()).toBeInViewport();
  });

  test("la identidad de la tienda se carga por archivo, no por URL", async ({ page }) => {
    await page.goto("/tienda-online");
    await page.getByRole("button", { name: "Diseño y tema", exact: true }).click();

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
    const discard = page.getByRole("alertdialog", { name: "¿Descartar los cambios del producto?" });
    await discard.waitFor({ state: "visible", timeout: 500 }).catch(() => undefined);
    if (await discard.isVisible()) {
      await discard.getByRole("button", { name: "Descartar cambios" }).click();
    }
    await expect(editor).toBeHidden();

    const moreActions = page.getByRole("button", { name: "Más acciones de productos" });
    await expect(moreActions).toBeVisible();
    await moreActions.click();
    await page.getByRole("menuitem", { name: "Importar Excel/CSV" }).click();
    const importer = page.getByRole("dialog", { name: "Importar catálogo" });
    await expect(importer).toBeVisible();

    const fixture = path.resolve("e2e/fixtures/productos-importacion-e2e.csv");
    await importer.locator('input[type="file"]').setInputFiles(fixture);
    await expect(importer.getByText("productos-importacion-e2e.csv", { exact: true })).toBeVisible();
    await expect(importer.getByText("2 filas de origen agrupadas", { exact: true })).toBeVisible();
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
  async function abrirPos(page: Page, navegar = true) {
    if (navegar) await page.goto("/caja");

    // El nombre del vendedor es local a este navegador. Puede aparecer en una
    // sesión nueva, pero omitirlo no crea ninguna venta ni cambia la base.
    const vendedor = page.getByRole("heading", { name: "¿Quién atiende hoy?" });
    const search = page.getByPlaceholder(/Buscar producto/);
    const denied = page.getByRole("heading", { name: "Sin acceso a esta sección" });
    // `pos-root` y el guard son mutuamente excluyentes. El buscador y el modal
    // de vendedor, en cambio, coexisten en el DOM y no pueden formar un locator
    // estricto con `or()`.
    await expect(page.getByTestId("pos-root").or(denied)).toBeVisible();
    if (await denied.isVisible()) {
      test.skip(true, "la identidad E2E no tiene permiso POS; provisionar el módulo en su organización técnica");
    }
    await vendedor.waitFor({ state: "visible", timeout: 1_000 }).catch(() => undefined);
    if (await vendedor.isVisible()) {
      await page.getByRole("button", { name: "Omitir", exact: true }).click();
    }

    await expect(search).toBeVisible();
  }

  test("abre sin errores y no permite confirmar un carrito vacío", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", error => errors.push(error.message));

    await abrirPos(page);

    await expect(page.getByRole("button", { name: /Confirmar venta/ })).toBeDisabled();
    await expect(
      page.getByRole("link", { name: /Gestionar turno/ }).first()
        .or(page.getByText("Caja todavía no tiene una sucursal", { exact: true })),
    ).toBeVisible();
    expect(errors, `errores en consola:\n${errors.join("\n")}`).toEqual([]);
  });

  test("mantiene catálogo y cierre de venta alcanzables según el ancho real", async ({ page }) => {
    test.setTimeout(60_000);
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));

    for (const width of [360, 768, 1024, 1092, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await abrirPos(page);

      const root = page.getByTestId("pos-root");
      const desktopCart = page.locator(".pos-cart-sidebar");
      const mobileToggle = page.getByRole("button", { name: "Abrir carrito" });
      await expect(root).toBeVisible();

      const geometry = await root.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return {
          bottom: Math.round(bounds.bottom),
          right: Math.round(bounds.right),
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
        };
      });
      expect(geometry.documentWidth, `overflow horizontal a ${width}px`).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.right, `POS fuera del viewport a ${width}px`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.bottom, `POS más alto que el espacio disponible a ${width}px`).toBeLessThanOrEqual(geometry.viewportHeight + 1);

      if (width < 1280) {
        await expect(desktopCart).toBeHidden();
        await expect(mobileToggle).toBeVisible();
        await mobileToggle.click();
        const confirm = page.getByRole("button", { name: /Confirmar venta/ });
        await confirm.scrollIntoViewIfNeeded();
        await expect(confirm).toBeVisible();
        await expect(confirm).toBeDisabled();
        await page.locator(".pos-mobile-cart .pos-cart-header").getByRole("button", { name: "Cerrar carrito" }).click();
      } else {
        await expect(desktopCart).toBeVisible();
        await expect(mobileToggle).toBeHidden();
        const confirm = desktopCart.getByRole("button", { name: /Confirmar venta/ });
        await confirm.scrollIntoViewIfNeeded();
        await expect(confirm).toBeVisible();
        await expect(confirm).toBeDisabled();
      }
    }

    expect(pageErrors, `errores JavaScript:\n${pageErrors.join("\n")}`).toEqual([]);
  });

  test("expone el turno autoritativo o su activación sin mutar la base", async ({ page }) => {
    const pageErrors: string[] = [];
    // La matriz navega cuatro veces contra Supabase remoto. Un `Failed to
    // fetch` recuperable queda en consola para observabilidad y no es un fallo
    // de layout; las excepciones JavaScript sí bloquean este contrato.
    page.on("pageerror", error => pageErrors.push(error.message));

    await abrirPos(page);
    const gestionar = page.getByRole("link", { name: /Gestionar turno/ }).first();
    const sinSucursal = page.getByText("Caja todavía no tiene una sucursal", { exact: true });
    await expect(gestionar.or(sinSucursal)).toBeVisible();
    if (await gestionar.isVisible()) {
      await gestionar.click();
      await expect(page).toHaveURL(/\/caja\/turno\?location=/);
    } else {
      await page.goto("/caja/turno");
    }

    const turnoUrl = page.url();
    for (const width of [360, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(turnoUrl);
      await expect(page.getByRole("heading", { name: "Apertura & Cierre de Caja" })).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Sucursal de la sesión de caja" })
          .or(page.getByRole("link", { name: "Configurar sucursal" })),
      ).toBeVisible();
      const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(viewport.scrollWidth, `overflow horizontal a ${width}px`).toBeLessThanOrEqual(viewport.width);
    }
    expect(pageErrors, `errores JavaScript:\n${pageErrors.join("\n")}`).toEqual([]);
  });

  test("el atajo F2 vuelve a enfocar la búsqueda y conserva las categorías", async ({ page }) => {
    await abrirPos(page);

    const search = page.getByPlaceholder(/Buscar producto/);
    await page.keyboard.press("F2");
    await expect(search).toBeFocused();
    const categories = page.getByRole("region", { name: "Categorías del catálogo" });
    await expect(categories.getByRole("button", { name: "Todo", exact: true })).toBeVisible();
    expect(await categories.getByRole("button").count()).toBeGreaterThan(0);
  });

  test("recupera dos tickets offline y deja visible una sincronización parcial sin escribir en producción", async ({ page, context }) => {
    let phase: "hold" | "partial" = "hold";
    let partialCalls = 0;

    // Toda llamada de escritura queda interceptada antes de cargar la cola.
    // El test jamás llega al RPC real ni inserta una venta de producción.
    await page.route("**/rest/v1/rpc/create_sales_transaction_v3", async route => {
      if (phase === "hold") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "POS_E2E_OFFLINE", message: "sin conexión simulada" }),
        });
        return;
      }

      partialCalls += 1;
      if (partialCalls === 1) {
        const body = route.request().postDataJSON() as { p_sales?: Array<{ id?: string }> };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            transaction_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            sale_ids: (body.p_sales ?? []).map(line => line.id),
            lines: body.p_sales?.length ?? 0,
            reused: false,
            coupon_recorded: false,
            payment_evidence: { inserted: 0, parts: 0, pending: 0 },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "POS_E2E_PARTIAL", message: "segundo ticket rechazado en la simulación" }),
      });
    });

    await abrirPos(page);
    const orgId = await page.getByTestId("pos-root").getAttribute("data-org-id");
    expect(orgId, "el POS debe exponer su organización activa al contrato E2E").toBeTruthy();
    const queueKey = `gestiona.pos.offline_sales.${orgId}`;
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const queue = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        org_id: orgId,
        product_name: "ZZ Vista offline A",
        quantity: 2,
        total_ars: 2000,
        date: twoHoursAgo,
        offline_transaction_id: "10101010-1010-4010-8010-101010101010",
        offline_origin: true,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        org_id: orgId,
        product_name: "ZZ Vista offline B",
        quantity: 1,
        total_ars: 1500,
        date: twoHoursAgo,
        offline_transaction_id: "10101010-1010-4010-8010-101010101010",
        offline_origin: true,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        org_id: orgId,
        product_name: "ZZ Vista offline C",
        quantity: 3,
        total_ars: 6000,
        date: twoHoursAgo,
        offline_transaction_id: "20202020-2020-4020-8020-202020202020",
        offline_origin: true,
      },
    ];

    try {
      await page.evaluate(
        ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
        { key: queueKey, value: queue },
      );
      await page.reload();
      await abrirPos(page, false);
      await context.setOffline(true);
      // Chromium aplica el bloqueo de red de inmediato, pero no todas sus
      // versiones notifican el cambio de `navigator.onLine` en el mismo tick.
      // El evento es el contrato web que escucha el POS.
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));

      await expect(page.getByText("Sin conexión — el ticket se guarda en este dispositivo")).toBeVisible();
      const offlineBanner = page.getByRole("status").filter({ hasText: "Sin conexión — el ticket se guarda en este dispositivo" });
      await expect(offlineBanner).toContainText("2 tickets · 6 u. · $ 9.500,00");
      await expect(page.getByText(/El cobro ocurre por fuera de Nerqia/)).toBeVisible();

      phase = "partial";
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));

      const partialBanner = page.getByRole("alert").filter({ hasText: "ticket sigue pendiente" });
      await expect(partialBanner).toContainText("1 ticket · 3 u. · $ 6.000,00 pendiente");
      await expect(partialBanner).toContainText("1 ticket sigue pendiente");
      expect(partialCalls).toBe(2);

      const remaining = await page.evaluate(key => {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) as Array<{ offline_transaction_id?: string }> : [];
      }, queueKey);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.offline_transaction_id).toBe("20202020-2020-4020-8020-202020202020");
    } finally {
      // La página se vuelve a desconectar antes de retirar el fixture: así un
      // fallo de aserción tampoco puede liberar la cola hacia producción.
      await context.setOffline(true);
      await page.evaluate(key => window.localStorage.removeItem(key), queueKey);
    }
  });
});
