import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const migracion = readFileSync(
  resolve(ROOT, "supabase/migrations/20260826000200_asiento_con_la_fecha_del_hecho.sql"),
  "utf8",
);

/**
 * Sólo el SQL ejecutable de las dos funciones: sin la cabecera explicativa ni
 * el bloque de verificación, que nombran los antipatrones para documentarlos.
 * Buscarlos en el archivo entero hace que el test falle contra su propia
 * documentación — ya pasó una vez y cuesta entenderlo.
 */
const cuerpos = migracion
  .slice(migracion.indexOf("CREATE OR REPLACE FUNCTION"), migracion.indexOf("-- ── Verificación"))
  .split(/\r?\n/)
  .filter(l => !l.trim().startsWith("--"))
  .join("\n");

/**
 * El asiento se fecha cuando pasó la venta, no cuando el outbox lo procesó.
 *
 * ── Lo que se midió (2026-08-26) ──────────────────────────────────────────
 *
 * `ledger_entries` tenía 0 asientos contra 34 ventas por $1.143.696. La causa
 * no era un cableado roto —se probó la cadena entera con una venta `ZZ` en una
 * transacción revertida y funciona— sino que **las ventas son de abril a julio
 * y el motor de eventos es del 19 de agosto**: nunca pasó tráfico.
 *
 * El bug que sí apareció: `ledger_asentar_venta_pos` y
 * `ledger_asentar_orden_pagada` fechaban con `CURRENT_DATE`. Un ticket de las
 * 23:50 despachado por un reintento a las 00:05 quedaba asentado al día
 * siguiente, y el resultado diario salía mal dos días seguidos.
 */
describe("la fecha del asiento sale del hecho", () => {
  it("ninguna función vuelve a fechar con CURRENT_DATE", () => {
    expect(cuerpos).not.toMatch(/p_fecha\s+:= CURRENT_DATE/);
  });

  it("las dos funciones fechan por el hecho", () => {
    const ocurrencias = cuerpos.match(/p_fecha\s+:= v_fecha/g) ?? [];
    expect(ocurrencias).toHaveLength(2);
  });

  it("la venta prioriza su propia fecha sobre la del evento", () => {
    // `sale_transactions.occurred_at` es cuándo se vendió; el `occurred_at` del
    // evento es cuándo se emitió. Coinciden en vivo y difieren en un backfill,
    // que es justo el caso que importa.
    expect(cuerpos).toMatch(/v_fecha := COALESCE\(\s*v_ocurrido::date/);
  });

  it("la orden usa el occurred_at del evento, no updated_at", () => {
    // `ecommerce_orders` no tiene columna de fecha de pago, y `updated_at`
    // cambia con cualquier edición posterior: fecharía el cobro el día en que
    // alguien tocó la orden.
    expect(cuerpos).toMatch(/v_fecha := COALESCE\(\s*NULLIF\(p_evento->>'occurred_at'/);
    expect(cuerpos).not.toMatch(/p_fecha\s+:= v_o\.updated_at/);
  });

  it("hay un último recurso, y es el peor de los tres", () => {
    // Si no hay fecha del hecho ni del evento, hoy es lo único que queda —
    // pero como fallback explícito, no como default silencioso.
    expect(migracion).toContain("CURRENT_DATE);");
  });
});

describe("regenerar las funciones no perdió sus salvaguardas", () => {
  it("la guarda de idempotencia sigue mirando el libro", () => {
    // La verdad de si ya se asentó está en el libro, no en una bandera de la
    // venta. Perderla al regenerar duplicaría ingresos.
    expect(migracion).toContain("referencia_tipo = 'venta_pos'");
    expect(migracion).toMatch(/anulado_por IS NULL AND e\.anula_a IS NULL/);
  });

  it("una venta de la tienda no se asienta dos veces", () => {
    // La orden ya la asienta `ledger_asentar_orden_pagada`; asentarla otra vez
    // desde el renglón duplicaría el ingreso del mismo dinero.
    expect(migracion).toContain("IF v_source = 'tienda_online' THEN RETURN NULL; END IF;");
  });

  it("el fiado no se cuenta como caja", () => {
    // Una venta a cuenta corriente asentada como efectivo infla la caja del
    // día y esconde el crédito: los dos errores a la vez.
    expect(migracion).toMatch(/v_r\.paid IS FALSE OR v_r\.payment_method = 'fiado'/);
  });

  it("un ticket sin renglones levanta excepción en vez de asentar cero", () => {
    // El evento llegó antes que los datos; el outbox tiene que reintentar.
    expect(migracion).toContain("todavia no tiene renglones");
  });

  it("una diferencia de reparto queda anotada, no tapada", () => {
    expect(cuerpos).toContain("diferencia_de_reparto");
    expect(cuerpos).not.toMatch(/GREATEST\(0,/);
  });

  it("un método de cobro sin cuenta no pasa en silencio", () => {
    expect(migracion).toContain("metodos_no_mapeados");
  });
});
