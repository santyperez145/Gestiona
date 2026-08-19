import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260820000001_costo_de_ventas.sql");
const verificacion = leer("supabase/verificaciones/20260820_costo_de_ventas.sql");

/**
 * H7 — guarda del costo de ventas.
 *
 * Sin estas propiedades el estado de resultados vuelve a ser ingresos menos
 * gastos **sin el costo de la mercadería**, que no es un P&L incompleto: es uno
 * que miente para el lado optimista.
 */
describe("costo de ventas en el libro", () => {
  it("descarga mercadería contra costo de mercadería vendida", () => {
    expect(migracion).toContain("'5.1.01'");
    expect(migracion).toContain("'1.3.01'");
  });

  it("el costo sale del movimiento de stock, no del producto", () => {
    // `products.total_cost_usd` es el costo de HOY. Leerlo haría que cargar una
    // lista de precios nueva reescribiera el margen de las ventas viejas.
    expect(migracion).toContain("FROM public.stock_movements m");
    expect(migracion).toContain("m.unit_cost_usd");
    expect(migracion).not.toMatch(/SELECT[\s\S]{0,80}p\.total_cost_usd[\s\S]{0,80}INTO\s+v_costo/);
  });

  it("deja escrito con qué tipo de cambio se armó", () => {
    // El costo está en dólares y el libro en pesos. Un asiento que no dice con
    // qué cotización se convirtió no se puede auditar después.
    expect(migracion).toContain("tipo_cambio_fuente");
    expect(migracion).toContain("FROM public.exchange_rates er");
    expect(migracion).toContain("s.exchange_rate");
  });

  it("cuenta las líneas sin costo en vez de taparlas", () => {
    // Medido al escribirlo: 8 de 40 movimientos de venta no tienen costo. Si
    // eso pasa en silencio, el margen sale mejor de lo que es.
    expect(migracion).toContain("movimientos_sin_costo");
    expect(migracion).toContain("sin_movimientos_de_stock");
    expect(migracion).toMatch(/RAISE WARNING[\s\S]{0,120}no tienen costo cargado/);
  });

  it("las dos partidas van en el MISMO asiento", () => {
    // Netean entre sí, así que el asiento sigue cuadrando. Y la guarda de
    // idempotencia busca un asiento por orden: con uno separado, creería que
    // ya se asentó todo y el segundo nunca entraría.
    expect(migracion).toContain("v_lineas := v_lineas || jsonb_build_array(");
    expect(migracion).not.toMatch(/ledger_asentar\([\s\S]{0,200}5\.1\.01[\s\S]{0,200}p_ref_tipo\s*:=\s*'orden_costo'/);
  });

  it("la metadata se agrega ANTES de armar las líneas", () => {
    // `v_meta` se copia dentro de la partida del cobro: agregarle algo después
    // no tendría efecto sobre el asiento. Es un bug que ya se cometió una vez
    // al escribir esto.
    const iMeta = migracion.indexOf("'costo_de_ventas', v_meta_costo");
    const iLineas = migracion.indexOf("v_lineas := jsonb_build_array(");
    expect(iMeta).toBeGreaterThan(0);
    expect(iMeta).toBeLessThan(iLineas);
  });

  it("la verificación va aparte y con ROLLBACK, no dentro de la migración", () => {
    // El libro es inmutable: un bloque de prueba que asiente no puede borrar
    // lo que asentó, y la guarda que lo impide es deseable.
    expect(verificacion).toContain("BEGIN;");
    expect(verificacion.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    expect(verificacion).not.toContain("DELETE FROM public.ledger_lines");
    expect(migracion).not.toContain("DO $verif$");
  });
});
