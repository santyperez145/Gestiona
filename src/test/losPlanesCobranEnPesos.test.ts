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

  it("guarda la suscripción por organización, no por preapproval", () => {
    /**
     * ⚠️ `onConflict: "mp_preapproval_id"` hacía fallar TODA contratación con
     * un 500, y encima **después** de que MercadoPago ya había creado el
     * preapproval.
     *
     * `subscriptions_mp_preapproval_unico` es un índice **parcial**
     * (`WHERE mp_preapproval_id IS NOT NULL`), y `ON CONFLICT (col)` no puede
     * inferir un índice parcial. Verificado contra producción:
     *
     *     ON CONFLICT (mp_preapproval_id)  → 42P10
     *     ON CONFLICT (org_id)             → PASÓ, y también al cambiar de plan
     *
     * Y aunque el índice parcial sirviera, la tabla tiene `UNIQUE (org_id)`:
     * un comercio que cambia de plan chocaría contra esa otra restricción, que
     * no es el target del conflicto, y volvería a fallar.
     *
     * 📌 Misma familia que las notas de cliente, que decían «guardado» con una
     * constraint que no existía.
     */
    expect(subscribe, "el upsert de la suscripción volvió a un target que no resuelve el conflicto")
      .toMatch(/onConflict:\s*"org_id"/);
    expect(subscribe, "volvió el conflicto sobre el índice parcial de mp_preapproval_id")
      .not.toMatch(/onConflict:\s*"mp_preapproval_id"/);
  });

  it("si no se puede guardar, devuelve el preapproval para poder encontrarlo", () => {
    // Cuando ese guardado falla, en MercadoPago quedó una suscripción creada.
    // Un «escribinos» sin el id deja al comercio y al soporte buscando a ciegas.
    expect(subscribe, "el error de guardado no devuelve el preapproval_id")
      .toMatch(/error:[\s\S]{0,200}?preapproval_id:\s*String\(mp\.id\)/);
  });

  it("y consigue el token sin pedir un secreto nuevo", () => {
    // ⚠️ `MP_APP_ID` NO es un token: es el identificador público de la app.
    // Pero con `MP_APP_ID` + `MP_APP_SECRET` —los que ya usa `mp-connect`—
    // MercadoPago entrega uno por `client_credentials`, sobre la cuenta dueña
    // de la aplicación, que es la de la plataforma.
    // 📌 El token dejó de resolverse dentro de `mp-subscribe`: lo necesitaban
    // tres funciones —alta, cambio de precio y baja— y con dos ya estaba
    // duplicado. Vive en `_shared/mpPlataforma.ts`, y el invariante se verifica
    // ahí; acá se verifica que `mp-subscribe` lo use en vez de rehacerlo.
    const helper = readFileSync(
      resolve(ROOT, "supabase/functions/_shared/mpPlataforma.ts"), "utf8");
    expect(helper, "el helper no deriva el token de las credenciales existentes")
      .toContain("client_credentials");
    expect(helper, "se perdió MP_APP_SECRET como fuente del token")
      .toContain("MP_APP_SECRET");
    // El token puesto a mano manda: es una decisión explícita.
    expect(helper, "MP_PLATFORM_ACCESS_TOKEN dejó de tener prioridad")
      .toMatch(/MP_PLATFORM_ACCESS_TOKEN[\s\S]{0,120}?if \(directo\) return directo/);
    expect(subscribe, "mp-subscribe volvió a resolver el token por su cuenta")
      .toContain("tokenDeLaPlataforma");
  });
});
