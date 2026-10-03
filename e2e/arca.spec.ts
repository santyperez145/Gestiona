import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const orgId = "00000000-0000-4000-8000-000000000002", userId = "00000000-0000-4000-8000-000000000001";
const activation = "Ya delegué · solicitar activación";

// Synthetic identities; every Auth, DB and function request is intercepted. No ARCA emission or real writes.
async function mockFiscal(page: Page, options: { writable?: boolean; staff?: boolean; mismatch?: boolean; queueFailure?: boolean } = {}) {
  const url = process.env.VITE_SUPABASE_URL ?? "https://hummeopatkniwkyrrhwc.supabase.co";
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: "zz-fiscal@invalid.test", aud: "authenticated", role: "authenticated", created_at: "2026-10-03T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Prueba fiscal" }, identities: [],
    factors: options.staff ? [{ id: "00000000-0000-4000-8000-000000000003", factor_type: "totp", status: "verified" }] : [] };
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: expires, aal: options.staff ? "aal2" : "aal1" })).toString("base64url"), "synthetic-ui-only"].join(".");
  await page.addInitScript(({ storageKey, session, orgId }) => {
    localStorage.setItem(storageKey, JSON.stringify(session)); localStorage.setItem("gestiona.activeOrgId", orgId);
  }, { storageKey, orgId, session: { access_token: token, refresh_token: "synthetic-ui-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user } });
  let requested = false, verified = false, writeFailures = 1, queueFailures = options.queueFailure ? 1 : 0;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const connection = () => ({ org_id: orgId, cuit: "30712345671", razon_social: "ZZ Fiscal", domicilio: "ZZ Calle 1", tipo_emisor: "responsable_inscripto",
    environment: "homologacion", punto_venta: 12, ingresos_brutos: "Exento", inicio_actividades: "2020-01-01", configured: !options.mismatch,
    modo: "delegado", plataforma_lista: true, plataforma_cuit: "20123456786", plataforma_razon_social: "ZZ Plataforma",
    plataforma_ambiente: options.mismatch ? "produccion" : "homologacion", ticket_vigente: true, ta_expires_at: "2099-01-01T00:00:00Z",
    conexion_version: 7, delegacion_verificada: verified, motivo: options.mismatch ? "falta_ambiente" : verified ? "listo" : requested ? "esperando_plataforma" : "falta_delegar" });
  await page.route("**/*.supabase.co/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user;
    else if (path === "/rest/v1/settings") result = [{ org_id: orgId, user_id: userId, business_name: "ZZ Fiscal", business_logo: null }];
    else if (path === "/rest/v1/memberships") result = options.staff ? [] : [{ org_id: orgId, role: "owner", organization: { id: orgId, name: "ZZ Fiscal", slug: "zz-fiscal",
      owner_user_id: userId, onboarding_completed: true, onboarding_goal: "explore", plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path === "/rest/v1/platform_admins") result = options.staff ? { user_id: userId, role: "superadmin" } : null;
    else if (path === "/rest/v1/role_permissions" && options.writable === false) result = [{ module: "invoices", can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false }];
    else if (path === "/rest/v1/afip_connection_status") result = [connection()];
    else if (path === "/rest/v1/afip_platform_status") result = { configured: true, cuit: "20123456786", razon_social: "ZZ Plataforma", environment: "homologacion",
      ticket_vigente: true, ta_expires_at: "2099-01-01T00:00:00Z", comercios_delegados: 1, certificate_expires_at: "2099-01-01T00:00:00Z" };
    else if (path === "/rest/v1/platform_afip_delegation_queue") {
      if (queueFailures-- > 0) { await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "ZZ secret SQL failure" }) }); return; }
      result = [{ ...connection(), organization_name: "ZZ Comercio", delegacion_solicitada_at: "2026-10-03T10:00:00Z", estado: verified ? "verificada" : "pendiente" }];
    } else if (path.endsWith("/afip_solicitar_revision_delegacion") || path.endsWith("/afip-authorize")) {
      writes.push({ path, body: route.request().postDataJSON() });
      if (writeFailures-- > 0) { await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "ZZ secret SQL failure" }) }); return; }
      if (path.endsWith("/afip-authorize")) verified = true; else requested = true;
      result = { ok: true, environment: "homologacion", punto_venta: 12 };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  return writes;
}

test("synthetic fiscal: merchant request, recovery, permissions and responsive accessible form", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const writes = await mockFiscal(page);
  await page.goto("/afip");
  const button = page.getByRole("button", { name: activation });
  await expect(button).toBeEnabled();
  await expect(page.getByText("Conexión ARCA verificada", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Copiar CUIT de Nerqia" }).focus();
  await button.click();
  await expect(page.getByRole("alert")).toContainText("Tus datos se conservan");
  await expect(page.getByText(/ZZ secret|XX000|SQL failure/)).toHaveCount(0);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText("Activación solicitada a Nerqia", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2); expect(writes.every(write => write.path.endsWith("/afip_solicitar_revision_delegacion"))).toBe(true);
  await expect(page.getByLabel("CUIT del emisor")).toHaveValue("30712345671");
  for (const width of testInfo.project.name === "mobile" ? [360, 390] : [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `overflow ${width}`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`arca-merchant-${width}.png`), fullPage: true });
  }
  const violations = (await new AxeBuilder({ page }).include('section[aria-label="Datos fiscales"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
    .filter(violation => ["serious", "critical"].includes(violation.impact));
  expect(violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.failureSummary) }))).toEqual([]);
  expect(errors).toEqual([]);
});

test("synthetic fiscal: edit override and unavailable environment cannot request or verify", async ({ page }) => {
  const writes = await mockFiscal(page, { writable: false }); await page.goto("/afip");
  await expect(page.getByRole("button", { name: activation })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Guardar datos fiscales" })).toBeDisabled();
  await expect(page.getByLabel("CUIT del emisor")).toBeDisabled(); expect(writes).toEqual([]);
});

test("synthetic fiscal: mismatch does not ask for a production delegation", async ({ page }) => {
  const writes = await mockFiscal(page, { mismatch: true }); await page.goto("/afip");
  await expect(page.getByText("Revisá el ambiente fiscal", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: activation })).toHaveCount(0); expect(writes).toEqual([]);
});

test("synthetic fiscal: Platform queue recovers a read error and reviews without tenant membership", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  const writes = await mockFiscal(page, { staff: true, queueFailure: true }); await page.goto("/platform/afip");
  const queue = page.getByRole("region", { name: "Activaciones fiscales" });
  await expect(queue.getByRole("alert")).toContainText("no significa que la cola esté vacía");
  await expect(queue.getByText("No hay solicitudes de activación.", { exact: true })).toHaveCount(0);
  await queue.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(queue.getByText("ZZ Comercio", { exact: true })).toBeVisible();
  const button = queue.getByRole("button", { name: "Verificar con ARCA" });
  await button.click(); await expect(queue.getByRole("alert")).toBeVisible(); await expect(button).toBeEnabled();
  await button.click(); await expect(queue.getByText("Verificada", { exact: true })).toBeVisible();
  expect(writes).toEqual([{ path: "/functions/v1/afip-authorize", body: { action: "verificar_delegacion", org_id: orgId } },
    { path: "/functions/v1/afip-authorize", body: { action: "verificar_delegacion", org_id: orgId } }]);
  await expect(page.getByText(/ZZ secret|XX000|SQL failure/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Seleccionar certificado CRT" })).toBeVisible();
  const violations = (await new AxeBuilder({ page }).include('section[aria-label="Activaciones fiscales"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
    .filter(violation => ["serious", "critical"].includes(violation.impact));
  expect(violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.failureSummary) }))).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (testInfo.project.name === "mobile") {
    const navigation = page.getByRole("navigation", { name: "Secciones de plataforma" });
    const bounds = await navigation.boundingBox();
    expect(bounds?.height).toBeLessThan(64);
    await navigation.evaluate(node => { node.scrollLeft = node.scrollWidth; });
    await expect(navigation.getByRole("link", { name: "Anuncios", exact: true })).toBeInViewport();
    await navigation.evaluate(node => { node.scrollLeft = 0; });
  }
  await page.screenshot({ path: testInfo.outputPath("arca-platform.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
