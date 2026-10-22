import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Remitos con identidades sintéticas: emitir uno suelto, imprimir el
 * original y duplicado, y marcarlo entregado. Toda llamada se intercepta; la
 * impresión se captura en vez de abrir una ventana. No escribe en ninguna base.
 */
test.use({ serviceWorkers: "block" });
const orgId = "00000000-0000-4000-8000-000000000032", userId = "00000000-0000-4000-8000-000000000031";

const remito = (cambios: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-0000000000a1", punto_venta: 1, numero: 1, letra: "X", cai: null, cai_vence: null, fecha: "2026-10-20",
  sale_transaction_id: null, customer_id: null, cliente_nombre: "ZZ Ferretería Sur", cliente_cuit: "30712345671",
  cliente_domicilio: "ZZ Calle 123, Quilmes", transportista: "ZZ Expreso", bultos: 2, valor_declarado: null, observaciones: null,
  estado: "emitido", entregado_at: null, recibio_nombre: null, recibio_dni: null, anulado_at: null, anulado_motivo: null,
  created_at: "2026-10-20T13:00:00Z",
  remito_items: [{ id: "i1", sale_id: null, product_id: null, descripcion: "ZZ Tornillo 6 mm", cantidad: 6, unidad: "caja" }],
  ...cambios,
});

async function simular(page: Page) {
  const url = process.env.VITE_SUPABASE_URL ?? "https://hummeopatkniwkyrrhwc.supabase.co";
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: "zz-remitos@invalid.test", aud: "authenticated", role: "authenticated", created_at: "2026-10-22T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Prueba remitos" }, identities: [], factors: [] };
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: expires, aal: "aal1" })).toString("base64url"), Buffer.from("synthetic-ui-only").toString("base64url")].join(".");
  await page.addInitScript(({ storageKey, session, orgId }) => {
    localStorage.setItem(storageKey, JSON.stringify(session)); localStorage.setItem("gestiona.activeOrgId", orgId);
    // La impresión se captura: lo que se escribiría en la ventana queda en `__impresiones`.
    const w = window as unknown as { __impresiones: string[] };
    w.__impresiones = [];
    window.open = (() => {
      const i = w.__impresiones.push("") - 1;
      const doc = { open() { w.__impresiones[i] = ""; }, write(h: string) { w.__impresiones[i] += h; }, close() {} };
      return { document: doc, focus() {}, print() {}, close() {}, addEventListener() {} } as unknown as Window;
    }) as typeof window.open;
  }, { storageKey, orgId, session: { access_token: token, refresh_token: "synthetic-ui-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user } });

  let lista = [remito()];
  const llamadas: { fn: string; body: Record<string, unknown> }[] = [];
  await page.route("**/*.supabase.co/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user;
    else if (path === "/rest/v1/settings") result = [{ org_id: orgId, user_id: userId, business_name: "ZZ Comercio", business_logo: null, afip_cuit: "30712345671" }];
    else if (path === "/rest/v1/memberships") result = [{ org_id: orgId, role: "owner", organization: { id: orgId, name: "ZZ Comercio", slug: "zz-remitos",
      owner_user_id: userId, onboarding_completed: true, onboarding_goal: "explore", plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path === "/rest/v1/platform_admins") result = null;
    else if (path === "/rest/v1/afip_connection_status") result = [{ cuit: "30712345671", razon_social: "ZZ Comercio SRL", domicilio: "ZZ Av. 1",
      tipo_emisor: "responsable_inscripto", ingresos_brutos: "901-123456-7", inicio_actividades: "2020-01-01" }];
    else if (path === "/rest/v1/remitos") result = lista;
    else if (path === "/rest/v1/remito_talonarios") result = [{ punto_venta: 1, proximo_numero: lista.length + 1, cai: null, cai_vence: null }];
    else if (path.startsWith("/rest/v1/rpc/")) {
      const fn = path.slice("/rest/v1/rpc/".length);
      const body = req.postDataJSON() as Record<string, unknown>;
      llamadas.push({ fn, body });
      if (fn === "emitir_remito") {
        const datos = body.p_datos as Record<string, unknown>;
        const nuevo = remito({ id: "00000000-0000-4000-8000-0000000000a2", numero: 2, fecha: datos.fecha, cliente_nombre: datos.cliente_nombre,
          cliente_cuit: null, cliente_domicilio: null, transportista: null, bultos: null, remito_items: undefined });
        lista = [{ ...nuevo, remito_items: [{ id: "i2", sale_id: null, product_id: null, descripcion: "ZZ Caja de muestras", cantidad: 2, unidad: "un" }] }, ...lista];
        const { remito_items: _items, ...cabecera } = nuevo;
        result = { ...cabecera, renglones: 1 };
      } else if (fn === "marcar_remito_entregado") {
        lista = lista.map(r => (r.id === body.p_remito ? { ...r, estado: "entregado", recibio_nombre: body.p_recibio_nombre, entregado_at: "2026-10-22T15:00:00Z" } : r));
        result = lista.find(r => r.id === body.p_remito);
      }
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  return llamadas;
}

test("remitos: emitir uno suelto, imprimir original y duplicado, y marcarlo entregado", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errores: string[] = []; page.on("pageerror", e => errores.push(e.message));
  const llamadas = await simular(page);
  await page.goto("/remitos");
  await expect(page.getByRole("heading", { name: "Remitos", level: 1 })).toBeVisible();
  // Escritorio muestra la tabla y el teléfono las tarjetas: se busca el visible.
  const primero = page.getByText("00001-00000001").filter({ visible: true }).first();
  await expect(primero).toBeVisible();

  await page.getByRole("button", { name: "Remito sin venta" }).click();
  const dialogo = page.getByTestId("emitir-remito");
  await expect(dialogo.getByText(/Remito X · N\.º/)).toBeVisible();
  await dialogo.getByRole("button", { name: "Emitir e imprimir" }).click();
  await expect(dialogo.getByRole("alert")).toContainText("Falta a quién se entrega.");
  await expect(dialogo.getByRole("alert")).toContainText("Indicá qué cantidad se entrega en al menos un renglón.");

  await dialogo.getByLabel("Descripción del renglón 1").fill("ZZ Caja de muestras");
  await dialogo.getByLabel(/Cantidad a entregar/).fill("2");
  await dialogo.getByLabel("Nombre o razón social").fill("ZZ Cliente Muestras");
  await dialogo.getByRole("button", { name: "Emitir e imprimir" }).click();
  await expect(dialogo.getByText("Remito X 00001-00000002 emitido")).toBeVisible();
  expect(llamadas.find(l => l.fn === "emitir_remito")?.body).toMatchObject({
    p_org: orgId,
    p_datos: { cliente_nombre: "ZZ Cliente Muestras", sale_transaction_id: null, items: [{ descripcion: "ZZ Caja de muestras", cantidad: 2, unidad: "un" }] },
  });
  const impreso = await page.evaluate(() => (window as unknown as { __impresiones: string[] }).__impresiones.join("\n"));
  for (const texto of ["ORIGINAL", "DUPLICADO", "00001-00000002", "Documento no válido como factura", "ZZ Comercio SRL", "Recibí conforme"]) {
    expect(impreso).toContain(texto);
  }
  await dialogo.getByRole("button", { name: "Listo" }).click();

  await primero.click();
  const detalle = page.getByTestId("detalle-remito");
  await expect(detalle.getByText("ZZ Tornillo 6 mm")).toBeVisible();
  await detalle.getByRole("button", { name: "Marcar entregado" }).click();
  await page.getByLabel("Recibió").fill("ZZ Recibe Pérez");
  await page.getByRole("button", { name: "Confirmar entrega" }).click();
  await expect(page.getByText("Remito 00001-00000001 entregado")).toBeVisible();
  expect(llamadas.find(l => l.fn === "marcar_remito_entregado")?.body).toEqual({
    p_remito: "00000000-0000-4000-8000-0000000000a1", p_recibio_nombre: "ZZ Recibe Pérez", p_recibio_dni: null,
  });

  for (const ancho of testInfo.project.name === "mobile" ? [360, 390] : [768, 1280]) {
    await page.setViewportSize({ width: ancho, height: 900 });
    // Si desborda, se nombran los elementos que se salen: «false» solo no ayuda a arreglarlo.
    const desborde = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= w) return [];
      return [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > w + 1)
        .slice(0, 8).map(e => `${e.tagName.toLowerCase()}.${String(e.getAttribute("class") ?? "").slice(0, 80)}`);
    });
    expect(desborde, `desborde ${ancho}`).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`remitos-${ancho}.png`), fullPage: true });
  }
  const violaciones = (await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
    .filter(v => ["serious", "critical"].includes(v.impact ?? ""));
  expect(violaciones.map(v => ({ id: v.id, nodos: v.nodes.map(n => `${n.target.join(" ")} — ${n.html.slice(0, 160)}`) }))).toEqual([]);
  expect(errores).toEqual([]);
});
