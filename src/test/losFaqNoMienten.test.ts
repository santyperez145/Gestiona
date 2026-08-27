import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Las preguntas frecuentes son ciertas y están escritas para el comercio.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * ⚠️ Medidas contra el código el 2026-08-27, **cuatro de cinco eran falsas**:
 *
 *   | Decía | Realidad |
 *   |---|---|
 *   | «Cancelás desde Configuración → Facturación» | Esa pestaña no existe, y el botón que sí existía **no cancelaba nada** |
 *   | «Te avisamos 3 días antes del trial» | Ninguna función manda ese aviso |
 *   | «La cuenta se pausa» | No se pausa: se apagan los extras y el comercio sigue entrando |
 *   | «Downgrade al final del período» | Nada programa un cambio de plan a futuro |
 *
 * Una página de precios es una promesa comercial. Una respuesta que no se
 * puede cumplir es lo que hace que alguien se dé de baja el primer mes
 * sintiéndose engañado.
 */

const ROOT = resolve(__dirname, "../..");
const pricing = readFileSync(resolve(ROOT, "src/pages/PricingPage.tsx"), "utf8");

/** El bloque del FAQ, sin los comentarios que explican lo que se sacó. */
function textoDelFaq(): string {
  const i = pricing.indexOf("const FAQ = [");
  const fin = pricing.indexOf("];", i);
  expect(i, "desapareció el bloque de preguntas frecuentes").toBeGreaterThan(-1);
  return pricing.slice(i, fin)
    .split("\n")
    .filter(l => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("las preguntas frecuentes hablan como el comercio", () => {
  /**
   * Palabras que el lector no usa. No es purismo: quien lee esto vende
   * perfumes, y una respuesta que no entiende no lo ayuda a decidir — lo hace
   * dudar. `downgrade` y `período de facturación` estaban ahí.
   */
  const JERGA = [
    "upgrade", "downgrade", "billing", "endpoint", "API", "webhook",
    "período de facturación", "preapproval", "backend", "deploy",
  ];

  it("no usa palabras técnicas", () => {
    const texto = textoDelFaq();
    const encontradas = JERGA.filter(j => new RegExp(`\\b${j}\\b`, "i").test(texto));
    expect(encontradas, `volvió jerga a las preguntas frecuentes: ${encontradas.join(", ")}`)
      .toEqual([]);
  });

  it("no manda al comercio a una pantalla que no existe", () => {
    /**
     * ⚠️ El FAQ decía «Configuración → Facturación». La pantalla se llama
     * «Ajustes», y su pestaña «Suscripción». Mandar a alguien a un lugar
     * inexistente es peor que no explicarle: se va convencido de que el
     * sistema está roto.
     */
    const texto = textoDelFaq();
    const manifest = readFileSync(resolve(ROOT, "src/app/routeManifest.ts"), "utf8");
    const inventadas = ["Configuración → Facturación", "Configuración →"]
      .filter(n => texto.includes(n));
    expect(inventadas, `nombra pantallas que no existen: ${inventadas.join(", ")}`).toEqual([]);

    // Y las que sí nombra tienen que estar en el manifiesto de rutas.
    for (const pantalla of texto.match(/\b(Mi plan|Ajustes)\b/g) ?? []) {
      expect(manifest, `el FAQ manda a «${pantalla}» y esa pantalla no está en las rutas`)
        .toContain(`"${pantalla}"`);
    }
  });
});

describe("las preguntas frecuentes son ciertas", () => {
  const texto = textoDelFaq();

  it("no promete un aviso que nadie manda", () => {
    // «Te avisamos 3 días antes del vencimiento del trial» no lo mandaba nadie.
    expect(texto, "volvió la promesa de un aviso antes de que termine la prueba")
      .not.toMatch(/avisamos.{0,40}(3|tres) d[ií]as/i);
  });

  it("no dice que la cuenta se pausa", () => {
    // No se pausa: se apagan los extras y el comercio sigue entrando y viendo
    // lo suyo. La verdad es mejor que la promesa que había.
    expect(texto, "volvió a decir que la cuenta se pausa")
      .not.toMatch(/cuenta se pausa/i);
  });

  it("y la baja que promete existe de verdad", () => {
    /**
     * ⚠️ El FAQ prometía cancelar mientras `cancel-subscription` era 100%
     * Stripe —que nunca cobró nada— y el botón cortaba con un
     * `if (!stripe_subscription_id) return`. Prometer una baja que no se puede
     * hacer, sobre algo que se sigue cobrando, es lo peor de las dos cosas.
     */
    const crudo = readFileSync(
      resolve(ROOT, "supabase/functions/cancel-subscription/index.ts"), "utf8");
    // ⚠️ Sin sacar los comentarios, este test falla contra sí mismo: el propio
    // archivo explica por qué se sacó Stripe, y ahí está la palabra. Es la
    // sexta vez en el día con esta familia de error.
    const fn = crudo.split("\n")
      .filter(l => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(fn, "cancelar volvió a apuntar a Stripe").not.toContain("stripe");
    expect(fn, "cancelar dejó de avisarle a MercadoPago")
      .toMatch(/preapproval\/\$\{[^}]+\}[\s\S]{0,400}?"cancelled"/);
    expect(fn, "cancelar dejó de buscar la suscripción por organización")
      .toMatch(/\.eq\("org_id", orgId\)/);
  });
});

describe("los sellos de confianza no afirman lo que no se cumple", () => {
  it("⚠️ no dice dónde están alojados los datos", () => {
    /**
     * Decía «Hosting en Argentina» y la base está en `aws-1-us-east-1`, o sea
     * Virginia, Estados Unidos. Es una afirmación sobre dónde viven los datos
     * de otro: de las que se firman, no de las que se escriben para llenar una
     * fila.
     */
    const i = pricing.indexOf("const TRUST = [");
    const trust = pricing.slice(i, pricing.indexOf("]", i));
    expect(trust, "volvió una promesa sobre dónde están alojados los datos")
      .not.toMatch(/hosting|argentina|servidor/i);
  });
});
