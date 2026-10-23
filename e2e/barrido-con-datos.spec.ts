import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Barrido de todas las pantallas del menú CON DATOS (2026-10-23): la misma
 * medición que `barrido-de-pantallas.spec.ts` (título, sin errores de
 * JavaScript, sin desborde, sin fallas graves de accesibilidad), pero con la
 * sesión real del negocio sembrado y después del circuito de gestión, así las
 * tablas, gráficos y acciones por fila tienen filas de verdad.
 *
 * Corre sólo contra la base local del E2E (E2E_LOCAL=true): lee la sesión real.
 */
const url = (() => { try { return new URL(process.env.VITE_SUPABASE_URL ?? ""); } catch { return null; } })();
const LOCAL = process.env.E2E_LOCAL === "true" && !!url && ["127.0.0.1", "localhost"].includes(url.hostname);
test.skip(!LOCAL, "El barrido con datos corre sólo contra la base local del E2E (E2E_LOCAL=true).");
test.use({ serviceWorkers: "block" });

function rutasDelMenu(): { id: string; path: string }[] {
  const fuente = readFileSync("src/app/routeManifest.ts", "utf8");
  const entradas = [...fuente.matchAll(/id: "([^"]+)", path: "([^"]+)"/g)];
  return entradas
    .map((m, i) => ({ id: m[1], path: m[2], cuerpo: fuente.slice(m.index, entradas[i + 1]?.index ?? fuente.length) }))
    .filter(r => r.cuerpo.includes("nav: {") && !r.path.includes(":"))
    .map(({ id, path }) => ({ id, path }));
}

for (const ruta of rutasDelMenu()) {
  test(`con datos: ${ruta.path}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const errores: string[] = [];
    const consola: string[] = [];
    page.on("pageerror", e => errores.push(e.message));
    page.on("console", m => { if (m.type() === "error") consola.push(m.text().slice(0, 300)); });
    await page.goto(ruta.path);
    await expect(page.locator("h1").first(), `la pantalla no tiene título; consola: ${consola.slice(-4).join(" || ")}`).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);

    for (const ancho of [1280, 390]) {
      await page.setViewportSize({ width: ancho, height: 900 });
      // Los gráficos (ResponsiveContainer) se ajustan con una demora: se mide
      // cuando el ancho del documento deja de cambiar.
      await page.waitForFunction(() => new Promise<boolean>(ok => {
        const a = document.documentElement.scrollWidth;
        setTimeout(() => ok(document.documentElement.scrollWidth === a), 400);
      }), undefined, { timeout: 5_000 }).catch(() => undefined);
      const desborde = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth <= w) return [];
        // Lo que está dentro de una caja con scroll propio no desborda la página.
        const recortado = (e: Element) => {
          for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
            const ox = getComputedStyle(a).overflowX;
            if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
          }
          return false;
        };
        return [...document.querySelectorAll("main *")]
          .filter(e => getComputedStyle(e).visibility !== "hidden" && e.getBoundingClientRect().right > w + 1 && !recortado(e))
          .slice(0, 5).map(e => `${e.tagName.toLowerCase()}.${String(e.getAttribute("class") ?? "").slice(0, 70)}`);
      });
      expect.soft(desborde, `desborde a ${ancho}px`).toEqual([]);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const graves = (await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
      .filter(v => ["serious", "critical"].includes(v.impact ?? ""));
    // El resumen de axe dice la relación de contraste y los colores medidos.
    const violaciones = graves.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => `${n.target.join(" ")} — ${n.html.slice(0, 160)} — ${(n.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 220)}`).join(" | ")}`);
    if (consola.length) testInfo.annotations.push({ type: "consola", description: consola.slice(0, 5).join(" || ") });
    expect.soft(errores, "errores de JavaScript").toEqual([]);
    expect.soft(violaciones, "accesibilidad").toEqual([]);
  });
}
