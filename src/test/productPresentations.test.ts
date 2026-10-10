import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  errorPrecioPresentacion, errorPresentacion, etiquetaPresentacion, precioDeCajaQueAplica,
  precioUnitarioDeCaja, presentacionPorCodigo,
} from "@/lib/productPresentations";

describe("presentaciones de producto", () => {
  const cajas = [
    { id: "a", product_id: "p", name: "Pack x6", factor: 6, barcode: "7790001" },
    { id: "b", product_id: "p", name: "Caja x24", factor: 24, barcode: null },
  ];

  it("encuentra la caja por su código y nunca por un código vacío", () => {
    expect(presentacionPorCodigo(cajas, " 7790001 ")?.id).toBe("a");
    expect(presentacionPorCodigo(cajas, "")).toBeNull();
    expect(presentacionPorCodigo(cajas, "999")).toBeNull();
  });

  it("valida cantidades según la unidad del producto", () => {
    expect(errorPresentacion("Caja", 12, "unidad")).toBeNull();
    expect(errorPresentacion("Medio", 0.5, "unidad")).toMatch(/unidades enteras/);
    expect(errorPresentacion("Horma", 4.5, "kg")).toBeNull();
    expect(errorPresentacion("", 4, "kg")).toMatch(/nombre/);
    expect(errorPresentacion("Caja", 0, "unidad")).toMatch(/mayor a cero/);
    expect(errorPresentacion("Rollo", 1.2345, "metro")).toMatch(/tres decimales/);
    expect(etiquetaPresentacion({ name: "Horma", factor: 4.5 }, "kg")).toBe("Horma (4,5 kg)");
    expect(etiquetaPresentacion({ name: "Caja", factor: 12 })).toBe("Caja (12 u.)");
  });

  it("el POS suma las unidades de la caja escaneada", () => {
    const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
    expect(pos).toContain("addToCart(prodDeCaja, undefined, Number(presentacion.factor), presentacion);");
    expect(pos).toContain("quantity: cantidad,");
    const sql = readFileSync("supabase/migrations/20261009001200_presentaciones_producto.sql", "utf8");
    expect(sql).toContain("ON public.product_presentations(org_id, barcode) WHERE barcode IS NOT NULL");
  });
});

describe("precio propio de la caja — espejo de precio_presentacion_autoritativo", () => {
  // Los mismos escenarios que scripts/presentation-price-matrix.sql corrió
  // contra la base: el cliente tiene que mostrar lo que la base va a cobrar.
  const caja12 = { factor: 12, price_ars: 9600 };   // 800 por unidad

  it("caja con precio: 800 por unidad llevándose una caja", () => {
    expect(precioUnitarioDeCaja(caja12)).toBe(800);
    expect(precioDeCajaQueAplica(caja12, 12, 1000)).toBe(800);
    expect(precioDeCajaQueAplica(caja12, 18, 1000)).toBe(800);
  });

  it("menos que una caja no paga precio de caja", () => {
    expect(precioDeCajaQueAplica(caja12, 11, 1000)).toBeNull();
  });

  it("la caja sólo mejora el precio: más cara por unidad, gana el suelto", () => {
    expect(precioDeCajaQueAplica({ factor: 2, price_ars: 2500 }, 2, 1000)).toBeNull();
    // y si el suelto ya está en oferta por debajo de la caja, gana la oferta
    expect(precioDeCajaQueAplica(caja12, 12, 750)).toBeNull();
  });

  it("sin precio propio es un atajo de cantidad, como antes", () => {
    expect(precioDeCajaQueAplica({ factor: 12, price_ars: null }, 12, 1000)).toBeNull();
    expect(precioUnitarioDeCaja({ factor: 12 })).toBeNull();
  });

  it("redondea por unidad como la base (ARS, 2 decimales)", () => {
    expect(precioUnitarioDeCaja({ factor: 3, price_ars: 1000 })).toBe(333.33);
  });

  it("valida el precio de la caja", () => {
    expect(errorPrecioPresentacion("")).toBeNull();
    expect(errorPrecioPresentacion("9600")).toBeNull();
    expect(errorPrecioPresentacion("9600,50")).toBeNull();
    expect(errorPrecioPresentacion("0")).toMatch(/mayor a cero/);
    expect(errorPrecioPresentacion("abc")).toMatch(/mayor a cero/);
    expect(errorPrecioPresentacion("10.123")).toMatch(/dos decimales/);
  });
});

describe("el contrato de la migración 20261009001500", () => {
  const sql = readFileSync("supabase/migrations/20261009001500_precio_y_recepcion_por_presentacion.sql", "utf8");

  it("la autoridad no se expone al navegador", () => {
    expect(sql).toContain("FROM PUBLIC, anon, authenticated;");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.precio_presentacion_autoritativo\(uuid, uuid, uuid, numeric\)\s+TO service_role;/);
  });

  it("el precio de caja sólo baja y se fija antes del descuento por medio de pago", () => {
    expect(sql).toContain("AND (v_bulto->>'precio_unitario')::numeric < v_precio THEN");
    const aplica = sql.indexOf("v_precio := (v_bulto->>'precio_unitario')::numeric;");
    const baseline = sql.indexOf("    v_precio_pre_medio := v_precio;" + String.fromCharCode(10));
    expect(aplica).toBeGreaterThan(0);
    expect(baseline).toBeGreaterThan(aplica);
  });

  it("una caja de otro producto se rechaza; una borrada se ignora", () => {
    expect(sql).toContain("IF p_product_id IS NULL OR v_pp.product_id <> p_product_id THEN");
    expect(sql).toContain("v_linea := v_linea - 'presentation_id';");
  });

  it("la recepción convierte cajas con el factor de la base y exige el mismo producto", () => {
    expect(sql).toContain("v_qty := v_bultos * v_factor;");
    expect(sql).toContain("v_pp_producto IS DISTINCT FROM v_it.product_id");
  });
});

describe("el cliente usa la caja sin decidir el precio", () => {
  const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
  const ordenes = readFileSync("src/pages/PurchaseOrdersPage.tsx", "utf8");

  it("la venta manda cuál caja, no un precio inventado", () => {
    expect(pos).toContain("presentation_id: item.presentationId ?? null,");
    expect(pos).toContain("precioDeCajaQueAplica(");
  });

  it("promociones y reservas buscan el producto, no la clave del renglón", () => {
    expect(pos).toContain("{ id: partesDeClave(item.productId).productId, category: item.category");
    expect(pos).toContain("onlineReservations[reservationKey(productId, variantId)]");
  });

  it("la recepción por caja manda también la cantidad, para la base sin migrar", () => {
    expect(ordenes).toContain("{ item_id: i.id, quantity: cantidad, presentation_id: caja.id, bultos: Number(cantidades[i.id] ?? 0) }");
  });
});
