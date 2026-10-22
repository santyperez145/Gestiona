import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Barrido de todas las pantallas del menú con una cuenta sintética sin datos
 * (pedido del dueño 2026-10-22: «el frontend y la UX/UI deben ser totalmente
 * profesionales y entendibles, de todas las páginas»). Mide lo que se puede
 * medir sin opinar: que la pantalla cargue sin errores, tenga título, no
 * desborde a lo ancho y no tenga fallas graves de accesibilidad (axe).
 *
 * Las rutas salen del manifiesto, así una pantalla nueva entra sola al barrido.
 * Toda llamada se intercepta: lecturas vacías, ninguna escritura.
 */
test.use({ serviceWorkers: "block" });
const orgId = "00000000-0000-4000-8000-000000000042", userId = "00000000-0000-4000-8000-000000000041";

function rutasDelMenu(): { id: string; path: string }[] {
  const fuente = readFileSync("src/app/routeManifest.ts", "utf8");
  const entradas = [...fuente.matchAll(/id: "([^"]+)", path: "([^"]+)"/g)];
  return entradas
    .map((m, i) => ({ id: m[1], path: m[2], cuerpo: fuente.slice(m.index, entradas[i + 1]?.index ?? fuente.length) }))
    .filter(r => r.cuerpo.includes("nav: {") && !r.path.includes(":"))
    .map(({ id, path }) => ({ id, path }));
}

async function simular(page: Page) {
  const url = process.env.VITE_SUPABASE_URL ?? "https://hummeopatkniwkyrrhwc.supabase.co";
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: "zz-barrido@invalid.test", aud: "authenticated", role: "authenticated", created_at: "2026-10-22T00:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Prueba barrido" }, identities: [], factors: [] };
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: expires, aal: "aal1" })).toString("base64url"), Buffer.from("synthetic-ui-only").toString("base64url")].join(".");
  await page.addInitScript(({ storageKey, session, orgId }) => {
    localStorage.setItem(storageKey, JSON.stringify(session)); localStorage.setItem("gestiona.activeOrgId", orgId);
  }, { storageKey, orgId, session: { access_token: token, refresh_token: "synthetic-ui-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user } });
  await page.route("**/*.supabase.co/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user;
    else if (path === "/rest/v1/settings") result = [{ org_id: orgId, user_id: userId, business_name: "ZZ Comercio", business_logo: null }];
    else if (path === "/rest/v1/memberships") result = [{ org_id: orgId, user_id: userId, role: "owner", commission_percent: null, commission_enabled: false, organization: { id: orgId, name: "ZZ Comercio", slug: "zz-barrido",
      owner_user_id: userId, onboarding_completed: true, onboarding_goal: "explore", plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path === "/rest/v1/platform_admins") result = null;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
}

for (const ruta of rutasDelMenu()) {
  test(`pantalla ${ruta.path}`, async ({ page }, testInfo) => {
    test.setTimeout(45_000);
    const errores: string[] = [];
    const consola: string[] = [];
    page.on("pageerror", e => errores.push(e.message));
    page.on("console", m => { if (m.type() === "error") consola.push(m.text().slice(0, 300)); });
    await simular(page);
    await page.goto(ruta.path);
    // Sin título suele ser una pantalla caída en el ErrorBoundary: la consola dice por qué.
    await expect(page.locator("h1").first(), `la pantalla no tiene título; consola: ${consola.slice(-4).join(" || ")}`).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);

    const ancho = testInfo.project.name === "mobile" ? 390 : 1280;
    await page.setViewportSize({ width: ancho, height: 900 });
    const desborde = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= w) return [];
      return [...document.querySelectorAll("main *")].filter(e => e.getBoundingClientRect().right > w + 1)
        .slice(0, 5).map(e => `${e.tagName.toLowerCase()}.${String(e.getAttribute("class") ?? "").slice(0, 70)}`);
    });
    const graves = (await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
      .filter(v => ["serious", "critical"].includes(v.impact ?? ""));
    // axe recorta el HTML del nodo: para saber qué botón es hace falta su contenido.
    const violaciones = await Promise.all(graves.map(async v => `${v.id}: ${(await Promise.all(v.nodes.slice(0, 3).map(async n => {
      const html = await page.evaluate(sel => document.querySelector(sel)?.outerHTML.replace(/\s+/g, " ").slice(0, 260) ?? "", String(n.target[0])).catch(() => n.html);
      return `${n.target.join(" ")} — ${html}`;
    }))).join(" | ")}`));
    expect.soft(errores, "errores de JavaScript").toEqual([]);
    expect.soft(desborde, `desborde a ${ancho}px`).toEqual([]);
    expect.soft(violaciones, "accesibilidad").toEqual([]);
  });
}
