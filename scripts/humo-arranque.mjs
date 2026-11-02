/**
 * Humo del arranque (2026-11-01): sirve el build (`vite preview`), lo abre en
 * un Chromium real y falla si la app no monta o tira errores de JavaScript.
 * Ese día un cambio en los chunks (un grupo que dependía de vendor-react y
 * vendor-react de él) dejó la app sin arrancar —«e is not a function» en todas
 * las rutas— y lo vio recién el E2E del CI. Esto lo detecta en la puerta, en
 * un minuto y sin base de datos.
 *
 *   node scripts/humo-arranque.mjs            # levanta su propio servidor
 *   node scripts/humo-arranque.mjs <url>      # contra uno ya levantado
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const PUERTO = 4179;
const rutas = [
  // La landing viva, dentro de #root: la previa en HTML (index.html) también
  // tiene su h1 y se ve aunque React no monte.
  { ruta: "/", espera: "#root [data-landing] h1" },
  { ruta: "/login", espera: "form" },
  { ruta: "/precios", espera: "h1" },
];

async function esperarServidor(url, ms = 30_000) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    try { if ((await fetch(url)).ok) return true; } catch { /* todavía no */ }
    await new Promise(ok => setTimeout(ok, 300));
  }
  return false;
}

async function main() {
  if (!existsSync(chromium.executablePath())) {
    const mensaje = "No está instalado el Chromium de Playwright (npx playwright install chromium).";
    // En el CI el build no trae navegador; el arranque lo prueba el E2E, que corre igual.
    if (process.env.CI) { console.log(`::notice::${mensaje} El arranque lo cubre el E2E.`); return; }
    console.error(mensaje);
    process.exitCode = 1;
    return;
  }
  let servidor = null;
  let base = process.argv[2];
  if (!base) {
    base = `http://localhost:${PUERTO}`;
    servidor = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", String(PUERTO), "--strictPort"], { stdio: "ignore" });
    if (!(await esperarServidor(base))) {
      servidor.kill();
      console.error("El build no se pudo servir (¿corrió `npm run build`?).");
      process.exitCode = 1;
      return;
    }
  }
  const navegador = await chromium.launch();
  let fallas = 0;
  try {
    for (const { ruta, espera } of rutas) {
      const pagina = await navegador.newPage();
      const errores = [];
      pagina.on("pageerror", e => errores.push(e.message));
      try {
        await pagina.goto(base + ruta, { waitUntil: "domcontentloaded" });
        await pagina.locator(espera).first().waitFor({ state: "visible", timeout: 20_000 });
      } catch (e) {
        errores.push(`no montó: ${String(e.message ?? e).split("\n")[0]}`);
      }
      console.log(`${errores.length ? "✗" : "✓"} ${ruta}${errores.length ? ` — ${errores.slice(0, 3).join(" | ")}` : ""}`);
      fallas += errores.length ? 1 : 0;
      await pagina.close();
    }
    // La previa: con el JavaScript demorado, el título ya se ve con el HTML.
    const pagina = await navegador.newPage();
    await pagina.route(/\/assets\/.*\.js$/, async r => { await new Promise(ok => setTimeout(ok, 3000)); await r.continue().catch(() => undefined); });
    try {
      await pagina.goto(base + "/", { waitUntil: "commit" });
      await pagina.locator("#landing-previa h1").waitFor({ state: "visible", timeout: 2500 });
      // Un toque antes de que arranque React no se pierde: se repite en la viva.
      await pagina.locator("#landing-previa #landing-tab-gestion").click();
      await pagina.locator("#root [data-landing] h1").waitFor({ state: "visible", timeout: 20_000 });
      if (await pagina.locator("#landing-previa").count()) throw new Error("la previa quedó junto a la landing viva");
      await pagina.locator('#root #landing-tab-gestion[aria-selected="true"]').waitFor({ timeout: 3000 })
        .catch(() => { throw new Error("el toque en la previa no llegó a la landing viva"); });
      console.log("✓ / previa en HTML antes del JavaScript");
    } catch (e) {
      console.log(`✗ / previa — ${String(e.message ?? e).split("\n")[0]}`);
      fallas += 1;
    } finally {
      await pagina.close();
    }
  } finally {
    await navegador.close();
    servidor?.kill();
  }
  if (fallas) { console.error(`${fallas} ruta(s) no arrancan.`); process.exitCode = 1; }
}

await main();
