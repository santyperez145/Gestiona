import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const orgId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000001";
const product = { productId: "zz-product", productName: `Producto ${"NombreExtendido".repeat(12)}`, channel: "pos",
  lines: 1007, units: 1007, revenueARS: 10110.05, cogsARS: null, paymentFeeARS: 0, shippingCostARS: 0,
  taxARS: null, contributionMarginARS: null, coveragePct: 75, pendingCodes: ["iva", "devolucion_neta"] };

async function assertProfitContrast(page: Page, context: string) {
  const violations = (await new AxeBuilder({ page }).include('section[aria-label="Rentabilidad por producto y canal"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations
    .filter(item => ["critical", "serious"].includes(item.impact));
  expect(violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) })), context).toEqual([]);
}

async function setProfitTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate(theme => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
  }, theme);
}
function operation(index: number) {
  return { org_id: orgId, operation_key: `zz-operation-${index}`, operation_id: `zz-id-${index}`, operation_reference: `ZZ-${index}`,
    operation_type: "venta", channel: "pos", recorded_source: "pos", sold_at: "2026-09-30T15:00:00Z", line_count: 1, units: 1,
    revenue_ars: 10.01, cogs_ars: 3.01, payment_fee_ars: 0, shipping_cost_ars: 0, tax_ars: null, contribution_margin_ars: null,
    known_components: 3, coverage_pct: 75, missing_components: ["iva"], margin_blockers: [], is_explainable: false, quality_status: "partial",
    cogs_sources: ["sale_snapshot"], payment_fee_sources: ["cash_not_applicable"], shipping_sources: ["pos_not_applicable"], tax_sources: [],
    payment_methods: ["efectivo"], payment_mix: [{ method: "efectivo", amount_ars: 10.01 }], payment_mix_difference_ars: 0,
    has_promotion: false, measured_discount_ars: 0, coupon_codes: [], price_discount_lines: 0, promotion_missing_evidence: [],
    promotion_evidence_status: "not_applicable", returned_units: 0 };
}

// Synthetic UI only. All Supabase traffic is intercepted, including Auth and writes.
async function mockProfit(page: Page, failFirst = false) {
  const url = process.env.VITE_SUPABASE_URL ?? "https://hummeopatkniwkyrrhwc.supabase.co";
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: "zz-profit@invalid.test", aud: "authenticated", role: "authenticated", created_at: "2026-10-02T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Prueba Profit" }, identities: [], factors: [] };
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: expires, aal: "aal1" })).toString("base64url"), "synthetic-ui-only"].join(".");
  await page.addInitScript(({ storageKey, session, orgId }) => {
    localStorage.setItem(storageKey, JSON.stringify(session)); localStorage.setItem("gestiona.activeOrgId", orgId);
  }, { storageKey, orgId, session: { access_token: token, refresh_token: "synthetic-ui-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user } });
  const calls: Record<string, unknown>[] = [];
  let fail = failFirst;
  await page.route("**/*.supabase.co/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user;
    else if (path === "/rest/v1/settings") result = [{ org_id: orgId, user_id: userId, business_name: "ZZ Profit", business_logo: null }];
    else if (path === "/rest/v1/memberships") result = [{ org_id: orgId, role: "owner", organization: { id: orgId, name: "ZZ Profit", slug: "zz-profit",
      owner_user_id: userId, onboarding_completed: true, onboarding_goal: "explore", plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path.endsWith("/get_profit_period")) {
      const body = route.request().postDataJSON(); calls.push(body);
      if (fail) { fail = false; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "internal synthetic error" }) }); return; }
      const productPage = Number(body.p_product_page), operationPage = Number(body.p_operation_page);
      result = { version: 1, currency: "ARS", timeZone: "America/Argentina/Buenos_Aires", from: body.p_from, to: body.p_to,
        pageSize: 25, productCount: 26, operationCount: 27, productPage, operationPage,
        coverage: { lines: 1007, explainableLines: 0, revenueARS: 10110.05, explainableRevenueARS: 0, explainableRevenuePct: 0,
          averageCoveragePct: 75, cogsKnownLines: 1006, paymentFeeKnownLines: 1007, shippingKnownLines: 1007, taxKnownLines: 0,
          measuredContributionARS: null, contributionMarginARS: null },
        products: productPage === 1 ? Array.from({ length: 25 }, (_, index) => ({ ...product, productId: `zz-${index}` })) : [{ ...product, productName: "Último producto", productId: "zz-last" }],
        operations: operationPage === 1 ? Array.from({ length: 25 }, (_, index) => operation(index)) : [operation(25), operation(26)] };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  return calls;
}

test("synthetic Profit: complete population, pagination, keyboard, persistence and responsive", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const calls = await mockProfit(page);
  await page.goto("/profit?df=2026-09-01&dt=2026-09-30");
  await expect(page).toHaveURL(/\/analytics\?.*vista=rentabilidad/);
  await expect(page.getByRole("heading", { name: "Rentabilidad del período" })).toBeVisible();
  await expect(page.getByText("27 operaciones · 1007 líneas", { exact: true })).toBeVisible();
  expect(calls[0]).toMatchObject({ p_org_id: orgId, p_from: "2026-09-01", p_to: "2026-09-30", p_page_size: 25 });
  const section = page.getByRole("region", { name: "Rentabilidad por producto y canal" });
  await section.getByRole("button", { name: "Ir a la página siguiente" }).click();
  await expect(section.getByText("Último producto", { exact: true })).toBeVisible();
  await expect(section.getByText("27 operaciones · 1007 líneas", { exact: true })).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await setProfitTheme(page, theme);
    await assertProfitContrast(page, `products in ${theme} theme`);
  }
  await setProfitTheme(page, "light");
  await section.getByRole("tab", { name: "Producto y canal", exact: true }).press("ArrowRight");
  await expect(section.getByRole("tab", { name: "Operaciones", exact: true })).toBeFocused();
  await section.getByRole("button", { name: "Ir a la página siguiente" }).click();
  await expect(section.getByText("2 de 27 operaciones", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Explicar operación" }).first().click();
  await expect(section.getByText("Mix de cobro persistido", { exact: true })).toBeVisible();
  const widths = testInfo.project.name === "mobile" ? [360, 390] : [768, 1024, 1280, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `page overflow at ${width}`).toBe(true);
    expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth), `Profit overflow at ${width}`).toBe(true);
    const pendingCell = section.getByRole("table", { name: "Margen por operación" }).locator("tbody > tr").first().locator("td").nth(5);
    expect((await pendingCell.boundingBox())!.width, `margin cell too narrow at ${width}`).toBeGreaterThan(65);
    await page.screenshot({ path: testInfo.outputPath(`profit-${width}.png`), fullPage: true });
  }
  for (const theme of ["light", "dark"] as const) {
    await setProfitTheme(page, theme);
    await assertProfitContrast(page, `expanded operations in ${theme} theme`);
  }
  await setProfitTheme(page, "light");
  await page.reload();
  await expect(section.getByRole("tab", { name: "Operaciones", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

test("synthetic Profit source error is recoverable, not a zero or guessed margin", async ({ page }) => {
  await mockProfit(page, true);
  await page.goto("/analytics?vista=rentabilidad");
  await expect(page.getByText("No pudimos cargar rentabilidad", { exact: true })).toBeVisible();
  await expect(page.getByText("Ingresos del período", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Volver a intentar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rentabilidad del período" })).toBeVisible();
});
