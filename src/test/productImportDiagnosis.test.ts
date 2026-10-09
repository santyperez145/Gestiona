import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARREGLO_ERROR_SERVIDOR,
  aplicarCorreccion,
  contadoresImportacion,
  diagnosticarImportacion,
  type ContextoImportacion,
} from "@/lib/productImportDiagnosis";
import type { ProductImportPayloadRow } from "@/lib/productImport";

type Fila = ProductImportPayloadRow & { source_row?: number };
const fila = (name: string, campos: Record<string, unknown> = {}, source_row?: number): Fila =>
  ({ name, provided: [...(name ? ["name"] : []), ...Object.keys(campos)], ...campos, ...(source_row ? { source_row } : {}) });
const ctx: ContextoImportacion = { stockMode: "replace", exchangeRate: 1000, autoPrice: false, marginPercent: 80 };
const ids = (filas: Fila[], c = ctx) => diagnosticarImportacion(filas, c).map(p => p.id);

describe("diagnóstico de importación", () => {
  it("un archivo correcto no tiene problemas", () => {
    expect(ids([fila("Martillo", { sku: "M1", sale_price_ars: 1000, cost_ars: 500, stock: 3 })])).toEqual([]);
  });

  it("explica causa, arreglo y ejemplos con la fila de la planilla", () => {
    const [problema] = diagnosticarImportacion([fila("", { sku: "X" }, 14)], ctx);
    expect(problema).toMatchObject({ id: "sin_nombre", bloquea: true, cantidad: 1 });
    expect(problema.causa.length).toBeGreaterThan(20);
    expect(problema.arreglo.length).toBeGreaterThan(20);
    expect(problema.ejemplos[0]).toEqual({ fila: 14, nombre: "Sin nombre", valor: "X" });
  });

  it("detecta los problemas que rechaza el servidor", () => {
    expect(ids([
      fila("A", { sku: "R", sale_price_ars: 10 }), fila("B", { sku: "r", sale_price_ars: 10 }),
      fila("C", { sale_price_ars: "consultar" }),
      fila("D", { sale_price_ars: 10, cost_ars: "n/d" }),
      fila("E", { sale_price_ars: 10, stock: -2 }),
      fila("F", { sale_price_ars: 10, stock: 1.5 }),
      fila("G", { sale_price_ars: 10, discount_price_ars: 20 }),
      fila("H"),
    ])).toEqual(["codigo_repetido", "precio_invalido", "sin_precio", "costo_invalido", "stock_invalido", "oferta_no_menor"]);
    expect(ids([fila("U", { sale_price_ars: 10, cost_usd: 5 })], { ...ctx, exchangeRate: 0 })).toEqual(["sin_cotizacion"]);
  });

  it("con stock conservado no marca el stock", () => {
    expect(ids([fila("A", { sale_price_ars: 10, stock: -1 })], { ...ctx, stockMode: "ignore" })).toEqual([]);
  });

  it("sin precio pero con costo propone el precio sugerido; sin costo propone quitar", () => {
    const conCosto = diagnosticarImportacion([fila("A", { cost_ars: 100 })], ctx)[0];
    expect(conCosto.correccion?.tipo).toBe("activar_precio_sugerido");
    expect(aplicarCorreccion([fila("A", { cost_ars: 100 })], conCosto, ctx).activarPrecioSugerido).toBe(true);
    expect(ids([fila("A", { cost_ars: 100 })], { ...ctx, autoPrice: true })).toEqual([]);
    expect(diagnosticarImportacion([fila("A")], ctx)[0].correccion?.tipo).toBe("quitar_filas");
  });

  it("conserva la última aparición de cada código", () => {
    const filas = [fila("Viejo", { sku: "A1", sale_price_ars: 1 }), fila("Otro", { sku: "B", sale_price_ars: 1 }), fila("Nuevo", { sku: "a1", sale_price_ars: 2 })];
    const problema = diagnosticarImportacion(filas, ctx)[0];
    const { filas: resultado } = aplicarCorreccion(filas, problema, ctx);
    expect(resultado.map(f => f.name)).toEqual(["Otro", "Nuevo"]);
    expect(ids(resultado)).toEqual([]);
  });

  it("no importar el stock quita el campo sólo en las filas afectadas, sin redondear", () => {
    const filas = [fila("A", { sale_price_ars: 1, stock: -3 }), fila("B", { sale_price_ars: 1, stock: 4 })];
    const problema = diagnosticarImportacion(filas, ctx).find(p => p.id === "stock_invalido")!;
    const { filas: resultado } = aplicarCorreccion(filas, problema, ctx);
    expect(resultado[0].provided).not.toContain("stock");
    expect(resultado[0].stock).toBeUndefined();
    expect(resultado[1].stock).toBe(4);
    expect(contadoresImportacion(resultado).negativeStock).toBe(0);
  });

  it("importar sin costo quita ambas monedas de costo", () => {
    const filas = [fila("A", { sale_price_ars: 1, cost_ars: "x" })];
    const problema = diagnosticarImportacion(filas, ctx)[0];
    expect(aplicarCorreccion(filas, problema, ctx).filas[0]).not.toHaveProperty("cost_ars");
  });

  it("los arreglos de errores del servidor corresponden a mensajes reales del SQL", () => {
    const sql = readFileSync("supabase/migrations/20261009000100_catalog_import_supplier.sql", "utf8");
    for (const mensaje of Object.keys(ARREGLO_ERROR_SERVIDOR)) expect(sql, mensaje).toContain(`'${mensaje}'`);
  });

  it("diagnostica 50.000 filas en tiempo razonable", () => {
    const filas = Array.from({ length: 50_000 }, (_, i) => fila(`P${i}`, { sku: `S${i}`, sale_price_ars: 10, stock: i % 7 === 0 ? -1 : 2 }));
    const inicio = performance.now();
    expect(diagnosticarImportacion(filas, ctx)[0].cantidad).toBe(Math.ceil(50_000 / 7));
    expect(performance.now() - inicio).toBeLessThan(1500);
  });
});
