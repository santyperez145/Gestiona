import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Las cuotas se configuran una vez y las respeta todo lo que las muestra.
 *
 * ── El bug ────────────────────────────────────────────────────────────────
 *
 * ⚠️ Medido el 2026-08-27: `store-pay` —el que **cobra**— validaba contra
 * `cuotas_permitidas`, la configuración de Ajustes. Y `mp-installments` —el que
 * la ficha **muestra**— devolvía todo lo que ofrece MercadoPago, sin filtrar.
 *
 * O sea: el comprador veía «12 cuotas sin interés», elegía 12, y el checkout se
 * las rechazaba.
 *
 * 📌 Un plan que se muestra y no se puede pagar es peor que no mostrar cuotas:
 * el que abandona en ese punto **ya había decidido comprar**.
 *
 * ── Lo que NO son duplicados ──────────────────────────────────────────────
 *
 * `useInstallments` del storefront pregunta a MercadoPago qué cuotas hay para
 * ese monto y esa tarjeta. Eso **no se puede configurar local**: lo decide MP.
 * La configuración del comercio dice qué **acepta** de lo que MP ofrece. Son dos
 * cosas distintas que comparten la palabra «cuotas», y confundirlas llevaría a
 * borrar una de las dos.
 */

const ROOT = resolve(__dirname, "../..");
const FUNCS = resolve(ROOT, "supabase/functions");

/**
 * El código sin comentarios: un comentario nombra lo que se sacó.
 *
 * ⚠️ Saca también los bloques de comentario de JSX. Sin eso este mismo test
 * fallaba contra sí mismo: el comentario que explica por qué se sacó «3 cuotas»
 * contiene, justamente, «3 cuotas». Séptima vez en el día con esta familia de
 * error, y la primera con un comentario multilínea de JSX.
 */
function soloCodigo(texto: string): string {
  return texto
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n")
    .filter(l => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("una sola configuración de cuotas", () => {
  it("lo que la tienda muestra pasa por lo que el comercio acepta", () => {
    const fn = soloCodigo(readFileSync(resolve(FUNCS, "mp-installments/index.ts"), "utf8"));
    expect(fn, "la ficha volvió a mostrar cuotas sin consultar qué acepta el comercio")
      .toMatch(/rpc\(\s*["']cuotas_disponibles["']/);
  });

  it("y el cobro valida con la misma autoridad", () => {
    const fn = soloCodigo(readFileSync(resolve(FUNCS, "store-pay/index.ts"), "utf8"));
    expect(fn, "el checkout dejó de validar las cuotas contra la configuración")
      .toMatch(/rpc\(\s*["']cuotas_permitidas["']/);
  });

  it("si no se puede saber qué acepta, no se muestran cuotas", () => {
    /**
     * Mostrar de más es prometer algo que el checkout va a negar. Ante la duda
     * se muestra de menos, que es la dirección que no rompe una venta.
     */
    const fn = soloCodigo(readFileSync(resolve(FUNCS, "mp-installments/index.ts"), "utf8"));
    expect(fn, "un fallo al validar dejó de cortar la lista de cuotas")
      .toMatch(/permitidas\.error[\s\S]{0,400}?opciones:\s*\[\]/);
  });

  it("un comercio que nunca configuró nada no queda sin cuotas", () => {
    // Ninguna fila configurada es «todavía no entró a esa pantalla», no «no
    // acepto cuotas». Tratarlo como restricción le apagaría la financiación a
    // todos los comercios nuevos de golpe.
    const fn = soloCodigo(readFileSync(resolve(FUNCS, "mp-installments/index.ts"), "utf8"));
    expect(fn, "un comercio sin configurar quedó sin poder mostrar cuotas")
      .toMatch(/aceptadas\.size\s*>\s*0/);
  });
});

describe("el comercio no ve secretos que no puede tocar", () => {
  it("ninguna pantalla del comercio le pide configurar una clave de la plataforma", () => {
    /**
     * ⚠️ La página de campañas tenía un cartel fijo: «configurá RESEND_API_KEY
     * en las variables de entorno de Supabase». Tres problemas: se mostraba
     * siempre (aunque estuviera configurado), nombraba un secreto **de la
     * plataforma** que el comercio no puede tocar, y escribía la dirección del
     * remitente a mano — que quedó vieja el día que pasó a configurarse.
     */
    const dir = resolve(ROOT, "src/pages");
    const culpables: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".tsx")) continue;
      const p = resolve(dir, f);
      if (!existsSync(p)) continue;
      const src = soloCodigo(readFileSync(p, "utf8"));
      // Las pantallas de plataforma sí pueden nombrarlos: ahí el que mira es
      // quien tiene acceso a cargarlos.
      if (f.startsWith("Platform")) continue;
      if (/RESEND_API_KEY|ANTHROPIC_API_KEY|SMTP_PASSWORD|WHATSAPP_TOKEN/.test(src)) {
        culpables.push(f);
      }
    }
    expect(culpables, `estas pantallas le piden al comercio un secreto de la plataforma: ${culpables.join(", ")}`)
      .toEqual([]);
  });

  it("y el remitente de las campañas no está escrito a mano", () => {
    const page = soloCodigo(readFileSync(resolve(ROOT, "src/pages/EmailCampaignsPage.tsx"), "utf8"));
    expect(page, "volvió una dirección de remitente escrita a mano")
      .not.toMatch(/@gestiona\.app|@resend\.dev/);
    expect(page, "el remitente dejó de salir de la configuración")
      .toMatch(/mensajeria_de_plataforma/);
  });
});

describe("el catálogo no promete cuotas que el comercio no ofrece", () => {
  /**
   * ⚠️ El catálogo decía **«Tarjeta 3 cuotas sin interés»** escrito a mano, en
   * cuatro lugares: la pantalla interna, el PDF que se manda por WhatsApp, la
   * tarjeta del catálogo público y su modal de detalle.
   *
   * Medido el 2026-08-27: el comercio tenía configuradas **3 y 12** cuotas sin
   * interés. O sea que el texto fijo además le **subestimaba** la oferta.
   *
   * 📌 Y al revés es peor: a un comercio que no ofrece cuotas se las prometía
   * igual. Una financiación que se promete y no existe es lo que hace que
   * alguien decida comprar y después no pueda.
   */
  const PANTALLAS = ["src/pages/CatalogPage.tsx", "src/pages/PublicCatalogPage.tsx"];

  it("ninguna escribe una cantidad de cuotas a mano", () => {
    const culpables: string[] = [];
    for (const rel of PANTALLAS) {
      const src = soloCodigo(readFileSync(resolve(ROOT, rel), "utf8"));
      // Un número pegado a «cuota» es una promesa fija.
      if (/\d+\s*cuotas?\b/i.test(src)) culpables.push(rel);
    }
    expect(culpables, `volvió una cantidad de cuotas escrita a mano en: ${culpables.join(", ")}`)
      .toEqual([]);
  });

  it("y las leen de lo que el comercio configuró", () => {
    for (const rel of PANTALLAS) {
      const src = readFileSync(resolve(ROOT, rel), "utf8");
      // ⚠️ Se exige la LLAMADA, no el nombre: `useCuotasDelComercioX` contiene
      // la cadena y el test seguía verde con el hook cambiado. Verificado.
      expect(src, `${rel} dejó de leer las cuotas configuradas`)
        .toMatch(/useCuotasDelComercio\s*\(/);
    }
  });

  it("el catálogo público las pide sin abrir la tabla", () => {
    // `org_installment_plans` la leen sólo los miembros, y el catálogo público
    // lo mira un comprador anónimo. Se expone lo mostrable por RPC, igual que
    // `get_store_categories`.
    const dir = resolve(ROOT, "supabase/migrations");
    const sql = readdirSync(dir).filter(f => f.endsWith(".sql")).sort().reverse()
      .map(f => readFileSync(resolve(dir, f), "utf8"))
      .find(t => /FUNCTION public\.cuotas_publicas/.test(t));
    expect(sql, "ninguna migración define cuotas_publicas").toBeTruthy();
    expect(sql!, "la función pública de cuotas dejó de ser SECURITY DEFINER")
      .toMatch(/SECURITY DEFINER/);
  });
});
