import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const orgId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000001";
const transactionId = "00000000-0000-4000-8000-000000000003";
const sessionId = "00000000-0000-4000-8000-000000000004";
const invoiceId = "00000000-0000-4000-8000-000000000005";
type FiscalFixture = "draft" | "authorized" | "permission_error";

// Synthetic browser only. Intercept ALL Supabase requests, including writes;
// this cannot charge MP, alter a merchant or send a document.
async function mockPos(page: Page, state: "completed" | "manual_review" | "new", paid = true,
  fiscal?: FiscalFixture, role = "owner") {
  const url = process.env.VITE_SUPABASE_URL ?? "https://hummeopatkniwkyrrhwc.supabase.co";
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: "zz-pos@invalid.test", aud: "authenticated", role: "authenticated",
    created_at: "2026-10-07T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "ZZ Cajero" }, identities: [], factors: [] };
  const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: expires, aal: "aal1" })).toString("base64url"),
    Buffer.from("synthetic-ui-only").toString("base64url")].join(".");
  await page.addInitScript(({ storageKey, session, orgId }) => {
    localStorage.setItem(storageKey, JSON.stringify(session));
    localStorage.setItem("gestiona.activeOrgId", orgId);
    const printed: string[] = [];
    Object.assign(window, { zzPrinted: printed });
    document.addEventListener("load", event => {
      if (!(event.target instanceof HTMLIFrameElement) || event.target.title !== "Impresión de ticket") return;
      const frame = event.target;
      if (!frame.contentWindow) return;
      Object.defineProperty(frame.contentWindow, "print", { value: () => {
        printed.push(frame.srcdoc);
        setTimeout(() => frame.contentWindow?.dispatchEvent(new Event("afterprint")), 0);
      } });
    }, true);
  }, { storageKey, orgId, session: { access_token: token, refresh_token: "synthetic-ui-only",
    token_type: "bearer", expires_at: expires, expires_in: 3600, user } });
  const calls: Array<{ path: string; body: Record<string, unknown> | null }> = [];
  const qr = { session_id: sessionId, org_id: orgId, state: state === "new" ? "completed" : state, amount: 9000, platform_fee: 0, currency: "ARS",
    expires_at: "2026-10-08T00:00:00Z", provider_order_id: "ZZ_ORDER", payment_attempt_id: "ZZ_ATTEMPT",
    sale_transaction_id: state !== "manual_review" ? transactionId : null,
    failure_reason: state === "manual_review" ? "La cuenta receptora no coincide con el comercio conectado" : null,
    ...(fiscal ? { invoice_requested: true,
      invoice_preparation_error: fiscal === "permission_error" ? "permission_required" : null,
      invoice: fiscal === "permission_error" ? null : { ok: true, invoice_id: invoiceId, number: "ZZ-F-1",
        cae: fiscal === "authorized" ? "12345678901234" : null,
        afip_status: fiscal === "authorized" ? "authorized" : "pending" } } : {}) };
  await page.route("**/*.supabase.co/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postData() ? route.request().postDataJSON() : null;
    calls.push({ path, body });
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user;
    else if (path === "/rest/v1/memberships") result = [{ org_id: orgId, role, organization: {
      id: orgId, name: "ZZ Ferretería", slug: "zz-pos", owner_user_id: userId, onboarding_completed: true,
      onboarding_goal: "explore", plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path === "/rest/v1/settings") result = [{ org_id: orgId, user_id: userId,
      business_name: "ZZ Ferretería", exchange_rate: 1000, qr_discount_percent: 0 }];
    else if (path === "/rest/v1/products") result = [{ id: "zz-product", org_id: orgId, name: "ZZ Tornillos",
      brand: "ZZ", stock: 10, sale_price_ars: 100, cost_usd: 0.03, total_cost_usd: 0.03 }];
    else if (path.endsWith("/get_sales_plan_usage")) result = { sales_used: 0, max_sales_per_month: null };
    else if (path === "/functions/v1/mercadopago-pos-qr") {
      result = body?.action === "recover" ? { sessions: state === "new" ? [] : [qr] }
        : body?.action === "create" ? { session: { ...qr, state: "pending", sale_transaction_id: null, qr_data: "ZZ_TEST_QR_NOT_PAYABLE" } }
        : { session: qr };
    }
    else if (path === "/rest/v1/sale_transactions") result = [{ id: transactionId, source: "pos", occurred_at: "2026-10-07T15:00:00Z" }];
    else if (path === "/rest/v1/sales" && new URL(route.request().url()).searchParams.has("sale_transaction_id")) {
      result = [{ product_name: "ZZ Producto guardado", quantity: 2, total_ars: 9000,
        payment_method: "qr", paid, customer_name: "ZZ Cliente guardado" }];
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  return calls;
}

async function openPos(page: Page) {
  await page.goto("/caja");
  await page.getByRole("dialog", { name: "¿Quién atiende hoy?" }).getByRole("button", { name: "Omitir" }).click();
}

test("POS recovered QR: canonical print, no repeated sale; device preference survives reload", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const calls = await mockPos(page, "completed");
  await openPos(page);
  await expect(page.getByText("Venta QR recuperada", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Imprimir ticket", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { zzPrinted: string[] }).zzPrinted.length)).toBe(1);
  const html = await page.evaluate(() => (window as Window & { zzPrinted: string[] }).zzPrinted[0]);
  expect(html).toContain("ZZ Producto guardado"); expect(html).toContain("ZZ Cliente guardado");
  expect(html).toContain("9.000,00"); expect(html).not.toContain("ZZ Tornillos");
  expect(html).toContain("No es un comprobante fiscal");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const violations = (await new AxeBuilder({ page }).include("[data-pos-qr-recovery]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations
    .filter(item => ["critical", "serious"].includes(item.impact));
  expect(violations).toEqual([]);
  const screenshotPath = testInfo.outputPath("pos-qr-recovered.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("POS recovered receipt", { path: screenshotPath, contentType: "image/png" });
  expect(calls.some(call => call.path.includes("create_sales_transaction") || call.body?.action === "create")).toBe(false);
  const toggle = page.getByRole("switch", { name: /Imprimir ticket al cerrar/ });
  if ((page.viewportSize()?.width ?? 1440) < 1280) await page.getByRole("button", { name: "Abrir carrito", exact: true }).click();
  await toggle.click(); await expect(toggle).toBeChecked();
  await page.reload();
  await page.getByRole("dialog", { name: "¿Quién atiende hoy?" }).getByRole("button", { name: "Omitir" }).click();
  if ((page.viewportSize()?.width ?? 1440) < 1280) await page.getByRole("button", { name: "Abrir carrito", exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => page.evaluate(() => (window as Window & { zzPrinted: string[] }).zzPrinted.length)).toBe(0);
  expect(errors).toEqual([]);
});

test("POS manual review: consults original session without cancel/recharge", async ({ page }) => {
  const calls = await mockPos(page, "manual_review");
  await openPos(page);
  await expect(page.getByText("Cobro QR requiere revisión", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Consultar el mismo cobro", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/La cuenta receptora/)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: /otro medio|Cancelar intento/ })).toHaveCount(0);
  expect(calls.filter(call => call.body?.action === "resume").map(call => call.body?.sessionId)).toEqual([sessionId]);
  expect(calls.some(call => ["create", "cancel"].includes(String(call.body?.action)))).toBe(false);
});

test("POS refuses automatic-style print when canonical ticket is not fully paid", async ({ page }) => {
  await mockPos(page, "completed", false);
  await openPos(page);
  await page.getByRole("button", { name: "Imprimir ticket", exact: true }).click();
  await expect(page.getByText(/El ticket no tiene el cobro completo registrado/)).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { zzPrinted: string[] }).zzPrinted.length)).toBe(0);
});

test("POS new QR: waits for server completion, automatically prints saved ticket only once", async ({ page }) => {
  const calls = await mockPos(page, "new");
  await openPos(page);
  await page.getByRole("button", { name: /ZZ Tornillos/ }).click();
  await page.getByRole("switch", { name: /Imprimir ticket al cerrar/ }).click();
  const more = page.getByRole("button", { name: "Más medios", exact: true });
  if (await more.isVisible()) await more.click();
  await page.getByRole("button", { name: "QR", exact: true }).click();
  await page.getByRole("button", { name: /Generar QR y cobrar/ }).click();
  await expect(page.getByRole("dialog", { name: "Cobro presencial seguro" })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { zzPrinted: string[] }).zzPrinted.length)).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as Window & { zzPrinted: string[] }).zzPrinted.length)).toBe(1);
  await expect(page.getByRole("dialog", { name: "Cobro presencial seguro" })).toHaveCount(0);
  const html = await page.evaluate(() => (window as Window & { zzPrinted: string[] }).zzPrinted[0]);
  expect(html).toContain("ZZ Producto guardado"); expect(html).toContain("9.000,00");
  expect(calls.filter(call => call.path === "/functions/v1/mercadopago-pos-qr" && call.body?.action === "create")).toHaveLength(1);
  expect(calls.some(call => call.path.includes("create_sales_transaction"))).toBe(false);
  expect(calls.filter(call => call.body?.action === "status").length).toBeGreaterThan(0);
});

for (const fiscal of ["draft", "authorized"] as const) {
  test(`POS fiscal QR ${fiscal}: persisted request, canonical status, no browser invoice creation`, async ({ page }) => {
    const calls = await mockPos(page, "new", true, fiscal);
    await openPos(page);
    await page.getByRole("button", { name: /ZZ Tornillos/ }).click();
    await page.getByRole("button", { name: /También facturar en ARCA/ }).click();
    const more = page.getByRole("button", { name: "Más medios", exact: true });
    if (await more.isVisible()) await more.click();
    await page.getByRole("button", { name: "QR", exact: true }).click();
    await page.getByRole("button", { name: /Generar QR y cobrar/ }).click();
    await expect(page.getByRole("dialog", { name: "Cobro presencial seguro" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Cobro presencial seguro" })).toHaveCount(0);
    if (fiscal === "draft") {
      await expect(page.getByText("Comprobante creado. Falta el CAE de ARCA.", { exact: false })).toBeVisible();
      await expect(page.getByText("Factura autorizada", { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText("Factura autorizada", { exact: false })).toBeVisible();
      await expect(page.getByText(/CAE 12345678901234/)).toBeVisible();
    }
    expect(calls.filter(call => call.body?.action === "create").map(call => call.body?.requestInvoice)).toEqual([true]);
    expect(calls.some(call => /facturar_venta_pos|afip-authorize|create_sales_transaction/.test(call.path))).toBe(false);
    expect(await page.evaluate(() => (window as Window & { zzPrinted: string[] }).zzPrinted.length)).toBe(0);
  });
}

test("POS recovered fiscal request: shows server draft after reload without resending or fabricating CAE", async ({ page }, testInfo) => {
  const calls = await mockPos(page, "completed", true, "draft");
  await openPos(page);
  const recovery = page.locator("[data-pos-qr-recovery]");
  await expect(recovery.getByText(/Factura preparada en servidor; falta la autorización/)).toBeVisible();
  await expect(recovery.getByRole("link", { name: "Ver facturación" })).toHaveAttribute("href", "/facturas");
  await expect(recovery.getByText(/Factura autorizada|CAE/)).toHaveCount(0);
  await page.reload();
  await page.getByRole("dialog", { name: "¿Quién atiende hoy?" }).getByRole("button", { name: "Omitir" }).click();
  await expect(recovery.getByText(/Factura preparada en servidor; falta la autorización/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const violations = (await new AxeBuilder({ page }).include("[data-pos-qr-recovery]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations
    .filter(item => ["critical", "serious"].includes(item.impact));
  expect(violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("pos-qr-fiscal-recovered.png") });
  expect(calls.some(call => call.body?.action === "create" || /facturar_venta_pos|afip-authorize/.test(call.path))).toBe(false);
  expect(await page.evaluate(() => (window as Window & { zzPrinted: string[] }).zzPrinted.length)).toBe(0);
});

test("POS fiscal permission revoked: paid ticket survives, cashier sees recovery without admin route", async ({ page }) => {
  const calls = await mockPos(page, "completed", true, "permission_error", "vendedor");
  await openPos(page);
  const recovery = page.locator("[data-pos-qr-recovery]");
  await expect(recovery.getByText(/Venta QR recuperada/)).toBeVisible();
  await expect(recovery.getByText(/Un encargado con permiso fiscal/)).toBeVisible();
  await expect(recovery.getByRole("link", { name: "Ver facturación" })).toHaveCount(0);
  await page.getByRole("button", { name: "Imprimir ticket", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { zzPrinted: string[] }).zzPrinted.length)).toBe(1);
  expect(calls.some(call => call.body?.action === "create" || /facturar_venta_pos|afip-authorize/.test(call.path))).toBe(false);
});
