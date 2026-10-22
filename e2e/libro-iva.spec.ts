import { expect, test, type Page } from "@playwright/test";

/**
 * Libro IVA Digital con identidades sintéticas: importar «Mis Comprobantes -
 * Recibidos» y bajar el Excel para el contador pasan por SheetJS cargado a
 * demanda en el bundle de producción, algo que los tests unitarios no cubren.
 * Toda llamada se intercepta: no escribe en ninguna base.
 */
test.use({ serviceWorkers: "block" });
const orgId = "00000000-0000-4000-8000-000000000022", userId = "00000000-0000-4000-8000-000000000021";

function mesAnterior(): string {
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function simular(page: Page) {
  const url = process.env.VITE_SUPABASE_URL ?? "https://hummeopatkniwkyrrhwc.supabase.co";
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: "zz-iva@invalid.test", aud: "authenticated", role: "authenticated", created_at: "2026-10-22T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Prueba IVA" }, identities: [], factors: [] };
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: expires, aal: "aal1" })).toString("base64url"), Buffer.from("synthetic-ui-only").toString("base64url")].join(".");
  await page.addInitScript(({ storageKey, session, orgId }) => {
    localStorage.setItem(storageKey, JSON.stringify(session)); localStorage.setItem("gestiona.activeOrgId", orgId);
  }, { storageKey, orgId, session: { access_token: token, refresh_token: "synthetic-ui-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user } });

  const periodo = mesAnterior();
  const factura = { id: "zz-f1", number: "F-1", issue_date: `${periodo}-10`, tipo_comprobante: 1, punto_venta: 3, numero_afip: 125,
    customer_tax_id: "30712345671", customer_name: "ZZ Cliente", subtotal: 10000, tax_amount: 2100, tax_pct: 21, total: 12100,
    afip_environment: "produccion", afip_status: "authorized", cae: "71234567890123", status: "sent", invoice_items: [] };
  const insertadas: unknown[] = [];
  await page.route("**/*.supabase.co/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user;
    else if (path === "/rest/v1/settings") result = [{ org_id: orgId, user_id: userId, business_name: "ZZ Comercio", business_logo: null }];
    else if (path === "/rest/v1/memberships") result = [{ org_id: orgId, role: "owner", organization: { id: orgId, name: "ZZ Comercio", slug: "zz-iva",
      owner_user_id: userId, onboarding_completed: true, onboarding_goal: "explore", plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path === "/rest/v1/platform_admins") result = null;
    else if (path === "/rest/v1/afip_connection_status") result = [{ org_id: orgId, cuit: "20123456786", razon_social: "ZZ Comercio SA", domicilio: "ZZ 1",
      tipo_emisor: "responsable_inscripto", environment: "produccion", punto_venta: 3, ingresos_brutos: "Exento", inicio_actividades: "2020-01-01",
      modo: "propio", motivo: "listo", configured: true, delegacion_verificada: true, certificado_vence: "2028-10-22T00:00:00Z", certificado_verificado_ok: true }];
    else if (path === "/rest/v1/invoices") result = [factura];
    else if (path === "/rest/v1/comprobantes_de_compra") {
      if (req.method() === "POST") { const filas = req.postDataJSON() as unknown[]; insertadas.push(...filas); result = filas.map((_, i) => ({ id: `zz-c${i}` })); }
      else result = [];
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  return { periodo, insertadas };
}

test("Libro IVA: importar Mis Comprobantes y bajar el Excel para el contador", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "El flujo de archivos se prueba en escritorio.");
  test.setTimeout(60_000);
  const errores: string[] = []; page.on("pageerror", e => errores.push(e.message));
  const { periodo, insertadas } = await simular(page);
  await page.goto("/afip");
  const libro = page.getByRole("region", { name: "Libro IVA Digital" });
  await expect(libro.getByText("IVA débito fiscal")).toBeVisible();

  const csv = [
    "Fecha de Emisión;Tipo de Comprobante;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Emisor;Nro. Doc. Emisor;Denominación Emisor;Tipo Cambio;Moneda;Imp. Neto Gravado;Imp. Neto No Gravado;Imp. Op. Exentas;Otros Tributos;IVA;Imp. Total",
    `${periodo}-05;1 - Factura A;00004;00003321;00003321;76123456789012;80;30712345671;ZZ DISTRIBUIDORA SA;1,000000;PES;4687,20;0,00;0,00;0,00;984,31;5671,51`,
  ].join("\n");
  await libro.locator('input[type="file"][accept=".zip,.csv,.xlsx,.xls,.txt"]').setInputFiles({ name: "mis-comprobantes.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  const dialogo = page.getByRole("dialog", { name: "Importar comprobantes recibidos" });
  await expect(dialogo).toContainText("1 comprobante listo");
  await dialogo.getByRole("button", { name: "Importar 1" }).click();
  await expect(page.getByText("1 comprobante importado")).toBeVisible();
  expect(insertadas).toEqual([expect.objectContaining({
    org_id: orgId, periodo, tipo_comprobante: 1, punto_venta: 4, numero: 3321, cuit_emisor: "30712345671",
    alicuotas: [{ tasa: 21, neto: 4687.2, iva: 984.31 }], total: 5671.51,
  })]);

  const descarga = page.waitForEvent("download");
  await libro.getByRole("button", { name: /Excel para tu contador/ }).click();
  expect((await descarga).suggestedFilename()).toBe(`subdiario-iva-${periodo}.xlsx`);
  expect(errores).toEqual([]);
});
