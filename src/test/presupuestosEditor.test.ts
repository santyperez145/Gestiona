import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  aItemsGuardados, avisoDeStock, deItemsGuardados, pasoParaCantidad, problemasDelPresupuesto,
  productoPorCodigo, totalDeRenglon, totalesDePresupuesto, type RenglonPresupuesto,
} from "@/lib/presupuestos";

// Pedido del dueño 2026-10-14: «rearmá completamente la página de
// presupuestos, quedó legacy: no toma los productos, sólo carga manual».
// Ahora los renglones salen del catálogo y la base recalcula al guardar
// (`guardar_presupuesto`, 20261014001000); esto es la misma cuenta en pantalla.
const r = (x: Partial<RenglonPresupuesto>): RenglonPresupuesto => ({
  clave: "k", productId: null, variantId: null, description: "", qty: 1, unitPrice: 0, discountPct: 0, ...x,
});

describe("presupuestos: la cuenta", () => {
  it("renglón = cantidad × precio − descuento %, al centavo (igual que la base)", () => {
    expect(totalDeRenglon(r({ qty: 12.5, unitPrice: 100, discountPct: 10 }))).toBe(1125);
    expect(totalDeRenglon(r({ qty: 3, unitPrice: 0.1 }))).toBe(0.3);
    expect(totalDeRenglon(r({ qty: 1, unitPrice: 100, discountPct: 150 }))).toBe(0);
  });

  it("totales con descuento general, nunca negativos", () => {
    const renglones = [r({ qty: 12.5, unitPrice: 100, discountPct: 10 }), r({ qty: 2, unitPrice: 5000 }), r({ qty: 1, unitPrice: 3000 })];
    expect(totalesDePresupuesto(renglones, 100)).toEqual({ subtotal: 14125, descuento: 100, total: 14025 });
    expect(totalesDePresupuesto(renglones, 999999).total).toBe(0);
  });

  it("dice qué falta antes de guardar, sin adivinar", () => {
    expect(problemasDelPresupuesto("", [r({})], 0)).toEqual(["Elegí o escribí el cliente.", "Agregá al menos un ítem."]);
    expect(problemasDelPresupuesto("Ana", [r({ description: "Flete", qty: 0, unitPrice: 10 })], 0)).toEqual(["Flete: la cantidad tiene que ser mayor a cero."]);
    expect(problemasDelPresupuesto("Ana", [r({ description: "Flete", qty: 1, unitPrice: 10 })], 50)).toEqual(["El descuento general supera el subtotal."]);
    expect(problemasDelPresupuesto("Ana", [r({ productId: "p1", description: "Cable", qty: 1, unitPrice: 10 })], 0)).toEqual([]);
  });

  it("guarda las claves que ya leen el PDF, el link de pago y la caja, y vuelve igual al editar", () => {
    const items = aItemsGuardados([r({ productId: "p1", variantId: "v1", description: "Remera · M", qty: 2, unitPrice: 5000, discountPct: 10 }), r({})]);
    expect(items).toEqual([{ description: "Remera · M", qty: 2, unitPrice: 5000, discountPct: 10, total: 9000, productId: "p1", variantId: "v1" }]);
    const vuelta = deItemsGuardados(items);
    expect(vuelta.map(x => [x.productId, x.variantId, x.qty, x.unitPrice, x.discountPct])).toEqual([["p1", "v1", 2, 5000, 10]]);
  });
});

describe("presupuestos: el catálogo", () => {
  const productos = [
    { id: "p1", sku: "CAB-1", barcode: "7790001", barcode_aliases: ["CAJA-12"] },
    { id: "p2", sku: "REM", barcode: null, barcode_aliases: null },
  ];

  it("el lector agrega por código de barras, SKU o código alternativo exacto", () => {
    expect(productoPorCodigo(productos, "7790001")?.id).toBe("p1");
    expect(productoPorCodigo(productos, " cab-1 ")?.id).toBe("p1");
    expect(productoPorCodigo(productos, "caja-12")?.id).toBe("p1");
    expect(productoPorCodigo(productos, "rem")?.id).toBe("p2");
    expect(productoPorCodigo(productos, "779")).toBeNull();
  });

  it("avisa si lo presupuestado supera el stock (sin bloquear), salvo que no maneje stock", () => {
    expect(avisoDeStock(5, 3, true, "metro")).toBe("Hay 3 metro");
    expect(avisoDeStock(1, 0, true)).toBe("Sin stock ahora");
    expect(avisoDeStock(2, 3, true)).toBeNull();
    expect(avisoDeStock(99, 0, false)).toBeNull();
  });

  it("las medidas aceptan tres decimales; las unidades, enteros", () => {
    expect(pasoParaCantidad("kg")).toBe("0.001");
    expect(pasoParaCantidad("unidad")).toBe("1");
    expect(pasoParaCantidad(null)).toBe("1");
  });
});

describe("presupuestos: la pantalla", () => {
  const pagina = fs.readFileSync("src/pages/PresupuestosPage.tsx", "utf8");
  const editor = fs.readFileSync("src/components/presupuestos/EditorDePresupuesto.tsx", "utf8");
  const sql = fs.readFileSync("supabase/migrations/20261014001000_guardar_presupuesto.sql", "utf8");

  it("ya no inserta presupuestos desde el navegador ni inventa números", () => {
    expect(pagina).not.toMatch(/from\("quotes"\)\.insert/);
    expect(pagina).not.toContain("PRE-${Date.now()}");
    expect(editor).toContain('supabase.rpc("guardar_presupuesto"');
  });

  it("se puede editar lo que no se vendió, duplicar y crear con el mismo editor", () => {
    expect(pagina).toContain("{!q.converted_at && (\n                    <button onClick={() => editar(q)}");
    expect(pagina).toContain('setEditor({ modo: "duplicar"');
    expect(pagina).toContain('setEditor({ modo: "nuevo", inicial: null })');
  });

  it("los productos salen del catálogo, con código, variantes y la lista de precios del cliente", () => {
    expect(editor).toContain("<ProductCombobox<Producto>");
    expect(editor).toContain("productoPorCodigo(productos, codigo)");
    expect(editor).toContain("usePriceList(cliente.priceListId)");
    expect(editor).toContain("Elegí la variante…");
  });

  it("la base recalcula, verifica productos del negocio y numera", () => {
    expect(sql).toContain("v_linea := round(v_cant * v_precio * (1 - v_dpct / 100), 2);");
    expect(sql).toContain("FROM public.products WHERE id = v_prod AND org_id = p_org;");
    expect(sql).toContain("public.next_quote_number(p_org)");
    expect(sql).toContain("SECURITY INVOKER");
  });
});
