import { describe, expect, it } from "vitest";
import {
  financeFocoFromSnapshot,
  financeMetricHref,
  type FinanceCoreSnapshot,
} from "@/lib/financeProductDB";

const vacio: FinanceCoreSnapshot = {
  suppliersCount: 0,
  openPurchaseOrders: 0,
  openPayablesCount: 0,
  openPayablesArs: 0,
  ledgerEntriesCount: 0,
  precursorOcrDocuments: 0,
};

describe("financeFocoFromSnapshot", () => {
  it("sin operación sugiere cargar proveedor, no inventa colas F5", () => {
    const foco = financeFocoFromSnapshot(vacio);
    expect(foco).toHaveLength(1);
    expect(foco[0]?.to).toBe("/proveedores");
    expect(foco[0]?.label).toMatch(/proveedor/i);
  });

  it("prioriza la bandeja documental con vista y no pasa de cinco", () => {
    const foco = financeFocoFromSnapshot({
      ...vacio,
      precursorOcrDocuments: 2,
      openPurchaseOrders: 3,
      openPayablesCount: 1,
      suppliersCount: 4,
    });
    expect(foco.length).toBeLessThanOrEqual(5);
    expect(foco[0]?.to).toBe("/finance/documentos?vista=revisar");
    expect(foco.some(i => i.to === "/ordenes-compra")).toBe(true);
    expect(foco.some(i => i.to === "/libro")).toBe(true);
  });

  it("con id concreto abre el inspector Mendel (?documento=)", () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const foco = financeFocoFromSnapshot(
      { ...vacio, precursorOcrDocuments: 1, suppliersCount: 1 },
      { nextReviewDocumentId: id },
    );
    expect(foco[0]?.to).toBe(
      `/finance/documentos?vista=revisar&documento=${id}`,
    );
    expect(financeMetricHref(
      "precursorOcrDocuments",
      { ...vacio, precursorOcrDocuments: 1 },
      { nextReviewDocumentId: id },
    )).toBe(`/finance/documentos?vista=revisar&documento=${id}`);
  });

  it("cada métrica con evidencia abre la cola exacta", () => {
    const s: FinanceCoreSnapshot = {
      ...vacio,
      precursorOcrDocuments: 1,
      openPurchaseOrders: 2,
      openPayablesCount: 3,
      openPayablesArs: 1000,
      suppliersCount: 5,
      ledgerEntriesCount: 9,
    };
    expect(financeMetricHref("precursorOcrDocuments", s)).toBe("/finance/documentos?vista=revisar");
    expect(financeMetricHref("openPurchaseOrders", s)).toBe("/ordenes-compra");
    expect(financeMetricHref("openPayablesCount", s)).toBe("/ordenes-compra");
    expect(financeMetricHref("suppliersCount", s)).toBe("/proveedores");
    expect(financeMetricHref("ledgerEntriesCount", s)).toBe("/libro");
  });
});
