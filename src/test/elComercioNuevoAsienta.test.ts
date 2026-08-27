import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * La primera venta de un comercio nuevo llega al libro.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * Auditando qué ve un comercio nuevo —`pruebas Workspace`, que existe desde el
 * 2026-08-04 con cero productos— se le vendió una unidad por el camino real
 * del POS, en una transacción revertida:
 *
 *     vender en el POS        PUDO
 *     stock                   5 → 4
 *     movimientos de Kardex   1
 *     asientos en el ledger   0        ← acá
 *
 * El motivo, sacado llamando a `ledger_asentar_venta` directo:
 * «La cuenta 1.1.01 no existe en el plan».
 *
 * ⚠️ Y era un círculo cerrado escrito a mano: los tres triggers de asiento
 * arrancaban con «sin plan de cuentas no hay libro donde asentar, RETURN NEW»,
 * y nada más sembraba el plan. Un comercio nuevo **nunca** empezaba a asentar:
 * vendía bien y su libro quedaba vacío para siempre.
 *
 * No hacía ruido porque el trigger atrapa la excepción a propósito —una venta
 * no puede caerse por contabilidad—. Y con una sola organización no se puede
 * reproducir: Exentry ya tenía sus 25 cuentas de antes.
 *
 * 📌 Es la misma familia que el descuento doble de stock. Al medir cualquier
 * cosa del Business Core hay que pensar en dos comercios, no en uno.
 */

const MIGRACIONES = resolve(__dirname, "../../supabase/migrations");

/** La última migración que define la función: la que queda aplicada. */
function ultimaDefinicion(fn: string): { archivo: string; cuerpo: string } | null {
  const archivos = readdirSync(MIGRACIONES).filter(f => f.endsWith(".sql")).sort();
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, "i");
  for (let i = archivos.length - 1; i >= 0; i--) {
    const completo = readFileSync(resolve(MIGRACIONES, archivos[i]), "utf8");
    const m = re.exec(completo);
    if (!m) continue;
    const abre = completo.indexOf("$function$", m.index);
    const cierra = abre === -1 ? -1 : completo.indexOf("$function$", abre + 10);
    return {
      archivo: archivos[i],
      cuerpo: completo.slice(m.index, cierra === -1 ? undefined : cierra),
    };
  }
  return null;
}

const TRIGGERS = ["trg_asentar_venta", "trg_asentar_gasto", "trg_asentar_cobranza"];

describe("la primera venta de un comercio nuevo llega al libro", () => {
  it("la puerta única del libro siembra el plan de cuentas", () => {
    // Va en `ledger_asentar` y no en cada función que asienta: cubre de una
    // vez la venta, el gasto, el retiro y lo que venga. Ponerlo en cada una
    // sería la misma decisión escrita en cinco lugares — que es exactamente
    // cómo se perdió: `ledger_asentar_venta_pos` la tenía y al reescribir
    // `ledger_asentar_venta` el 2026-08-26 no se llevó.
    const def = ultimaDefinicion("ledger_asentar");
    expect(def, "ninguna migración define ledger_asentar").not.toBeNull();

    // ⚠️ Se exige la LLAMADA, no la mención: el comentario que explica por qué
    // está acá también dice «ledger_plan_default», así que buscar el nombre
    // suelto pasaba aunque se borrara el `PERFORM`. Probado en rojo.
    expect(def!.cuerpo, `${def!.archivo}: ledger_asentar dejó de sembrar el plan de cuentas`)
      .toMatch(/PERFORM\s+public\.ledger_plan_default\s*\(/);
  });

  for (const trg of TRIGGERS) {
    it(`${trg} no vuelve a cortar por falta de plan de cuentas`, () => {
      const def = ultimaDefinicion(trg);
      expect(def, `ninguna migración define ${trg}`).not.toBeNull();

      expect(def!.cuerpo, [
        `${def!.archivo}: ${trg} volvió a cortar cuando no hay plan de cuentas.`,
        "",
        "Suena prudente y es un círculo cerrado: sin plan no se asienta, y el",
        "plan se siembra al asentar. Un comercio nuevo no arranca nunca — vende",
        "bien y su libro queda vacío, sin hacer ruido, porque el trigger atrapa",
        "la excepción para no voltear la venta.",
        "",
        "`ledger_asentar` ya siembra el plan y es idempotente: «todavía no tiene",
        "plan» dejó de ser un motivo para no registrar nada.",
      ].join("\n")).not.toMatch(/IF NOT EXISTS \(SELECT 1 FROM public\.ledger_accounts/);
    });
  }

  it("pero se sigue sin asentar lo que no tiene importe", () => {
    // Sacar la guarda del plan no puede llevarse la otra: un asiento de cero
    // no dice nada y ensucia el libro.
    const def = ultimaDefinicion("trg_asentar_venta")!;
    expect(def.cuerpo, "se perdió la guarda de importe cero")
      .toMatch(/total_ars[\s\S]{0,40}<=\s*0/);
  });

  it("y la venta sigue guardándose aunque el asiento falle", () => {
    // Una venta no puede caerse por contabilidad. Lo pendiente queda visible
    // en `operaciones_sin_asentar`, no en un log que nadie mira.
    const def = ultimaDefinicion("trg_asentar_venta")!;
    expect(def.cuerpo, "el trigger dejó de atrapar el error del asiento")
      .toMatch(/EXCEPTION\s+WHEN\s+others/i);
  });
});
