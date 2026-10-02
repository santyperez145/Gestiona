import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const orgId = "00000000-0000-4000-8000-000000000002", userId = "00000000-0000-4000-8000-000000000001";
const firstName = `ZZ Capital ${"NombreExtenso".repeat(18)}`;
function item(index: number) {
  return { product_id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`, variant_id: null,
    product_name: index === 25 ? "ZZ Última posición" : firstName, variant_name: null, sku: `ZZ-${index}`,
    stock_units: 2, known_units: 1, unvalued_units: 1, measured_value_ars: 10, value_ars: null, coverage_pct: 50, reasons: ["missing_cost"],
    layers: [{ movementId: null, receivedAt: null, source: "opening", remainingUnits: 1, unitCostARS: null, valueARS: null },
      { movementId: "00000000-0000-4000-8000-000000000004", receivedAt: "2026-10-01T10:00:00Z", source: "movement_snapshot", remainingUnits: 1, unitCostARS: 10, valueARS: 10 }],
    last_sold_at: null, sold_units_90: 0, days_without_sale: null, days_of_stock: null };
}

// Synthetic session and intercepted DB/writes; this does not use a real signed-in merchant.
async function mockCapital(page: Page, failures = { read: 0, capture: 0 }, writable = true) {
  const url = process.env.VITE_SUPABASE_URL ?? "https://hummeopatkniwkyrrhwc.supabase.co";
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: "zz-capital@invalid.test", aud: "authenticated", role: "authenticated", created_at: "2026-10-02T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Prueba Capital" }, identities: [], factors: [] };
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: expires, aal: "aal1" })).toString("base64url"), "synthetic-ui-only"].join(".");
  await page.addInitScript(({ storageKey, session, orgId }) => {
    localStorage.setItem(storageKey, JSON.stringify(session)); localStorage.setItem("gestiona.activeOrgId", orgId);
  }, { storageKey, orgId, session: { access_token: token, refresh_token: "synthetic-ui-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user } });
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  let captured = false;
  await page.route("**/*.supabase.co/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user;
    else if (path === "/rest/v1/settings") result = [{ org_id: orgId, user_id: userId, business_name: "ZZ Capital", business_logo: null }];
    else if (path === "/rest/v1/memberships") result = [{ org_id: orgId, role: "owner", organization: { id: orgId, name: "ZZ Capital", slug: "zz-capital",
      owner_user_id: userId, onboarding_completed: true, onboarding_goal: "explore", plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path === "/rest/v1/role_permissions" && !writable) result = [{ module: "inventory", can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false }];
    else if (path.endsWith("/get_inventory_capital") || path.endsWith("/capture_inventory_capital")) {
      const body = route.request().postDataJSON(); const isCapture = path.endsWith("/capture_inventory_capital");
      calls.push({ name: isCapture ? "capture" : "read", body });
      const key = isCapture ? "capture" : "read";
      if (failures[key] > 0) { failures[key]--; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "Synthetic internal detail must not be shown" }) }); return; }
      if (isCapture) {
        result = { orgId, date: body.p_date, status: captured ? "already_recorded" : "recorded" }; captured = true;
      } else {
        const empty = body.p_search === "no-match", pageNumber = empty ? 1 : Math.min(body.p_page, 2);
        const layerPage = empty ? 1 : Math.min(body.p_layer_page, 3);
        const layers = Array.from({ length: 26 }, (_, index) => item(index)).flatMap(row => row.layers.map(layer => ({ ...layer, product_id: row.product_id,
          product_name: row.product_name, variant_id: row.variant_id, variant_name: row.variant_name, sku: row.sku })));
        result = { version: 1, orgId, currency: "ARS", method: "fifo_movement_snapshot", asOf: "2026-10-02T15:00:00Z", snapshotDate: "2026-10-02",
          search: body.p_search, page: pageNumber, pageSize: 25, itemCount: empty ? 0 : 26, historyPage: 1, historyCount: captured ? 1 : 0,
          summary: empty ? { stockUnits: 0, positiveUnits: 0, knownUnits: 0, unvaluedUnits: 0, blockedItems: 0, valueARS: null, measuredValueARS: null, slowCapitalARS: null, coveragePct: null }
            : { stockUnits: 52, positiveUnits: 52, knownUnits: 26, unvaluedUnits: 26, blockedItems: 0, valueARS: null, measuredValueARS: 260, slowCapitalARS: null, coveragePct: 50 },
          layerCount: empty ? 0 : 52, layerPage, layers: empty ? [] : layers.slice((layerPage - 1) * 25, layerPage * 25),
          items: empty ? [] : pageNumber === 1 ? Array.from({ length: 25 }, (_, index) => item(index)) : [item(25)],
          history: captured ? [{ snapshot_date: "2026-10-02", captured_at: "2026-10-02T15:00:00Z", products: 26, verified: true, units: 52, value_ars: null, measured_value_ars: 260 }] : [] };
      }
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  return calls;
}

test("synthetic capital: persistent views, full totals, real download, snapshot and accessible responsive tables", async ({ page }, testInfo) => {
  test.setTimeout(65_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const calls = await mockCapital(page);
  await page.goto("/valuacion-inventario");
  const section = page.getByRole("region", { name: "Capital en inventario" });
  await expect(section.getByText("Capital parcialmente explicado", { exact: true })).toBeVisible();
  await expect(section.getByText(/^26 posiciones · Lectura/)).toBeVisible();
  await expect(section.getByText(/missing_cost|fifo_movement_snapshot/)).toHaveCount(0);
  const downloadEvent = page.waitForEvent("download");
  await section.getByRole("button", { name: "Exportar página" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("capital-inventario_2026-10-02_pagina-1.csv");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("FIFO sobre costo registrado en Kardex"); expect(csv).toContain('"1 de 2"');
  expect(csv).toContain("Completar evidencia de costo histórico"); expect(csv).not.toContain("missing_cost");
  await section.getByRole("button", { name: "Ir a la página siguiente" }).click();
  await expect(section.getByText("ZZ Última posición", { exact: true })).toBeVisible();
  await expect(section.getByText(/^26 posiciones · Lectura/)).toBeVisible();
  await section.getByRole("tab", { name: "Valuación", exact: true }).press("ArrowRight");
  await expect(section.getByRole("tab", { name: "Capas de costo", exact: true })).toBeFocused();
  await expect(section.getByText("Saldo inicial sin costo", { exact: true }).first()).toBeVisible();
  await section.getByRole("button", { name: "Ir a la página siguiente" }).click();
  await section.getByRole("button", { name: "Ir a la página siguiente" }).click();
  await expect(section.getByText("51–52 de 52 capas", { exact: true })).toBeVisible();
  for (const width of testInfo.project.name === "mobile" ? [360, 390] : [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `page overflow ${width}`).toBe(true);
    expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth), `region overflow ${width}`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`inventory-capital-${width}.png`), fullPage: true });
  }
  for (const tab of ["Valuación", "Capas de costo", "Rotación", "Histórico"]) {
    await section.getByRole("tab", { name: tab, exact: true }).click();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(async theme => {
        document.documentElement.classList.remove("light", "dark"); document.documentElement.classList.add(theme);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        await Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => undefined)));
      }, theme);
      const violations = (await new AxeBuilder({ page }).include('section[aria-label="Capital en inventario"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations
        .filter(violation => ["serious", "critical"].includes(violation.impact));
      expect(violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) })), `${tab} ${theme}`).toEqual([]);
    }
  }
  await section.getByRole("button", { name: "Guardar cierre del día" }).click();
  await expect(section.getByText("Cierre del día guardado para toda la organización.", { exact: true })).toBeVisible();
  await expect(section.getByRole("table", { name: "Cierres diarios de inventario" })).toBeVisible();
  expect(calls.filter(call => call.name === "capture").map(call => call.body)).toEqual([{ p_org_id: orgId, p_date: "2026-10-02" }]);
  await page.reload();
  await expect(section.getByRole("tab", { name: "Histórico" })).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

test("synthetic capital: read and capture errors recover without exposing internal details", async ({ page }) => {
  const calls = await mockCapital(page, { read: 1, capture: 1 });
  await page.goto("/valuacion-inventario");
  await expect(page.getByText("No pudimos cargar capital", { exact: true })).toBeVisible();
  await expect(page.getByText(/XX000|Synthetic internal/)).toHaveCount(0);
  await page.getByRole("button", { name: "Volver a intentar" }).click();
  await expect(page.getByText("Capital parcialmente explicado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Guardar cierre del día" }).click();
  await expect(page.getByText("No se confirmó el cierre", { exact: true })).toBeVisible();
  await expect(page.getByText("Cierre del día guardado para toda la organización.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Guardar cierre del día" }).click();
  await expect(page.getByText("Cierre del día guardado para toda la organización.", { exact: true })).toBeVisible();
  expect(calls.filter(call => call.name === "capture")).toHaveLength(2);
});

test("synthetic capital: literal search, empty recovery and read-only permissions", async ({ page }) => {
  const calls = await mockCapital(page, { read: 0, capture: 0 }, false);
  await page.goto("/valuacion-inventario?pagina=2");
  await expect(page.getByText("ZZ Última posición", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exportar página" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guardar cierre del día" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Buscar producto o SKU" }).fill("no-match");
  await page.getByRole("region", { name: "Capital en inventario" }).getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByText("Sin posiciones para esta búsqueda", { exact: true })).toBeVisible();
  expect(calls.at(-1)!.body.p_page).toBe(1);
  await page.getByRole("button", { name: "Limpiar búsqueda" }).click();
  await expect(page.getByText("Capital parcialmente explicado", { exact: true })).toBeVisible();
  expect(calls.at(-1)!.body.p_search).toBe("");
});
