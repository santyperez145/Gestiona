import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [360, 390, 768, 1024, 1280, 1440]) {
  test(`planes ${width}px: precios reales, comparación y ausencia de desbordes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/precios");
    await expect(page.getByRole("article")).toHaveCount(4);
    await expect(page.getByRole("article").first()).toHaveCSS("border-top-width", "4px");
    await expect(page.getByRole("article").first()).toHaveCSS("border-top-color", "rgb(20, 128, 108)");
    await expect(
      page.getByRole("heading", { name: "Inicial", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article").first()).toContainText("Gratis");
    await expect(page.getByRole("article").nth(1)).toContainText("$19.900");
    await expect(page.getByRole("article").nth(1)).toContainText(
      "300 acciones/mes",
    );
    await page.getByRole("button", { name: "Anual", exact: true }).click();
    await expect(page.getByRole("article").nth(1)).toContainText(
      "$179.100 ARS en un pago anual",
    );
    await expect(page.getByRole("article").nth(1)).toContainText("Ahorrás 25%");
    await page.getByRole("tab", { name: "Diseño y marketing" }).click();
    await expect(page.getByRole("tabpanel")).toContainText("Editor visual");
    if (width < 1024) {
      await page.getByRole("combobox", { name: "Plan a comparar" }).click();
      await page.getByRole("option", { name: "Pro", exact: true }).click();
      await expect(
        page.getByRole("columnheader", { name: "Pro", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Inicial", exact: true }),
      ).toHaveCount(0);
    }
    await page.getByRole("tab", { name: "Gestión y seguridad" }).click();
    await expect(page.getByRole("tabpanel")).toContainText(
      "Inteligencia artificial",
    );
    await page
      .getByRole("button", {
        name: "¿La tienda gratuita vence después de 14 días?",
      })
      .click();
    await expect(
      page.getByText("No. Tu tienda, productos, ventas y equipo", {
        exact: false,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/planes-${width}.png`,
      fullPage: true,
    });
  });
}

for (const theme of ["light", "dark"]) {
  test(`planes ${theme}: accesibilidad y registro sin invocar pagos`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("gestiona-theme", value),
      theme,
    );
    await page.goto("/precios");
    await expect(page.getByRole("article")).toHaveCount(4);
    await expect(page.locator("html")).toHaveClass(
      new RegExp(`\\b${theme}\\b`),
    );
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      result.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      ),
    ).toEqual([]);
    let payments = 0;
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/mp-subscribe")) payments++;
    });
    await page
      .getByRole("button", { name: "Crear tienda gratis", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login\?mode=register/);
    expect(payments).toBe(0);
  });
}

test("planes: fallo de lectura recuperable, no muestra un catálogo vacío ni precios falsos", async ({
  page,
}) => {
  await page.route("**/rest/v1/plans?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"message":"ZZ transient unavailable"}',
    }),
  );
  await page.goto("/precios");
  await expect(page.getByRole("alert")).toContainText(
    "No pudimos cargar los planes",
  );
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.unroute("**/rest/v1/plans?*");
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(4);
});
