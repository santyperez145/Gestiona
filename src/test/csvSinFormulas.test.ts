import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv";
import { toCSV } from "@/lib/orgDataExport";

/**
 * CSV sin fórmulas (2026-11-04). Un comprador que se llama «=HYPERLINK(…)»
 * queda como cliente; si el comercio exporta y abre el archivo en Excel, la
 * fórmula se ejecuta. Toda exportación tiene que pasar por csvCell (o toCSV).
 *
 * PENDIENTES es deuda conocida: archivos que arman su CSV a mano. La lista
 * sólo puede achicarse; un archivo nuevo que genere CSV sin el helper falla.
 */
const PENDIENTES = new Set([
  "src/components/analytics/ResumenView.tsx",
  "src/components/crm/SegmentosView.tsx",
  "src/components/ecommerce/RecoveryLedger.tsx",
  "src/components/ecommerce/StoreOrdersPanel.tsx",
  "src/components/finance/BankReconciliationPanel.tsx",
  "src/components/inventory/ForecastView.tsx",
  "src/components/inventory/ReposicionView.tsx",
  "src/components/products/ProductsExcelImport.tsx",
  "src/components/shared/IdentityHealthPanel.tsx",
  "src/hooks/useFileSystemAccess.ts",
  "src/lib/financeExport.ts",
  "src/pages/AdminPage.tsx",
  "src/pages/BankReconciliationPage.tsx",
  "src/pages/CashSessionPage.tsx",
  "src/pages/DevolucionesPage.tsx",
  "src/pages/ExpensesPage.tsx",
  "src/pages/FinancialMovementsPage.tsx",
  "src/pages/InventoryValuationPage.tsx",
  "src/pages/KardexPage.tsx",
  "src/pages/PlatformAdminPage.tsx",
  "src/pages/PLDashboardPage.tsx",
  "src/pages/PriceListsPage.tsx",
  "src/pages/ProveedoresPage.tsx",
  "src/pages/PurchasesPage.tsx",
  "src/pages/RemitosPage.tsx",
  "src/pages/SalesPage.tsx",
]);

const HELPER = /csvCell|toCSV|@\/lib\/csv"|@\/lib\/orgDataExport/;
const GENERA_CSV = /text\/csv|\.csv[`"']/;

const archivos = (dir: string): string[] =>
  readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta.replace(/\\/g, "/")] : [];
  });

describe("CSV sin fórmulas", () => {
  it("csvCell y toCSV neutralizan lo que Excel ejecutaría", () => {
    for (const ataque of ['=HYPERLINK("http://evil.example","clic")', "+1+1", "-2+3", "@SUM(A1)", "  =1+1"]) {
      expect(csvCell(ataque)).toMatch(/^"'/);
      expect(toCSV([{ nombre: ataque }]).split("\r\n")[1]).toMatch(/^"?'/);
    }
    // Un número negativo sigue siendo un número.
    expect(toCSV([{ saldo: -150 }]).split("\r\n")[1]).toBe("-150");
  });

  it("ningún archivo nuevo arma CSV sin el helper", () => {
    const sinHelper = archivos("src")
      .filter(f => !f.startsWith("src/test"))
      .filter(f => {
        const fuente = readFileSync(f, "utf8");
        return GENERA_CSV.test(fuente) && !HELPER.test(fuente);
      });
    expect(sinHelper.filter(f => !PENDIENTES.has(f)), "usar csvCell de @/lib/csv").toEqual([]);
  });

  it("la deuda sólo se achica: un pendiente que ya usa el helper sale de la lista", () => {
    const resueltos = [...PENDIENTES].filter(f => HELPER.test(readFileSync(f, "utf8")));
    expect(resueltos, "sacalos de PENDIENTES").toEqual([]);
  });
});
