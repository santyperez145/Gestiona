import { describe, it, expect } from "vitest";
import fs from "node:fs";

// Las escrituras que mueven plata o stock (cobrar una deuda, un cheque, una
// cuota, un link de pago, conciliar el banco; lotes, transferencias, órdenes de
// compra, devoluciones, facturas; negocios, seguimientos, tareas y puntos de fidelidad) no pueden ignorar lo que contesta la base: si
// RLS o un trigger las rechaza, la pantalla decía «cobrada» o «guardada» y no lo
// estaba. Mismo criterio que `scripts/escrituras-sin-error.mjs`; cada área que
// se cierra se suma a esta lista.
const ARCHIVOS = [
  "src/lib/supabaseStore.ts",
  "src/pages/ChequesPage.tsx",
  "src/pages/CuotasPage.tsx",
  "src/pages/BankReconciliationPage.tsx",
  "src/pages/PaymentLinksPage.tsx",
  "src/pages/BatchLotPage.tsx",
  "src/pages/InventoryTransfersPage.tsx",
  "src/pages/PurchaseOrdersPage.tsx",
  "src/pages/POSPage.tsx",
  "src/pages/InvoicesPage.tsx",
  "src/components/crm/PipelineKanbanTab.tsx",
  "src/components/crm/SeguimientosView.tsx",
  "src/components/loyalty/LoyaltyPointsTab.tsx",
  "src/pages/CustomersPage.tsx",
  "src/pages/TasksPage.tsx",
];

function escriturasSueltas(fuente: string): number[] {
  const lineas = fuente.split("\n");
  const sueltas: number[] = [];
  lineas.forEach((l, i) => {
    if (!/^\s*await\s+\(?\s*supabase\b/.test(l)) return;
    const tramo = lineas.slice(i, i + 6).join(" ").split(";")[0];
    if (/\.(insert|update|delete|upsert)\s*\(/.test(tramo)) sueltas.push(i + 1);
  });
  return sueltas;
}

describe("plata, stock y clientes: las escrituras miran el error", () => {
  it("el detector encuentra una escritura suelta y deja pasar la que asigna", () => {
    expect(escriturasSueltas(`  await supabase.from("x").update({ a: 1 }).eq("id", id);`)).toEqual([1]);
    expect(escriturasSueltas(`  const { error } = await supabase.from("x").update({ a: 1 });`)).toEqual([]);
  });

  for (const archivo of ARCHIVOS) {
    it(`${archivo} no tiene escrituras sin mirar el error`, () => {
      expect(escriturasSueltas(fs.readFileSync(archivo, "utf8"))).toEqual([]);
    });
  }

  it("el pago de una deuda falla si no se pudo guardar el comprobante", () => {
    const s = fs.readFileSync("src/lib/supabaseStore.ts", "utf8");
    expect(s).toContain("if (ledgerError) throw ledgerError;");
  });
});
