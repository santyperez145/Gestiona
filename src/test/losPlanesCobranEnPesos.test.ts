import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Los planes se muestran, se editan y se cobran en pesos.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * La suscripción al SaaS la cobra `mp-subscribe`, que crea un `preapproval` de
 * MercadoPago leyendo `price_ars_monthly`. **MercadoPago cobra en pesos.** Los
 * dólares y los `stripe_price_id` no cobran nada: son de cuando el plan era
 * cobrar por Stripe.
 *
 * ⚠️ Y no era sólo ruido visual. La consola de plataforma filtraba y mostraba
 * por `price_usd_monthly`, así que el plan `starter` —$19.900 por mes, USD 0—
 * **aparecía como «Gratis»**, no salía en «Revenue por plan» y sumaba 0 al MRR.
 * El dueño editaba el precio en pesos y la pantalla seguía diciendo lo mismo:
 * de ahí el «no actualiza nada».
 *
 * 📌 Un campo que no cobra al lado de uno que sí es una invitación a cargar el
 * número en el lugar equivocado.
 */

const ROOT = resolve(__dirname, "../..");
const admin = readFileSync(resolve(ROOT, "src/pages/PlatformAdminPage.tsx"), "utf8");
const subscribe = readFileSync(resolve(ROOT, "supabase/functions/mp-subscribe/index.ts"), "utf8");
const accion = readFileSync(resolve(ROOT, "supabase/functions/platform-admin-action/index.ts"), "utf8");

/** El código, sin comentarios: un comentario puede nombrar lo que se sacó. */
function soloCodigo(texto: string): string {
  return texto
    .split("\n")
    .filter(l => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("los planes se muestran y se cobran en pesos", () => {
  it("la consola de plataforma no decide nada con el precio en dólares", () => {
    // Filtrar, badgear o sumar MRR por USD es lo que hacía desaparecer a
    // `starter` de la pantalla que sirve para ponerle precio.
    const codigo = soloCodigo(admin);
    expect(codigo, "la consola vuelve a usar price_usd_monthly para decidir")
      .not.toMatch(/price_usd_(monthly|yearly)\s*(\)|\?|>|===|\*|\|\|)/);
  });

  it("el formulario de plan no ofrece campos que no cobran", () => {
    // ⚠️ Se mira el BINDING del formulario, no el nombre suelto: la interface
    // declara las columnas porque la tabla las tiene, y eso es honesto. Lo que
    // no puede volver es un input que las edite.
    const codigo = soloCodigo(admin);
    expect(codigo, "volvió el campo de Stripe Price ID al formulario de planes")
      .not.toMatch(/setEditPlanForm\([^)]*stripe_price_id/);
    expect(codigo, "volvieron los precios en dólares al formulario")
      .not.toMatch(/setEditPlanForm\([^)]*price_usd/);
  });

  it("y sí edita el precio que se cobra", () => {
    expect(admin, "el formulario dejó de editar el precio en pesos")
      .toMatch(/price_ars_monthly:\s*parseFloat/);
  });

  it("el guardado deja escribir el precio en pesos", () => {
    // Hasta el 2026-08-27 la allowlist sólo dejaba los de dólares: el dueño
    // editaba y no cambiaba nada.
    expect(accion, "la allowlist de updatePlan no deja escribir el precio en pesos")
      .toMatch(/"price_ars_monthly"[\s\S]{0,40}?"price_ars_yearly"/);
  });

  it("el cobro lee el precio en pesos", () => {
    expect(subscribe, "mp-subscribe dejó de leer price_ars_monthly")
      .toContain("price_ars_monthly");
  });

  it("y consigue el token sin pedir un secreto nuevo", () => {
    // ⚠️ `MP_APP_ID` NO es un token: es el identificador público de la app.
    // Pero con `MP_APP_ID` + `MP_APP_SECRET` —los que ya usa `mp-connect`—
    // MercadoPago entrega uno por `client_credentials`, sobre la cuenta dueña
    // de la aplicación, que es la de la plataforma.
    expect(subscribe, "mp-subscribe no deriva el token de las credenciales existentes")
      .toContain("client_credentials");
    expect(subscribe, "se perdió MP_APP_SECRET como fuente del token")
      .toContain("MP_APP_SECRET");
    // El token puesto a mano manda: es una decisión explícita.
    expect(subscribe, "MP_PLATFORM_ACCESS_TOKEN dejó de tener prioridad")
      .toMatch(/MP_PLATFORM_ACCESS_TOKEN[\s\S]{0,120}?if \(directo\) return directo/);
  });
});
