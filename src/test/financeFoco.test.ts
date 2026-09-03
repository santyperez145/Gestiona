import { describe, expect, it } from "vitest";
import { financeFocoFromSnapshot, type FinanceCoreSnapshot } from "@/lib/financeProductDB";

const vacio: FinanceCoreSnapshot = {
  suppliersCount: 0,
  openPurchaseOrders: 0,
  openPayablesCount: 0,
  openPayablesArs: 0,
  ledgerEntriesCount: 0,
  precursorOcrDocuments: 0,
};

describe("financeFocoFromSnapshot", () => {
  it("sin evidencia no inventa oportunidades", () => {
    expect(financeFocoFromSnapshot(vacio)).toEqual([]);
  });

  it("prioriza la bandeja documental y no pasa de cinco", () => {
    const foco = financeFocoFromSnapshot({
      ...vacio,
      precursorOcrDocuments: 2,
      openPurchaseOrders: 3,
      openPayablesCount: 1,
      suppliersCount: 4,
    });
    expect(foco.length).toBeLessThanOrEqual(5);
    expect(foco[0]?.to).toBe("/finance/documentos");
    expect(foco.some(i => i.to === "/ordenes-compra")).toBe(true);
    expect(foco.some(i => i.to === "/libro")).toBe(true);
  });
});
