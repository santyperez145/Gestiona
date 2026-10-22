import { describe, expect, it } from "vitest";
import { pasosDeOperacion, tituloDeComprobante, type DocumentosDeVenta } from "@/lib/documentosDeVenta";
import type { Remito } from "@/lib/remitos";

const lineas = [{ id: "s1", product_name: "Tornillo", quantity: 10, returned_quantity: 0 }];
const vacio: DocumentosDeVenta = { presupuesto: null, remitos: [], facturas: [], cuenta: { total: 0, pagado: 0, saldo: 0, pagos: [] }, devoluciones: [], faltantes: [] };
const remito = (cantidad: number, estado: Remito["estado"] = "emitido"): Remito => ({
  id: `r${cantidad}${estado}`, punto_venta: 1, numero: 1, letra: "X", cai: null, cai_vence: null, fecha: "2026-10-22",
  sale_transaction_id: null, customer_id: null, cliente_nombre: "ZZ", cliente_cuit: null, cliente_domicilio: null, transportista: null,
  bultos: null, valor_declarado: null, observaciones: null, estado, entregado_at: null, recibio_nombre: null, recibio_dni: null,
  anulado_at: null, anulado_motivo: null, created_at: "2026-10-22T10:00:00Z",
  remito_items: [{ sale_id: "s1", product_id: null, descripcion: "Tornillo", cantidad, unidad: "un" }],
});
const factura = (cambios: Partial<NonNullable<DocumentosDeVenta["facturas"]>[number]> = {}) => ({
  id: "f1", titulo: "Factura B", numero: "00003-00000125", fecha: "2026-10-22", total: 1000,
  autorizada: true, rechazada: false, esNotaDeCredito: false, cae: "71234567890123", ...cambios,
});
const estado = (docs: DocumentosDeVenta) => Object.fromEntries(pasosDeOperacion(docs, lineas, 1000).map(p => [p.id, p.estado]));

describe("operación completa de una venta", () => {
  it("una venta de mostrador cobrada y sin factura: sólo falta facturar", () => {
    expect(estado(vacio)).toEqual({ presupuesto: "no_aplica", entrega: "no_aplica", factura: "pendiente", cobro: "hecho" });
  });

  it("mayorista: presupuesto, entrega parcial, factura con CAE y saldo en cuenta corriente", () => {
    const docs: DocumentosDeVenta = {
      ...vacio,
      presupuesto: { id: "q1", numero: "P-0007", fecha: "2026-10-20", total: 1000, estado: "accepted" },
      remitos: [remito(6), remito(4, "anulado")],
      facturas: [factura()],
      cuenta: { total: 1000, pagado: 400, saldo: 600, pagos: [{ fecha: "2026-10-21", monto: 400, medio: "Transferencia" }] },
    };
    const pasos = pasosDeOperacion(docs, lineas, 1000);
    expect(Object.fromEntries(pasos.map(p => [p.id, p.estado]))).toEqual({ presupuesto: "hecho", entrega: "parcial", factura: "hecho", cobro: "parcial" });
    expect(pasos.find(p => p.id === "entrega")?.detalle).toBe("1 remito · falta entregar");
    expect(pasos.find(p => p.id === "cobro")?.detalle).toMatch(/^Debe \$\s?600,00 de \$\s?1\.000,00$/);
  });

  it("entregada completa, facturada con nota de crédito y cuenta saldada", () => {
    const docs: DocumentosDeVenta = {
      ...vacio,
      remitos: [remito(10, "entregado")],
      facturas: [factura(), factura({ id: "nc", titulo: "Nota de crédito B", esNotaDeCredito: true })],
      cuenta: { total: 1000, pagado: 1000, saldo: 0, pagos: [] },
    };
    const pasos = pasosDeOperacion(docs, lineas, 1000);
    expect(Object.fromEntries(pasos.map(p => [p.id, p.estado]))).toEqual({ presupuesto: "no_aplica", entrega: "hecho", factura: "hecho", cobro: "hecho" });
    expect(pasos.find(p => p.id === "factura")?.detalle).toBe("Factura B 00003-00000125 · 1 nota de crédito");
  });

  it("una factura rechazada por ARCA no cuenta como facturada", () => {
    const docs: DocumentosDeVenta = { ...vacio, facturas: [factura({ autorizada: false, rechazada: true, cae: null })] };
    const factPaso = pasosDeOperacion(docs, lineas, 1000).find(p => p.id === "factura");
    expect(factPaso).toMatchObject({ estado: "pendiente", detalle: "Rechazada por ARCA: revisar" });
  });

  it("lo que no se pudo leer dice «sin datos», no «pendiente»", () => {
    const docs: DocumentosDeVenta = { ...vacio, remitos: null, facturas: null, cuenta: null, faltantes: ["los remitos", "las facturas", "el cobro"] };
    expect(estado(docs)).toEqual({ presupuesto: "no_aplica", entrega: "desconocido", factura: "desconocido", cobro: "desconocido" });
  });

  it("nombra los comprobantes como ARCA", () => {
    expect(tituloDeComprobante(1)).toBe("Factura A");
    expect(tituloDeComprobante(8)).toBe("Nota de crédito B");
    expect(tituloDeComprobante(201)).toBe("Factura de crédito electrónica MiPyME A");
    expect(tituloDeComprobante(null)).toBe("Factura");
  });
});
