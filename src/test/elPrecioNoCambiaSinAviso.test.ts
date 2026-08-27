import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A nadie se le cambia el precio sin avisarle antes.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * Medido el 2026-08-27: editar el precio de un plan **no le cambiaba nada** a
 * quien ya estaba suscripto. El `preapproval` de MercadoPago se crea con el
 * monto del día de la contratación y nadie lo actualizaba después, así que un
 * cambio de precio no llegaba jamás a los actuales.
 *
 * Al construir el camino que sí llega, el riesgo se da vuelta: pasa a ser
 * posible cobrarle más a alguien que no se enteró. Eso es lo que estos
 * guardias sostienen.
 */

const ROOT = resolve(__dirname, "../..");
const fn = readFileSync(resolve(ROOT, "supabase/functions/precio-suscripcion/index.ts"), "utf8");

/** El código sin comentarios: un comentario puede nombrar lo que se sacó. */
function soloCodigo(texto: string): string {
  return texto
    .split("\n")
    .filter(l => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/** La migración que define una función SQL, buscando de la más nueva a la más vieja. */
function migracionQueDefine(patron: RegExp): string {
  const dir = resolve(ROOT, "supabase/migrations");
  const archivos = readdirSync(dir).filter(f => f.endsWith(".sql")).sort().reverse();
  for (const f of archivos) {
    const texto = readFileSync(resolve(dir, f), "utf8");
    if (patron.test(texto)) return texto;
  }
  throw new Error(`ninguna migración define ${patron}`);
}

describe("el aviso va antes que el cobro", () => {
  it("no se aplica un cambio que el comercio no recibió", () => {
    // Es EL invariante de este slice. Sin él, un aumento programado se cobra
    // aunque el mail haya rebotado.
    const codigo = soloCodigo(fn);
    expect(codigo, "se dejó de exigir que el objetivo esté notificado antes de aplicar")
      .toMatch(/estado\s*!==\s*"notificado"/);
  });

  it("un aviso que no se pudo enviar NO se marca como enviado", () => {
    // Marcarlo dejaría que el precio suba con nadie enterado, que es
    // exactamente el daño que este circuito viene a evitar.
    expect(fn, "se dejó de cortar cuando el envío del aviso falla")
      .toMatch(/if \(!r\.ok\)[\s\S]{0,220}?continue;/);
    expect(fn, "se dejó de cortar cuando no hay a quién avisarle")
      .toMatch(/if \(!email\)[\s\S]{0,320}?continue;/);
  });

  it("el precio acordado sólo se mueve si MercadoPago aceptó", () => {
    // Si se escribiera al programar, `Mi plan` mostraría un precio que todavía
    // no se cobra — el bug que este slice vino a cerrar, del otro lado.
    const sql = migracionQueDefine(/FUNCTION public\.registrar_cambio_de_precio/);
    expect(sql, "el precio acordado se escribe sin que MercadoPago haya aceptado")
      .toMatch(/IF p_estado = 'aplicado' THEN[\s\S]{0,300}?UPDATE public\.subscriptions/);
  });

  it("una respuesta de MercadoPago que no se entiende no se da por buena", () => {
    // El estado `requiere_reautorizacion` existe porque MP puede pedir que el
    // pagador acepte un monto mayor. Tratarlo como error genérico haría que
    // nadie sepa que se resuelve pidiéndoselo al comercio.
    expect(fn, "se perdió la distinción de la reautorización")
      .toContain("requiere_reautorizacion");
    expect(fn, "la respuesta de MercadoPago dejó de guardarse")
      .toMatch(/p_respuesta:\s*respuesta/);
  });
});

/**
 * El cuerpo de UNA función SQL, desde su `CREATE ... FUNCTION` hasta el `$$;`
 * que la cierra.
 *
 * ⚠️ Sin esto, una aserción sobre `programar_cambio_de_precio` se satisface con
 * texto de `impacto_cambio_de_precio`, que está en el mismo archivo y calcula lo
 * mismo. Probado: al sabotear el cálculo del preaviso, el test seguía verde
 * porque encontraba el patrón en la otra función.
 */
function cuerpoDeFuncion(sql: string, nombre: string): string {
  const i = sql.indexOf(`FUNCTION public.${nombre}(`);
  if (i < 0) throw new Error(`no está la función ${nombre}`);
  const fin = sql.indexOf("$$;", i);
  return sql.slice(i, fin < 0 ? undefined : fin);
}

describe("el preaviso es de la base, no de la pantalla", () => {
  const archivo = migracionQueDefine(/FUNCTION public\.programar_cambio_de_precio/);
  const sql = cuerpoDeFuncion(archivo, "programar_cambio_de_precio");

  it("un aumento no se puede programar sin preaviso", () => {
    expect(sql, "el preaviso mínimo dejó de aplicarse al programar")
      .toMatch(/p_vigente_desde < CURRENT_DATE \+ v_minimo/);
  });

  it("y el preaviso se mide contra lo que paga cada uno", () => {
    /**
     * ⚠️ No contra el precio de lista. Si a alguien se le está cobrando menos
     * —porque se suscribió cuando el plan era más barato— para él es un
     * aumento aunque la lista baje. Medirlo contra la lista lo dejaría sin
     * preaviso justo a quien más lo necesita.
     */
    expect(sql, "el preaviso volvió a medirse contra el precio de lista")
      .toMatch(/COALESCE\(s\.precio_ars, v_actual, 0\) < p_precio_nuevo/);
  });

  it("sólo el staff de plataforma puede cambiar precios", () => {
    expect(sql, "se puede cambiar el precio sin ser staff")
      .toMatch(/is_platform_admin\(auth\.uid\(\)\)/);
  });

  it("una baja no espera un mes", () => {
    // Hacer esperar 30 días para cobrarle menos a alguien no protege a nadie.
    expect(archivo, "la baja quedó con el mismo preaviso que el aumento")
      .toMatch(/CASE WHEN p_sube THEN 30 ELSE 0 END/);
  });
});

describe("el comercio ve lo que va a pagar", () => {
  it("Mi plan muestra el precio acordado, no el de lista", () => {
    /**
     * ⚠️ `plans.price_ars_monthly` es el precio de quien se suscribe hoy.
     * Mostrárselo a alguien cuyo `preapproval` se creó con otro monto es
     * mostrarle el precio de otro.
     */
    const page = readFileSync(resolve(ROOT, "src/pages/MiPlanPage.tsx"), "utf8");
    expect(page, "Mi plan dejó de mostrar lo que realmente se le cobra")
      .toMatch(/sub\?\.precio_ars != null/);
  });

  it("y el aviso en pantalla no se puede descartar", () => {
    // Un cambio de precio no es una novedad de marketing: esconderlo detrás de
    // una X vaciaría el aviso de sentido.
    const layout = soloCodigo(
      readFileSync(resolve(ROOT, "src/components/AppLayout.tsx"), "utf8"));
    const i = layout.indexOf("cambioDePrecio &&");
    expect(i, "el banner de cambio de precio desapareció").toBeGreaterThan(-1);
    const bloque = layout.slice(i, layout.indexOf("Trial / subscription status banners"));
    expect(bloque, "el aviso de cambio de precio se volvió descartable")
      .not.toContain("setBannerDismissed");
  });
});
