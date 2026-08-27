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
    /**
     * Los comercios anteriores al cobro no tienen fila. Cortarles algo que
     * nunca se les vendió sería romperles el sistema por una migración.
     *
     * ⚠️ Este test miraba el texto del hook (`planVigente = !sub`). El
     * 2026-08-27 la decisión se mudó a `public.org_entitlements` para que el
     * navegador y las Edge Functions no pudieran divergir, y el test se puso
     * rojo sin que el invariante hubiera cambiado. Ahora se verifica **en la
     * autoridad**, que es donde vive la regla, y de paso en el respaldo local.
     */
    const dir = resolve(ROOT, "supabase/migrations");
    const autoridad = readdirSync(dir)
      .filter(f => f.endsWith(".sql")).sort().reverse()
      .map(f => readFileSync(resolve(dir, f), "utf8"))
      .find(t => /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.org_entitlements/i.test(t));

    expect(autoridad, "ninguna migración define org_entitlements").toBeTruthy();
    expect(autoridad!, "la base dejó de contemplar la organización sin suscripción")
      .toMatch(/v_sub\.id IS NULL[\s\S]{0,200}?v_vigente\s*:=\s*true/);

    // Y el respaldo del navegador, para cuando la función todavía no existe.
    expect(ent, "el respaldo local dejó de contemplar la org sin suscripción")
      .toMatch(/!sub \|\| motivoLocal === null/);
  });
});

/**
 * El código sin comentarios.
 *
 * ⚠️ Sin esto, un test que prohíbe una frase la encuentra en el comentario que
 * explica por qué se sacó, y falla contra sí mismo. Ya pasó tres veces en este
 * repo — con `ledger_plan_default`, con el nombre del RPC de entitlements, y
 * con esta misma frase.
 */
function soloCodigo(texto: string): string {
  return texto
    .split("\n")
    .filter(l => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("el aviso dice qué pasó de verdad", () => {
  const layout = soloCodigo(readFileSync(resolve(ROOT, "src/components/AppLayout.tsx"), "utf8"));

  it("⚠️ no acusa de no pagar a quien acaba de suscribirse", () => {
    /**
     * `mp-subscribe` guarda la suscripción como `past_due` y SIN
     * `current_period_end`: la activa el webhook cuando MercadoPago confirma
     * el primer cobro. El banner mostraba «Pago fallido. Actualizá tu método
     * de pago» a alguien que había puesto la tarjeta hacía cinco minutos.
     *
     * Son tres cosas distintas que se veían iguales: confirmación en curso,
     * pago pendiente con gracia, y beneficios ya apagados.
     */
    expect(layout, "volvió a tratar todo past_due como un pago fallido")
      .not.toMatch(/Pago fallido/);
    expect(layout, "no distingue la suscripción que todavía no se cobró nunca")
      .toMatch(/!subscription\?\.current_period_end/);
  });

  it("y el cartel no se queda viejo justo después de pagar", () => {
    /**
     * No hay realtime sobre `plans` ni `subscriptions`, y no hace falta: el
     * corte lo aplica el servidor en cada llamada. Lo que sí importa es que el
     * comercio que vuelve de MercadoPago no siga leyendo «estamos
     * confirmando» hasta recargar a mano — es el momento de mayor ansiedad y
     * fue literalmente el «no actualiza nada» del reporte original.
     */
    // ⚠️ Se exige el `addEventListener`, no la palabra: con `toContain` el
    // test seguía verde con el listener borrado, porque `removeEventListener`
    // también nombra el evento. Verificado sacándolo.
    expect(ent, "el hook dejó de releer al volver a la pestaña")
      .toMatch(/addEventListener\(\s*['"]visibilitychange['"]/);
    expect(ent, "dejó de reintentar mientras la suscripción se está confirmando")
      .toMatch(/if \(!confirmando\) return;/);
  });

  it("y cuando corta, aclara que los datos siguen ahí", () => {
    // Cortar apaga extras. Un comercio que lee «perdés el acceso» y cree que
    // se queda sin sus ventas no paga: se va.
    expect(layout, "el aviso de corte dejó de aclarar que los datos no se tocan")
      .toMatch(/datos, ventas y stock siguen intactos/i);
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
