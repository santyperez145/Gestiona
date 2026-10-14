import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  aDatosDeCompra, agruparCompras, compraDesdeFactura, costoSugerido, fechaArgentina, problemasDeLaCompra,
  productoDeLaFactura, totalDeCompra, type FilaDeCompra, type FormularioCompra,
} from "@/lib/compras";

// 2026-10-14 (funciones incoherentes): «Nueva compra» fallaba siempre (columnas
// inexistentes), era un producto por compra con «pasero», y borrar un renglón
// dejaba la deuda y el egreso. Ahora una compra es una unidad que registra y
// anula la base; esto prueba la lógica del navegador alrededor.

const base = (cambios: Partial<FormularioCompra> = {}): FormularioCompra => ({
  proveedorId: null, proveedor: "", comprobante: "", fecha: "2026-10-14", moneda: "ARS", cotizacion: null,
  renglones: [{ clave: "a", productId: "p1", nombre: "Tornillo", qty: 10, costo: 100 }],
  aPagar: false, vencimiento: "2026-11-13", medio: "efectivo", nota: "", actualizarCostos: true, ...cambios,
});

describe("formulario de compra", () => {
  it("el total cuenta sólo los renglones con producto", () => {
    expect(totalDeCompra([
      { clave: "a", productId: "p1", nombre: "A", qty: 2.5, costo: 40 },
      { clave: "b", productId: null, nombre: "", qty: 1, costo: 999 },
    ])).toBe(100);
  });

  it("precarga el costo del producto en la moneda de la compra, con la misma regla que la base", () => {
    expect(costoSugerido({ cost_currency: "ARS", cost_ars: 1500 }, "ARS", null)).toBe(1500);
    expect(costoSugerido({ cost_currency: "ARS", cost_ars: 1500 }, "USD", 1000)).toBe(1.5);
    expect(costoSugerido({ cost_currency: "USD", total_cost_usd: 3 }, "ARS", 1200)).toBe(3600);
    expect(costoSugerido({ cost_currency: "USD", total_cost_usd: 3 }, "ARS", null)).toBe(0);
    expect(costoSugerido({ cost_ars: 800 }, "ARS", null)).toBe(800);
    expect(costoSugerido({ cost_usd: 2 }, "USD", null)).toBe(2);
  });

  it("frena lo que la base rechazaría, con el motivo", () => {
    expect(problemasDeLaCompra(base({ renglones: [] }))[0]).toMatch(/al menos un producto/);
    expect(problemasDeLaCompra(base({ renglones: [{ clave: "a", productId: null, nombre: "De la factura", qty: 1, costo: 5 }] })))
      .toContain("Hay un renglón sin producto: elegilo del catálogo o quitalo");
    expect(problemasDeLaCompra(base({ moneda: "USD", cotizacion: null }))).toContain("Para una compra en dólares cargá la cotización");
    expect(problemasDeLaCompra(base({ aPagar: true }))).toContain("Para dejarla a pagar, elegí el proveedor");
    expect(problemasDeLaCompra(base({ renglones: [{ clave: "a", productId: "p1", nombre: "A", qty: 0, costo: 1 }] })))
      .toContain("Renglón 1: la cantidad tiene que ser mayor a cero");
    expect(problemasDeLaCompra(base())).toEqual([]);
  });

  it("arma el cuerpo de registrar_compra: pagada lleva medio, a pagar lleva vencimiento", () => {
    const pagada = aDatosDeCompra(base({ proveedorId: "s1", proveedor: "Distribuidora", renglones: [
      { clave: "a", productId: "p1", nombre: "A", qty: 2, costo: 10 }, { clave: "b", productId: null, nombre: "", qty: 1, costo: 0 },
    ] }));
    expect(pagada).toMatchObject({ proveedor_id: "s1", proveedor: null, medio: "efectivo", vencimiento: null, a_pagar: false, actualizar_costos: true });
    expect(pagada.items).toEqual([{ producto_id: "p1", cantidad: 2, costo_unitario: 10 }]);
    const aPagar = aDatosDeCompra(base({ aPagar: true, proveedor: "Juan" }));
    expect(aPagar).toMatchObject({ proveedor_id: null, proveedor: "Juan", medio: null, vencimiento: "2026-11-13", a_pagar: true });
  });

  it("la fecha es la de Argentina, no la de UTC", () => {
    expect(fechaArgentina(new Date("2026-10-15T01:30:00Z"))).toBe("2026-10-14");
    expect(fechaArgentina("2026-10-14T12:00:00+00:00")).toBe("2026-10-14");
  });
});

describe("listado de compras", () => {
  const fila = (id: string, cambios: Partial<FilaDeCompra> = {}): FilaDeCompra => ({
    id, date: "2026-10-10T12:00:00+00:00", product_name: `Producto ${id}`, quantity: 1, total_ars: 100, total_usd: 0, ...cambios,
  });

  it("agrupa por compra_id; las viejas sin compra_id son una cada una", () => {
    const compras = agruparCompras([
      fila("r1", { compra_id: "c1", supplier: "Dist", batch_name: "A-1" }),
      fila("r2", { compra_id: "c1", total_ars: 50 }),
      fila("r3", { date: "2026-10-12T12:00:00+00:00" }),
    ], new Map(), [], "2026-10-14");
    expect(compras.map(c => c.id)).toEqual(["r3", "c1"]);
    expect(compras[1]).toMatchObject({ totalArs: 150, proveedor: "Dist", comprobante: "A-1", estadoDePago: "pagada" });
    expect(compras[1].renglones).toHaveLength(2);
  });

  it("el estado de pago sale de la cuenta a pagar y de la orden", () => {
    const deuda = (purchase_id: string, paid: number, due: string | null) => ({ id: `d-${purchase_id}`, purchase_id, amount_ars: 100, paid_ars: paid, remaining_ars: 100 - paid, due_date: due, status: "pending" });
    const compras = agruparCompras(
      [fila("a"), fila("b"), fila("c"), fila("d"), fila("e")],
      new Map([["e", { id: "o1", numero: "OC-0003" }]]),
      [deuda("a", 0, "2026-10-30"), deuda("b", 0, "2026-10-01"), deuda("c", 40, "2026-10-30"), deuda("d", 100, "2026-10-01")],
      "2026-10-14",
    );
    const estado = Object.fromEntries(compras.map(c => [c.id, c.estadoDePago]));
    expect(estado).toEqual({ a: "a_pagar", b: "vencida", c: "pago_parcial", d: "pagada", e: "sin_registrar" });
    expect(compras.find(c => c.id === "e")?.orden?.numero).toBe("OC-0003");
  });

  it("no muestra compras «programadas» viejas: lo que se pide va por órdenes de compra", () => {
    expect(agruparCompras([fila("x", { is_scheduled: true })], new Map(), [])).toEqual([]);
  });
});

describe("factura leída con IA", () => {
  const productos = [
    { id: "p1", name: "Cable unipolar 2,5 mm", sku: "CAB-25", unidad_medida: "metro" },
    { id: "p2", name: "Tornillo autoperforante 8x1", brand: "Fischer" },
    { id: "p3", name: "Tornillo autoperforante 10x1", brand: "Fischer" },
    { id: "p4", name: "Llave térmica 20A" },
  ];

  it("empareja sólo cuando no hay dudas: código, nombre exacto o un único resultado", () => {
    expect(productoDeLaFactura(productos, "cab-25")?.id).toBe("p1");
    expect(productoDeLaFactura(productos, "LLAVE TERMICA 20A")?.id).toBe("p4");
    expect(productoDeLaFactura(productos, "autoperforante 8x1")?.id).toBe("p2");
    expect(productoDeLaFactura(productos, "Tornillo autoperforante")).toBeNull();
    expect(productoDeLaFactura(productos, "Disyuntor")).toBeNull();
  });

  it("precarga la compra: moneda de la mayoría, proveedor de la lista y renglones dudosos para elegir", () => {
    const r = compraDesdeFactura({
      proveedor: "distribuidora  norte", fecha: "2026-10-13",
      renglones: [
        { nombre: "CAB-25", marca: null, qty: 100, costo: 500, moneda: "ARS" },
        { nombre: "Tornillo autoperforante", marca: null, qty: 50, costo: 30, moneda: "ARS" },
        { nombre: "Llave térmica 20A", marca: null, qty: 2, costo: 4, moneda: "USD" },
      ],
    }, productos, [{ id: "s1", name: "Distribuidora Norte" }], 1000, "2026-10-14");
    expect(r.cambios.moneda).toBe("ARS");
    expect(r.cambios.fecha).toBe("2026-10-13");
    expect(r.cambios.proveedorId).toBeUndefined();
    expect(r.proveedorSinCargar).toBe("distribuidora  norte");
    expect(r.sinProducto).toBe(1);
    expect(r.monedasMezcladas).toBe(true);
    expect(r.cambios.renglones?.map(x => [x.productId, x.qty, x.costo])).toEqual([["p1", 100, 500], [null, 50, 30], ["p4", 2, 4000]]);
  });

  it("una fecha futura de la factura no se usa", () => {
    const r = compraDesdeFactura({ proveedor: "Distribuidora Norte", fecha: "2027-01-01", renglones: [{ nombre: "CAB-25", marca: null, qty: 1, costo: 1, moneda: "ARS" }] },
      productos, [{ id: "s1", name: "Distribuidora Norte" }], null, "2026-10-14");
    expect(r.cambios.fecha).toBeUndefined();
    expect(r.cambios.proveedorId).toBe("s1");
  });
});

describe("la pantalla de Compras dejó lo legado", () => {
  const pagina = fs.readFileSync("src/pages/PurchasesPage.tsx", "utf8");
  const editor = fs.readFileSync("src/components/compras/EditorDeCompra.tsx", "utf8");
  const store = fs.readFileSync("src/lib/supabaseStore.ts", "utf8");

  it("sin programadas, «en camino», pasero, Excel de orden ni mail de un producto", () => {
    for (const legado of ["is_scheduled", "travel_status", "en_camino", "pasero", "customs", "send-supplier-po", "PurchaseOrderGenerator", "updatePurchaseDB", "deletePurchaseDB"]) {
      expect(pagina, legado).not.toContain(legado);
    }
    expect(store).not.toContain("export async function addPurchaseDB");
  });

  it("registra y anula por la base, y pedir mercadería lleva a Órdenes de compra", () => {
    expect(editor).toContain("registrarCompraDB(orgId, f)");
    expect(pagina).toContain("anularCompraDB(activeOrg.id, c.id)");
    expect(pagina).toContain('navigate("/ordenes-compra")');
  });

  it("las migraciones de la compra completa están en el repo", () => {
    for (const m of ["20261014001500_registrar_compra", "20261014001600_compra_completa", "20261014001700_compra_actualiza_costo", "20261014001800_compra_fecha_al_mediodia"]) {
      expect(fs.existsSync(`supabase/migrations/${m}.sql`), m).toBe(true);
    }
  });
});
