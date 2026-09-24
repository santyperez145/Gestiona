import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const posPage = readFileSync(resolve(root, "src/pages/POSPage.tsx"), "utf8");
const creatorDiscovery = readFileSync(resolve(root, "src/pages/CreatorDiscoveryPage.tsx"), "utf8");
const expensesPage = readFileSync(resolve(root, "src/pages/ExpensesPage.tsx"), "utf8");

describe("mejoras exhaustivas en plataforma principal, marz y mendel", () => {
  it("el POS provee atajos de billetes rápidos y botón Exacto para cobros en efectivo", () => {
    expect(posPage).toContain("Exacto (");
    expect(posPage).toContain("denominaciones = [1000, 2000, 5000, 10000, 20000]");
    expect(posPage).toContain("setCashGiven(String(cartTotal))");
    expect(posPage).toContain("setCashGiven(String(billete))");
  });

  it("el descubrimiento de creadores (Marz) exhibe empty state claro cuando no hay resultados", () => {
    expect(creatorDiscovery).toContain("WorkspaceState");
    expect(creatorDiscovery).toContain("kind=\"initial-loading\"");
    expect(creatorDiscovery).toContain("Sin creadores para los filtros aplicados");
    expect(creatorDiscovery).toContain("Todavía no registraste creadores");
  });

  it("la tabla de gastos en finanzas garantiza accesibilidad de botones de acción en mobile", () => {
    expect(expensesPage).toContain("sm:opacity-0 sm:group-hover:opacity-100");
  });
});
