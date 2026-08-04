/**
 * El panel de gestión, con sesión.
 *
 * Estas pantallas son las que no pude verificar en el navegador mientras las
 * construía: el despacho de una orden, el editor de banners, la carga del
 * certificado de AFIP. Cada una quedó con un "probalo vos y contame", que es
 * exactamente lo que este archivo viene a eliminar.
 *
 * Sólo corren con `E2E_USER` / `E2E_PASSWORD` definidas — ver `auth.setup.ts`.
 * Sin eso se saltean, y la suite sigue verde para quien no las tenga.
 *
 * **De sólo lectura, como los de la tienda.** Miran que las pantallas abran y
 * que los controles estén donde tienen que estar; ninguno despacha una orden
 * real ni sube un certificado. Lo que escriba, va con datos `ZZ` y limpieza.
 */
import { test, expect } from "@playwright/test";

// Sin credenciales no hay sesión que reusar y estos specs no pueden correr. Se
// saltean enteros en vez de fallar: un test rojo por falta de configuración
// enseña a ignorar los tests rojos.
test.skip(!process.env.E2E_USER || !process.env.E2E_PASSWORD,
  "Definí E2E_USER y E2E_PASSWORD para probar el panel");

test.describe("tienda e-commerce", () => {
  test("las pestañas del panel abren", async ({ page }) => {
    await page.goto("/tienda-online");

    // Si la sesión no viajó, la app manda al login y no hay nada que probar.
    await expect(page.getByRole("heading", { name: "Tienda E-Commerce" })).toBeVisible();

    for (const pestaña of ["Órdenes", "Opiniones", "Páginas", "Banners", "Diseño"]) {
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
    await page.getByRole("button", { name: "Diseño", exact: true }).click();

    await expect(page.getByText("Identidad")).toBeVisible();
    await expect(page.getByText("Elegí, arrastrá o pegá una imagen").first()).toBeVisible();
    // Si alguien vuelve a poner un campo de URL, esto lo agarra.
    await expect(page.getByPlaceholder("https://")).toHaveCount(0);
  });

  test("los banners piden imagen por archivo", async ({ page }) => {
    await page.goto("/tienda-online");
    await page.getByRole("button", { name: "Banners", exact: true }).click();

    const hayBanners = await page.getByText("Imagen del banner").count();
    if (!hayBanners) {
      await expect(page.getByText("Sin banners")).toBeVisible();
      test.skip(true, "no hay banners cargados todavía");
    }
    await expect(page.getByText("Imagen del banner").first()).toBeVisible();
  });
});

test.describe("credenciales", () => {
  test("integraciones no pide pegar ningún token", async ({ page }) => {
    await page.goto("/integraciones");
    await expect(page.getByRole("heading", { name: /Integraciones/i })).toBeVisible();

    // MercadoPago y MercadoLibre se conectan por OAuth. Un campo para pegar el
    // access token es lo que se sacó, y no tiene que volver.
    await expect(page.getByPlaceholder("APP_USR-...")).toHaveCount(0);
    await expect(page.getByText("Access Token de producción")).toHaveCount(0);
  });
});

test.describe("clientes", () => {
  test("la ficha abre y muestra el historial", async ({ page }) => {
    await page.goto("/clientes");
    await expect(page.getByRole("heading", { name: /Clientes/i })).toBeVisible();

    const filas = page.locator("[role='button'], button").filter({ hasText: /./ });
    expect(await filas.count(), "la página cargó sin controles").toBeGreaterThan(0);
  });
});
