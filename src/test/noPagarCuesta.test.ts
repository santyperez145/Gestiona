import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * No pagar corta los beneficios, y la landing no promete lo que el plan no da.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * ⚠️ Hasta el 2026-08-27 `useEntitlements` devolvía los beneficios **sólo
 * mirando el plan**, sin consultar el estado de la suscripción. Una
 * organización en `past_due` conservaba IA, branding, backups y todos los
 * límites: **no pagar no costaba nada**.
 *
 * ⚠️ Y la landing prometía límites que no coincidían con la base: decía «hasta
 * 100 productos» en Starter cuando el plan permite **1000**, y «hasta 1.000» en
 * Pro cuando es **ilimitado**. Eran textos sueltos al lado de las columnas que
 * mandan, escritos una vez y nunca revisados — y en una página de precios, un
 * texto suelto es una promesa de venta.
 */

const ROOT = resolve(__dirname, "../..");
const ent = readFileSync(resolve(ROOT, "src/lib/useEntitlements.ts"), "utf8");
const pricing = readFileSync(resolve(ROOT, "src/pages/PricingPage.tsx"), "utf8");
const admin = readFileSync(resolve(ROOT, "src/pages/PlatformAdminPage.tsx"), "utf8");

describe("no pagar corta los beneficios", () => {
  it("los beneficios miran el estado de la suscripción, no sólo el plan", () => {
    expect(ent, "los extras volvieron a salir directo del plan, sin mirar si está pago")
      .not.toMatch(/canUseAI:\s*!!plan\?\.ai_enabled/);
    expect(ent, "no hay ninguna decisión de vigencia del plan")
      .toContain("planVigente");
  });

  it("hay días de gracia antes de cortar", () => {
    // ⚠️ `past_due` es también el estado con el que NACE toda suscripción
    // recién contratada: `mp-subscribe` la guarda así y la activa el webhook
    // cuando confirma el primer cobro. Cortar en el primer rechazo dejaría sin
    // sistema a quien puso la tarjeta hace cinco minutos.
    expect(ent, "se cortó la gracia: un rechazo transitorio apagaría el sistema")
      .toContain("DIAS_DE_GRACIA");
  });

  it("cortar NO deja al comercio afuera de sus datos", () => {
    // Se cae al piso de límites y se apagan los extras. Bloquear el acceso
    // sería una manera de perder al cliente, no de cobrarle.
    expect(ent, "el corte dejó de tener un piso de límites")
      .toMatch(/const limite\s*=/);
  });

  it("una organización sin suscripción conserva lo suyo", () => {
    // Los comercios anteriores al cobro no tienen fila. Cortarles algo que
    // nunca se les vendió sería romperles el sistema por una migración.
    expect(ent, "una org sin suscripción dejó de estar contemplada")
      .toMatch(/planVigente\s*=\s*!sub/);
  });
});

describe("el estado no depende de que llegue el webhook", () => {
  it("el barrido también vence suscripciones pagas, no sólo trials", () => {
    /**
     * ⚠️ `expire_overdue_trials` corre por cron cada hora y sólo miraba
     * `status = 'trialing'`. Una suscripción paga con el período cumplido y
     * sin cobro se quedaba en `active` **para siempre** si el webhook no
     * llegaba — y con ella, todos los beneficios.
     *
     * CLAUDE.md, sistemas externos: no son confiables. Un estado que sólo
     * cambia cuando un tercero avisa no es un estado, es una esperanza.
     */
    const dir = resolve(ROOT, "supabase/migrations");
    const archivos = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
    let ultima: string | null = null;
    for (let i = archivos.length - 1; i >= 0; i--) {
      const texto = readFileSync(resolve(dir, archivos[i]), "utf8");
      if (/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.expire_overdue_trials/i.test(texto)) {
        ultima = texto;
        break;
      }
    }
    expect(ultima, "ninguna migración define expire_overdue_trials").toBeTruthy();
    expect(ultima!, "el barrido volvió a mirar sólo los trials")
      .toMatch(/status\s*=\s*'active'[\s\S]{0,200}?current_period_end/);
  });
});

describe("la landing dice lo que el plan da", () => {
  it("los límites salen de las columnas, no de un texto", () => {
    expect(pricing, "los límites volvieron a escribirse a mano")
      .toContain("limitesDelPlan");
    expect(pricing, "las features ya no incluyen los límites derivados")
      .toMatch(/\[\s*\.\.\.limitesDelPlan\(p\)/);
  });

  it("y el texto de venta se edita desde la consola", () => {
    // Sin editor, cambiar las características exigía tocar código: era
    // exactamente el «actualizo el plan y la landing no cambia».
    expect(admin, "la consola no permite editar las características del plan")
      .toMatch(/features:\s*e\.target\.value\.split/);
  });

  it("el fallback ya no repite los límites", () => {
    // Repetirlos es cómo empezó la mentira: el texto decía 100 y la columna
    // decía 1000.
    const bloque = pricing.slice(
      pricing.indexOf("const FALLBACK_FEATURES"),
      pricing.indexOf("function limitesDelPlan"),
    );
    expect(bloque, "el fallback volvió a prometer una cantidad de productos")
      .not.toMatch(/\d+\s*productos/i);
    expect(bloque, "el fallback volvió a prometer una cantidad de usuarios")
      .not.toMatch(/\d+\s*usuarios/i);
  });
});
