import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Conectar ARCA con certificado propio (ADR 007), con identidades sintéticas:
 * toda llamada a Auth, base y funciones se intercepta. No emite nada ni
 * escribe en ninguna base.
 */
test.use({ serviceWorkers: "block" });
const orgId = "00000000-0000-4000-8000-000000000012", userId = "00000000-0000-4000-8000-000000000011";
const CSR = "-----BEGIN CERTIFICATE REQUEST-----\nZZ\n-----END CERTIFICATE REQUEST-----\n";

async function simular(page: Page, estado: Record<string, unknown>) {
  const url = process.env.VITE_SUPABASE_URL ?? "https://hummeopatkniwkyrrhwc.supabase.co";
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: "zz-cert@invalid.test", aud: "authenticated", role: "authenticated", created_at: "2026-10-22T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Prueba certificado" }, identities: [], factors: [] };
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: expires, aal: "aal1" })).toString("base64url"), Buffer.from("synthetic-ui-only").toString("base64url")].join(".");
  await page.addInitScript(({ storageKey, session, orgId }) => {
    localStorage.setItem(storageKey, JSON.stringify(session)); localStorage.setItem("gestiona.activeOrgId", orgId);
  }, { storageKey, orgId, session: { access_token: token, refresh_token: "synthetic-ui-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user } });
  const llamadas: { path: string; body: unknown }[] = [];
  const conexion = () => ({ org_id: orgId, cuit: "23228915599", razon_social: "ZZ Comercio", domicilio: "ZZ Calle 1", tipo_emisor: "monotributo",
    environment: "produccion", punto_venta: 3, ingresos_brutos: "Exento", inicio_actividades: "2020-01-01", modo: "propio",
    plataforma_lista: true, plataforma_cuit: "20123456786", plataforma_razon_social: "ZZ Plataforma", plataforma_ambiente: "produccion",
    ticket_vigente: false, ta_expires_at: null, conexion_version: 1, delegacion_verificada: false, configured: false, last_error: null, ...estado });
  await page.route("**/*.supabase.co/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user;
    else if (path === "/rest/v1/settings") result = [{ org_id: orgId, user_id: userId, business_name: "ZZ Comercio", business_logo: null }];
    else if (path === "/rest/v1/memberships") result = [{ org_id: orgId, role: "owner", organization: { id: orgId, name: "ZZ Comercio", slug: "zz-comercio",
      owner_user_id: userId, onboarding_completed: true, onboarding_goal: "explore", plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path === "/rest/v1/platform_admins") result = null;
    else if (path === "/rest/v1/afip_connection_status") result = [conexion()];
    else if (path.endsWith("/afip-credentials")) {
      const body = route.request().postDataJSON();
      llamadas.push({ path, body });
      result = body?.action === "generar_pedido" ? { ok: true, csr: CSR, alias: "nerqia", cuit: "23228915599", ambiente: "produccion" } : { ok: true };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  return llamadas;
}

test("certificado propio: guía completa, pedido descargable y sin clave fiscal", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errores: string[] = []; page.on("pageerror", e => errores.push(e.message));
  const llamadas = await simular(page, { motivo: "falta_certificado_propio" });
  await page.goto("/afip");
  const tarjeta = page.locator("#conectar-arca");
  await expect(tarjeta.getByText("Conectá ARCA con tu certificado")).toBeVisible();
  await expect(tarjeta.getByText(/Nerqia nunca te pide la clave fiscal/)).toBeVisible();
  await expect(tarjeta.getByText("Asocialo a Facturación Electrónica")).toBeVisible();
  await expect(tarjeta.getByText(/Factura Electrónica - Monotributo - Web Services/)).toBeVisible();

  const descarga = page.waitForEvent("download");
  await tarjeta.getByRole("button", { name: "Generar pedido" }).click();
  expect((await descarga).suggestedFilename()).toBe("nerqia-23228915599-prod.csr");
  expect(llamadas).toContainEqual({ path: expect.stringMatching(/afip-credentials$/), body: { org_id: orgId, action: "generar_pedido", environment: "produccion" } });
  // Nadie le pide la clave fiscal ni una contraseña.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  for (const ancho of testInfo.project.name === "mobile" ? [360, 390] : [768, 1280]) {
    await page.setViewportSize({ width: ancho, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `desborde ${ancho}`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`arca-certificado-propio-${ancho}.png`), fullPage: true });
  }
  const violaciones = (await new AxeBuilder({ page }).include("#conectar-arca").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
    .filter(v => ["serious", "critical"].includes(v.impact ?? ""));
  expect(violaciones.map(v => ({ id: v.id, nodos: v.nodes.map(n => n.failureSummary) }))).toEqual([]);
  expect(errores).toEqual([]);
});

test("certificado propio: falta asociar explica el paso y deja probar de nuevo", async ({ page }) => {
  await simular(page, { motivo: "certificado_rechazado", certificado_vence: "2028-10-22T00:00:00Z", certificado_verificado_ok: false,
    certificado_verificado_motivo: "El certificado es válido, pero en ARCA todavía no está asociado a Facturación Electrónica." });
  await page.goto("/afip");
  await expect(page.getByText("Falta un paso en ARCA")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ya lo asocié · probar de nuevo" })).toBeEnabled();
  await expect(page.getByText("Falta asociar el certificado a Facturación Electrónica")).toBeVisible();
});
